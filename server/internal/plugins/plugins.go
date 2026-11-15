// Package plugins is the plugin platform's server side: the registry
// of feature plugins, the per-user enable/order state for every
// plugin, and the plugin-owned data store plugins keep their settings
// and content in. Feature plugins ship no content of their own, so
// registering one only stores its manifest; data plugins (dictionary,
// levels, frequency, sentences packs) register themselves through their pack
// registries and appear in listings without a row here.
package plugins

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"slices"
	"sort"
	"time"

	"qinqin/internal/model"
)

// ErrNotFound reports a missing plugin data row: reading one that was
// never stored, or one already tombstoned.
var ErrNotFound = errors.New("plugins: not found")

// ErrInvalidManifest reports a feature-plugin manifest that fails the
// contract (see ParseManifest).
var ErrInvalidManifest = errors.New("plugins: invalid manifest")

// ErrBuiltinID reports a registration under the id of a built-in plugin.
var ErrBuiltinID = errors.New("plugins: id belongs to a built-in plugin")

// dataManifest is the manifest of a data plugin as ListFor serves it,
// synthesized from the pack registry row its import left: the fields
// that pack kind's registry stores, with type naming the kind.
type dataManifest struct {
	ID          string `json:"id"`
	Name        string `json:"name,omitempty"`
	Version     string `json:"version,omitempty"`
	Type        string `json:"type"`
	Language    string `json:"language,omitempty"`
	License     string `json:"license,omitempty"`
	Attribution string `json:"attribution,omitempty"`
}

// Register validates a feature-plugin manifest against the SDK
// contract (ParseManifest) and upserts it into the registry, keyed by
// the manifest's id; re-registering an id replaces its manifest. An
// event type already owned by another registered plugin is refused.
// The manifest is stored verbatim. Registry rows that do not parse
// (admin-registered before the contract) are ignored for ownership.
func Register(ctx context.Context, sqlDB *sql.DB, manifestJSON []byte) error {
	m, err := ParseManifest(manifestJSON)
	if err != nil {
		return err
	}
	if slices.Contains(BuiltinIDs(), m.ID) {
		return fmt.Errorf("%w: %q is reserved", ErrBuiltinID, m.ID)
	}
	// BEGIN IMMEDIATE takes the write lock before the ownership read, so
	// two concurrent registrations serialize (the busy timeout makes the
	// second wait) and the loser sees the winner's event types.
	tx, err := beginImmediate(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("plugins: register %s: %w", m.ID, err)
	}
	defer tx.rollback()
	owners, err := eventOwners(ctx, tx.conn, m.ID)
	if err != nil {
		return err
	}
	for _, e := range m.Events {
		if owner, ok := owners[e.Type]; ok {
			return fmt.Errorf("%w: event type %q is already owned by %s", ErrInvalidManifest, e.Type, owner)
		}
	}
	if err := upsert(ctx, tx.conn, m.ID, manifestJSON); err != nil {
		return err
	}
	if err := tx.commit(ctx); err != nil {
		return fmt.Errorf("plugins: register %s: %w", m.ID, err)
	}
	return nil
}

// querier is what the registry helpers need of a connection.
type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// immediateTx is a SQLite transaction started with BEGIN IMMEDIATE on a
// dedicated connection.
type immediateTx struct {
	conn *sql.Conn
	done bool
}

func beginImmediate(ctx context.Context, sqlDB *sql.DB) (*immediateTx, error) {
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return &immediateTx{conn: conn}, nil
}

func (t *immediateTx) commit(ctx context.Context) error {
	if _, err := t.conn.ExecContext(ctx, "COMMIT"); err != nil {
		return err
	}
	t.done = true
	return nil
}

// rollback undoes an uncommitted transaction and releases the connection.
func (t *immediateTx) rollback() {
	if !t.done {
		_, _ = t.conn.ExecContext(context.Background(), "ROLLBACK")
	}
	_ = t.conn.Close()
}

// eventOwners maps every event type declared by a parsable registry
// row other than selfID to the id of the plugin declaring it.
func eventOwners(ctx context.Context, tx querier, selfID string) (map[string]string, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT pack_id, manifest_json FROM plugin_registry WHERE pack_id <> ? ORDER BY pack_id`, selfID)
	if err != nil {
		return nil, fmt.Errorf("plugins: read registry: %w", err)
	}
	defer rows.Close()
	owners := map[string]string{}
	for rows.Next() {
		var id, raw string
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, fmt.Errorf("plugins: scan registry: %w", err)
		}
		other, err := ParseManifest([]byte(raw))
		if err != nil {
			continue
		}
		for _, e := range other.Events {
			if _, taken := owners[e.Type]; !taken {
				owners[e.Type] = id
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read registry: %w", err)
	}
	return owners, nil
}

// upsert stores one manifest row verbatim.
func upsert(ctx context.Context, tx querier, id string, manifestJSON []byte) error {
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO plugin_registry (pack_id, manifest_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT (pack_id) DO UPDATE SET
			manifest_json = excluded.manifest_json,
			updated_at = excluded.updated_at`,
		id, string(manifestJSON), now()); err != nil {
		return fmt.Errorf("plugins: register %s: %w", id, err)
	}
	return nil
}

// Unregister removes a feature plugin from the registry together with
// every user's state for it. It is how a build retires a plugin it no
// longer ships: an upgraded database keeps the old row otherwise, and
// Settings would list a dead plugin. Unregistering an id that is not
// present is a no-op, so it is safe on every start.
func Unregister(ctx context.Context, sqlDB *sql.DB, pluginID string) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("plugins: unregister %s: %w", pluginID, err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.ExecContext(ctx, `DELETE FROM plugin_states WHERE pack_id = ?`, pluginID); err != nil {
		return fmt.Errorf("plugins: unregister %s: delete states: %w", pluginID, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM plugin_registry WHERE pack_id = ?`, pluginID); err != nil {
		return fmt.Errorf("plugins: unregister %s: delete registry row: %w", pluginID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("plugins: unregister %s: %w", pluginID, err)
	}
	return nil
}

// ListFor returns every plugin the user can enable — feature plugins
// from the registry plus the data plugins registered by pack imports —
// each with the user's state overlaid: default state, no row in
// plugin_states, is enabled at order 0. The list is ordered by
// (order, id), so equal orders stay in a stable, named order. The
// order is the plugin's position in the Plugins list (Settings) and of
// its nav links; the home layout is the per-user widget layout in the
// qinqin-core plugin data, not this order.
func ListFor(ctx context.Context, sqlDB *sql.DB, userID int64) ([]model.PluginInfo, error) {
	list := make([]model.PluginInfo, 0)
	for _, load := range []func(context.Context, *sql.DB) ([]model.PluginInfo, error){
		featurePlugins, dictionaryPlugins, schemePlugins, frequencyPlugins, sentencePlugins, grammarPlugins, audioPlugins,
	} {
		found, err := load(ctx, sqlDB)
		if err != nil {
			return nil, err
		}
		list = append(list, found...)
	}

	states, err := statesFor(ctx, sqlDB, userID)
	if err != nil {
		return nil, err
	}
	for i := range list {
		if st, ok := states[list[i].ID]; ok {
			list[i].Enabled = st.Enabled
			list[i].Order = st.Order
		}
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Order != list[j].Order {
			return list[i].Order < list[j].Order
		}
		return list[i].ID < list[j].ID
	})
	return list, nil
}

// featurePlugins lists the admin-registered feature plugins with
// their manifests verbatim.
func featurePlugins(ctx context.Context, sqlDB *sql.DB) ([]model.PluginInfo, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, manifest_json FROM plugin_registry`)
	if err != nil {
		return nil, fmt.Errorf("plugins: read feature plugins: %w", err)
	}
	defer rows.Close()

	list := make([]model.PluginInfo, 0)
	for rows.Next() {
		var (
			info     model.PluginInfo
			manifest string
		)
		if err := rows.Scan(&info.ID, &manifest); err != nil {
			return nil, fmt.Errorf("plugins: scan feature plugin: %w", err)
		}
		if !json.Valid([]byte(manifest)) {
			// A row that is not JSON would make the whole listing fail to
			// marshal; skip it rather than lock everyone out of Settings.
			log.Printf("plugins: skipping registry row %q: manifest is not valid JSON", info.ID)
			continue
		}
		info.Manifest = json.RawMessage(manifest)
		info.Enabled = true
		list = append(list, info)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read feature plugins: %w", err)
	}
	return list, nil
}

// dictionaryPlugins lists the dictionary packs, active only — an
// uninstalled dictionary drops out of the list while its entries
// survive.
func dictionaryPlugins(ctx context.Context, sqlDB *sql.DB) ([]model.PluginInfo, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, name, version, license, attribution
		FROM dictionaries WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("plugins: read dictionaries: %w", err)
	}
	defer rows.Close()

	list := make([]model.PluginInfo, 0)
	for rows.Next() {
		var m dataManifest
		if err := rows.Scan(&m.ID, &m.Name, &m.Version, &m.License, &m.Attribution); err != nil {
			return nil, fmt.Errorf("plugins: scan dictionary: %w", err)
		}
		m.Type = "dictionary"
		list = append(list, dataPlugin(m))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read dictionaries: %w", err)
	}
	return list, nil
}

// schemePlugins lists the levels packs, active only.
func schemePlugins(ctx context.Context, sqlDB *sql.DB) ([]model.PluginInfo, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, name, version, language, license, attribution
		FROM schemes WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("plugins: read schemes: %w", err)
	}
	defer rows.Close()

	list := make([]model.PluginInfo, 0)
	for rows.Next() {
		var m dataManifest
		if err := rows.Scan(&m.ID, &m.Name, &m.Version, &m.Language, &m.License, &m.Attribution); err != nil {
			return nil, fmt.Errorf("plugins: scan scheme: %w", err)
		}
		m.Type = "levels"
		list = append(list, dataPlugin(m))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read schemes: %w", err)
	}
	return list, nil
}

// frequencyPlugins lists the frequency packs, active only.
func frequencyPlugins(ctx context.Context, sqlDB *sql.DB) ([]model.PluginInfo, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, name, version, language, license, attribution
		FROM frequency_packs WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("plugins: read frequency packs: %w", err)
	}
	defer rows.Close()

	list := make([]model.PluginInfo, 0)
	for rows.Next() {
		var m dataManifest
		if err := rows.Scan(&m.ID, &m.Name, &m.Version, &m.Language, &m.License, &m.Attribution); err != nil {
			return nil, fmt.Errorf("plugins: scan frequency pack: %w", err)
		}
		m.Type = "frequency"
		list = append(list, dataPlugin(m))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read frequency packs: %w", err)
	}
	return list, nil
}

// sentencePlugins lists the sentences packs by the pack ids their
// imported sentences carry — the only registry a sentences pack has.
func sentencePlugins(ctx context.Context, sqlDB *sql.DB) ([]model.PluginInfo, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT DISTINCT source_pack FROM sentences
		WHERE user_id IS NULL AND deleted_at IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("plugins: read sentence packs: %w", err)
	}
	defer rows.Close()

	list := make([]model.PluginInfo, 0)
	for rows.Next() {
		var pack string
		if err := rows.Scan(&pack); err != nil {
			return nil, fmt.Errorf("plugins: scan sentence pack: %w", err)
		}
		list = append(list, dataPlugin(dataManifest{ID: pack, Type: "sentences"}))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read sentence packs: %w", err)
	}
	return list, nil
}

// grammarPlugins lists the grammar packs, active only.
func grammarPlugins(ctx context.Context, sqlDB *sql.DB) ([]model.PluginInfo, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, name, version, language, license, attribution
		FROM grammar_packs WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("plugins: read grammar packs: %w", err)
	}
	defer rows.Close()

	list := make([]model.PluginInfo, 0)
	for rows.Next() {
		var m dataManifest
		if err := rows.Scan(&m.ID, &m.Name, &m.Version, &m.Language, &m.License, &m.Attribution); err != nil {
			return nil, fmt.Errorf("plugins: scan grammar pack: %w", err)
		}
		m.Type = "grammar"
		list = append(list, dataPlugin(m))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read grammar packs: %w", err)
	}
	return list, nil
}

// audioPlugins lists the audio packs, active only.
func audioPlugins(ctx context.Context, sqlDB *sql.DB) ([]model.PluginInfo, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, name, version, language, license, attribution
		FROM audio_packs WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("plugins: read audio packs: %w", err)
	}
	defer rows.Close()

	list := make([]model.PluginInfo, 0)
	for rows.Next() {
		var m dataManifest
		if err := rows.Scan(&m.ID, &m.Name, &m.Version, &m.Language, &m.License, &m.Attribution); err != nil {
			return nil, fmt.Errorf("plugins: scan audio pack: %w", err)
		}
		m.Type = "audio"
		list = append(list, dataPlugin(m))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read audio packs: %w", err)
	}
	return list, nil
}

// dataPlugin turns one data-plugin manifest into its listed form:
// enabled by default, ordered 0 until the user moves it.
func dataPlugin(m dataManifest) model.PluginInfo {
	manifest, err := json.Marshal(m)
	if err != nil {
		// dataManifest is a struct of strings; marshaling it cannot fail.
		panic(fmt.Sprintf("plugins: marshal data manifest: %v", err))
	}
	return model.PluginInfo{
		ID:       m.ID,
		Manifest: manifest,
		Enabled:  true,
	}
}

// statesFor returns the user's plugin states keyed by plugin id.
func statesFor(ctx context.Context, sqlDB *sql.DB, userID int64) (map[string]model.PluginState, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, user_id, enabled, ord FROM plugin_states WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("plugins: read states of user %d: %w", userID, err)
	}
	defer rows.Close()

	states := map[string]model.PluginState{}
	for rows.Next() {
		var (
			st      model.PluginState
			enabled int
		)
		if err := rows.Scan(&st.PluginID, &st.UserID, &enabled, &st.Order); err != nil {
			return nil, fmt.Errorf("plugins: scan state of user %d: %w", userID, err)
		}
		st.Enabled = enabled != 0
		states[st.PluginID] = st
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read states of user %d: %w", userID, err)
	}
	return states, nil
}

// Exists reports whether pluginID names a plugin the user can have
// state or data under: a registered feature plugin or an active data
// plugin (dictionary, levels scheme, frequency pack, sentences pack, grammar pack, or audio pack).
func Exists(ctx context.Context, sqlDB *sql.DB, pluginID string) (bool, error) {
	var one int
	err := sqlDB.QueryRowContext(ctx, `
		SELECT 1 FROM plugin_registry WHERE pack_id = ?
		UNION ALL
		SELECT 1 FROM dictionaries WHERE pack_id = ? AND deleted_at IS NULL
		UNION ALL
		SELECT 1 FROM schemes WHERE pack_id = ? AND deleted_at IS NULL
		UNION ALL
		SELECT 1 FROM frequency_packs WHERE pack_id = ? AND deleted_at IS NULL
		UNION ALL
		SELECT 1 FROM sentences WHERE source_pack = ? AND user_id IS NULL AND deleted_at IS NULL
		UNION ALL
		SELECT 1 FROM grammar_packs WHERE pack_id = ? AND deleted_at IS NULL
		UNION ALL
		SELECT 1 FROM audio_packs WHERE pack_id = ? AND deleted_at IS NULL
		LIMIT 1`, pluginID, pluginID, pluginID, pluginID, pluginID, pluginID, pluginID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("plugins: check plugin %s: %w", pluginID, err)
	}
	return true, nil
}

// CanWriteData reports whether pluginID exists and whether its data may
// be written (PUT/DELETE of plugin data, sync push). Data plugins and
// registry rows that predate the contract (no sdk, or a manifest that
// does not parse) are allowed as before; a row that parses as an sdk
// manifest is allowed only when it declares owns-data. An unknown
// plugin is (false, false).
func CanWriteData(ctx context.Context, sqlDB *sql.DB, pluginID string) (exists, allowed bool, err error) {
	var raw string
	err = sqlDB.QueryRowContext(ctx, `SELECT manifest_json FROM plugin_registry WHERE pack_id = ?`, pluginID).Scan(&raw)
	if err == nil {
		m, perr := ParseManifest([]byte(raw))
		if perr != nil {
			return true, true, nil
		}
		return true, m.Has("owns-data"), nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, false, fmt.Errorf("plugins: check plugin %s: %w", pluginID, err)
	}
	exists, err = Exists(ctx, sqlDB, pluginID)
	if err != nil {
		return false, false, err
	}
	return exists, exists, nil
}

// SetState upserts the user's state for one plugin: whether it is
// enabled and its position in the Plugins list (also the order of the
// nav links). The home layout is the per-user widget layout in the
// qinqin-core plugin data, not this order.
func SetState(ctx context.Context, sqlDB *sql.DB, userID int64, pluginID string, enabled bool, order int) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	if _, err := sqlDB.ExecContext(ctx, `
		INSERT INTO plugin_states (user_id, pack_id, enabled, ord, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (pack_id, user_id) DO UPDATE SET
			enabled = excluded.enabled,
			ord = excluded.ord,
			updated_at = excluded.updated_at`,
		userID, pluginID, enabledInt, order, now()); err != nil {
		return fmt.Errorf("plugins: set state of %s for user %d: %w", pluginID, userID, err)
	}
	return nil
}

// dataSelect is the shared column list of the plugin_data reads.
const dataSelect = `
	SELECT pack_id, user_id, workspace_id, key, data, version, updated_at, deleted_at
	FROM plugin_data`

// PutData upserts the plugin's value for one key of one user,
// workspace-scoped when workspaceID is non-nil, user-global when it is
// nil. It increments the row's version, stamps updated_at, and revives
// a tombstoned row; the first write of a row is version 1.
func PutData(ctx context.Context, sqlDB *sql.DB, userID int64, workspaceID *int64, pluginID, key string, val json.RawMessage) (int, error) {
	return PutDataAt(ctx, sqlDB, userID, workspaceID, pluginID, key, val, time.Time{})
}

// PutDataAt is PutData for a write that was made earlier elsewhere:
// modifiedAt is when the edit happened — the clock last-write-wins
// compares — while updated_at still takes the server's write stamp. The
// zero time means "now". Callers clamp modifiedAt to the server clock.
func PutDataAt(ctx context.Context, sqlDB *sql.DB, userID int64, workspaceID *int64, pluginID, key string, val json.RawMessage, modifiedAt time.Time) (int, error) {
	stamp := now()
	modified := stamp
	if !modifiedAt.IsZero() {
		modified = modifiedAt.UTC().Format(time.RFC3339)
	}
	var workspace any
	if workspaceID != nil {
		workspace = *workspaceID
	}
	var version int
	// The conflict target coalesces a NULL workspace to 0, matching the
	// table's unique key: the user-global row and every workspace's row
	// are distinct rows for the same key.
	err := sqlDB.QueryRowContext(ctx, `
		INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
		VALUES (?, ?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT (pack_id, user_id, IFNULL(workspace_id, 0), key) DO UPDATE SET
			data = excluded.data,
			version = plugin_data.version + 1,
			updated_at = excluded.updated_at,
			modified_at = excluded.modified_at,
			deleted_at = NULL
		RETURNING version`,
		pluginID, userID, workspace, key, dataOf(val), stamp, modified).Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("plugins: put data %s/%s for user %d: %w", pluginID, key, userID, err)
	}
	return version, nil
}

// GetData returns the user's stored value for one key of one plugin,
// active rows only — a tombstoned row reads as ErrNotFound. A nil
// workspaceID reads the user-global row; a non-nil one that
// workspace's.
func GetData(ctx context.Context, sqlDB *sql.DB, userID int64, workspaceID *int64, pluginID, key string) (*model.PluginData, error) {
	query := dataSelect + `
		WHERE pack_id = ? AND user_id = ? AND key = ? AND deleted_at IS NULL`
	args := []any{pluginID, userID, key}
	if workspaceID == nil {
		query += ` AND workspace_id IS NULL`
	} else {
		query += ` AND workspace_id = ?`
		args = append(args, *workspaceID)
	}
	d, err := scanData(sqlDB.QueryRowContext(ctx, query, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("plugins: get data %s/%s for user %d: %w", pluginID, key, userID, err)
	}
	return d, nil
}

// ListData returns the user's live rows of one plugin whose key starts with
// prefix, ordered by key. A nil workspaceID lists the user-global rows only;
// otherwise only that workspace's. Tombstones are left out. The prefix is
// compared literally (no LIKE wildcards), and the result is never nil.
func ListData(ctx context.Context, sqlDB *sql.DB, userID int64, workspaceID *int64, pluginID, prefix string) ([]model.PluginData, error) {
	query := dataSelect + `
		WHERE pack_id = ? AND user_id = ? AND deleted_at IS NULL AND substr(key, 1, ?) = ?`
	args := []any{pluginID, userID, len([]rune(prefix)), prefix}
	if workspaceID == nil {
		query += ` AND workspace_id IS NULL`
	} else {
		query += ` AND workspace_id = ?`
		args = append(args, *workspaceID)
	}
	rows, err := sqlDB.QueryContext(ctx, query+` ORDER BY key ASC`, args...)
	if err != nil {
		return nil, fmt.Errorf("plugins: list data %s for user %d: %w", pluginID, userID, err)
	}
	defer rows.Close()

	list := make([]model.PluginData, 0)
	for rows.Next() {
		d, err := scanData(rows)
		if err != nil {
			return nil, fmt.Errorf("plugins: scan data %s for user %d: %w", pluginID, userID, err)
		}
		list = append(list, *d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: list data %s for user %d: %w", pluginID, userID, err)
	}
	return list, nil
}

// PullData returns the user's plugin data rows changed since since
// (inclusive), tombstones included, each carrying its workspace_id —
// the sync read clients use to catch up. Rows are ordered by recency
// then (plugin, key) for a stable replay.
func PullData(ctx context.Context, sqlDB *sql.DB, userID int64, since time.Time) ([]model.PluginData, error) {
	rows, err := sqlDB.QueryContext(ctx, dataSelect+`
		WHERE user_id = ? AND updated_at >= ?
		ORDER BY updated_at, pack_id, key`,
		userID, since.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("plugins: pull data of user %d: %w", userID, err)
	}
	defer rows.Close()

	list := make([]model.PluginData, 0)
	for rows.Next() {
		d, err := scanData(rows)
		if err != nil {
			return nil, fmt.Errorf("plugins: scan data of user %d: %w", userID, err)
		}
		list = append(list, *d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: pull data of user %d: %w", userID, err)
	}
	return list, nil
}

// DeleteData tombstones the user's stored value for one key of one
// plugin, stamping updated_at so a sync pull since before the delete
// sees the deletion. Deleting a missing or already-deleted row is
// ErrNotFound.
func DeleteData(ctx context.Context, sqlDB *sql.DB, userID int64, workspaceID *int64, pluginID, key string) error {
	return DeleteDataAt(ctx, sqlDB, userID, workspaceID, pluginID, key, time.Time{})
}

// DeleteDataAt is DeleteData for a deletion made earlier elsewhere:
// modifiedAt is when it happened (zero means now), the edit time
// last-write-wins compares. Callers clamp it to the server clock.
func DeleteDataAt(ctx context.Context, sqlDB *sql.DB, userID int64, workspaceID *int64, pluginID, key string, modifiedAt time.Time) error {
	query := `
		UPDATE plugin_data SET deleted_at = ?, updated_at = ?, modified_at = ?
		WHERE pack_id = ? AND user_id = ? AND key = ? AND deleted_at IS NULL`
	stamp := now()
	modified := stamp
	if !modifiedAt.IsZero() {
		modified = modifiedAt.UTC().Format(time.RFC3339)
	}
	args := []any{stamp, stamp, modified, pluginID, userID, key}
	if workspaceID == nil {
		query += ` AND workspace_id IS NULL`
	} else {
		query += ` AND workspace_id = ?`
		args = append(args, *workspaceID)
	}
	res, err := sqlDB.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("plugins: delete data %s/%s for user %d: %w", pluginID, key, userID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("plugins: delete data %s/%s for user %d: %w", pluginID, key, userID, err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// scanner is anything with a Scan method: *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

// scanData reads one plugin_data row, parsing the stored RFC 3339
// timestamps and wrapping the stored value as raw JSON.
func scanData(row scanner) (*model.PluginData, error) {
	var (
		d         model.PluginData
		workspace sql.NullInt64
		data      string
		updatedAt string
		deletedAt sql.NullString
	)
	if err := row.Scan(&d.PluginID, &d.UserID, &workspace, &d.Key,
		&data, &d.Version, &updatedAt, &deletedAt); err != nil {
		return nil, err
	}
	updated, err := time.Parse(time.RFC3339, updatedAt)
	if err != nil {
		return nil, fmt.Errorf("plugins: parse updated_at %q of %s/%s: %w", updatedAt, d.PluginID, d.Key, err)
	}
	d.UpdatedAt = updated
	if workspace.Valid {
		id := workspace.Int64
		d.WorkspaceID = &id
	}
	if deletedAt.Valid {
		deleted, err := time.Parse(time.RFC3339, deletedAt.String)
		if err != nil {
			return nil, fmt.Errorf("plugins: parse deleted_at %q of %s/%s: %w", deletedAt.String, d.PluginID, d.Key, err)
		}
		d.DeletedAt = &deleted
	}
	d.Data = json.RawMessage(data)
	return &d, nil
}

// dataOf returns the value as stored text, normalizing an absent
// value to JSON null.
func dataOf(val json.RawMessage) string {
	if len(val) == 0 {
		return "null"
	}
	return string(val)
}

// now returns the server clock as UTC RFC 3339, the timestamp
// convention for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
