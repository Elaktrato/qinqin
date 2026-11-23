// Package plugins is the plugin platform's server side: the registry
// of feature plugins, the per-user enable/order state for every
// plugin, and the plugin-owned data store plugins keep their settings
// and content in. Feature plugins ship no content of their own, so
// registering one only stores its manifest. Data packs are no plugins:
// they have their own registries and routes (#198).
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

// ListFor returns every plugin the user can enable — the registry's
// feature plugins (data packs are no plugins; they are listed by their own
// routes) — each with the user's state overlaid: default state, no row in
// plugin_states, is enabled at order 0. The list is ordered by
// (order, id), so equal orders stay in a stable, named order. The
// order is the plugin's position in the Plugins list (Settings) and of
// its nav links; the home layout is the per-user widget layout in the
// qinqin-core plugin data, not this order.
func ListFor(ctx context.Context, sqlDB *sql.DB, userID int64) ([]model.PluginInfo, error) {
	list, err := featurePlugins(ctx, sqlDB)
	if err != nil {
		return nil, err
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
		info.Hidden = isHiddenBuiltin(info.ID, manifest)
		list = append(list, info)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read feature plugins: %w", err)
	}
	return list, nil
}

// CoreFeatureIDs are the reserved registry rows of the core features
// flashcards and the reader: not plugins, but each user's state row of them
// is that user's feature switch.
var CoreFeatureIDs = []string{"qinqin-flashcards", "qinqin-reader"}

// isHiddenBuiltin reports whether a registry row is one of the built-in
// plugins and declares no surface: not a plugin to list (the core row).
// The two core feature rows declare no surface either but are listed
// unhidden. That was for v0.3.x web shells (they left hidden rows out of
// Settings); it stays the documented answer until #199 retires the code
// plugins (follow-up in the #198 plan). Clients know the reserved ids.
// Admin-registered plugins are never hidden, whatever they declare.
func isHiddenBuiltin(id, manifest string) bool {
	if !slices.Contains(BuiltinIDs(), id) || slices.Contains(CoreFeatureIDs, id) {
		return false
	}
	var m struct {
		Surfaces []string `json:"surfaces"`
	}
	return json.Unmarshal([]byte(manifest), &m) == nil && len(m.Surfaces) == 0
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
// state or data under: a registry row (a built-in or admin-registered
// feature plugin). A data pack's id is no plugin (#198).
func Exists(ctx context.Context, sqlDB *sql.DB, pluginID string) (bool, error) {
	var one int
	err := sqlDB.QueryRowContext(ctx, `SELECT 1 FROM plugin_registry WHERE pack_id = ?`, pluginID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("plugins: check plugin %s: %w", pluginID, err)
	}
	return true, nil
}

// UnparsableRows lists, by id, the registry rows whose manifest no
// longer passes ParseManifest (rows registered before the contract, or
// with a malformed activity rule). Such a row is still writable
// (CanWriteData allows it as before) but does not take part in event
// ownership or activity rules; startup logs them so an operator can
// re-register or remove them.
func UnparsableRows(ctx context.Context, sqlDB *sql.DB) ([]string, error) {
	rows, err := sqlDB.QueryContext(ctx, `SELECT pack_id, manifest_json FROM plugin_registry ORDER BY pack_id`)
	if err != nil {
		return nil, fmt.Errorf("plugins: read registry: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id, raw string
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, fmt.Errorf("plugins: scan registry: %w", err)
		}
		if _, err := ParseManifest([]byte(raw)); err != nil {
			ids = append(ids, id)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read registry: %w", err)
	}
	return ids, nil
}

// CanWriteData reports whether pluginID exists (a registry row) and
// whether its data may be written (PUT/DELETE of plugin data, sync push).
// Registry rows that predate the contract (no sdk, or a manifest that does
// not parse) are allowed as before; a row that parses as an sdk manifest is
// allowed only when it declares owns-data. Any other id is (false, false).
func CanWriteData(ctx context.Context, sqlDB *sql.DB, pluginID string) (exists, allowed bool, err error) {
	var raw string
	err = sqlDB.QueryRowContext(ctx, `SELECT manifest_json FROM plugin_registry WHERE pack_id = ?`, pluginID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, false, nil
	}
	if err != nil {
		return false, false, fmt.Errorf("plugins: check plugin %s: %w", pluginID, err)
	}
	m, perr := ParseManifest([]byte(raw))
	if perr != nil {
		return true, true, nil
	}
	return true, m.Has("owns-data"), nil
}

// SetState upserts the user's state for one plugin: whether it is
// enabled and its position in the Plugins list (also the order of the
// nav links). The home layout is the per-user widget layout in the
// qinqin-core plugin data, not this order.
func SetState(ctx context.Context, sqlDB *sql.DB, userID int64, pluginID string, enabled bool, order int) error {
	_, err := SetStateRow(ctx, sqlDB, userID, pluginID, enabled, order)
	return err
}

// SetStateRow is SetState returning the stored state, so a response
// carries exactly what the row holds (updated_at is second-truncated).
func SetStateRow(ctx context.Context, sqlDB *sql.DB, userID int64, pluginID string, enabled bool, order int) (model.PluginState, error) {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	var updated string
	if err := sqlDB.QueryRowContext(ctx, `
		INSERT INTO plugin_states (user_id, pack_id, enabled, ord, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (pack_id, user_id) DO UPDATE SET
			enabled = excluded.enabled,
			ord = excluded.ord,
			updated_at = excluded.updated_at
		RETURNING updated_at`,
		userID, pluginID, enabledInt, order, now()).Scan(&updated); err != nil {
		return model.PluginState{}, fmt.Errorf("plugins: set state of %s for user %d: %w", pluginID, userID, err)
	}
	at, err := time.Parse(time.RFC3339, updated)
	if err != nil {
		return model.PluginState{}, fmt.Errorf("plugins: parse updated_at %q of state %s: %w", updated, pluginID, err)
	}
	return model.PluginState{PluginID: pluginID, UserID: userID, Enabled: enabled, Order: order, UpdatedAt: at}, nil
}

// NoWorkspace is the value the plugin_data unique key (idx_plugin_data_key,
// migration 010) gives a NULL workspace_id: IFNULL(workspace_id, 0). It is
// why no real workspace id may be 0 (PutDataRow refuses ids below 1), and
// why queries that must hit that index spell the same literal.
const NoWorkspace = 0

// UniqueKeyWorkspace is the index expression, built from NoWorkspace.
var UniqueKeyWorkspace = fmt.Sprintf("IFNULL(workspace_id, %d)", NoWorkspace)

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
	row, err := PutDataRow(ctx, sqlDB, userID, workspaceID, pluginID, key, val, &modifiedAt)
	if err != nil {
		return 0, err
	}
	return row.Version, nil
}

// PutDataRow is PutDataAt returning the row this very statement wrote,
// so a response never shows a later concurrent write. A nil modifiedAt
// (or the zero time) means "now".
func PutDataRow(ctx context.Context, sqlDB *sql.DB, userID int64, workspaceID *int64, pluginID, key string, val json.RawMessage, modifiedAt *time.Time) (*model.PluginData, error) {
	stamp := now()
	modified := stamp
	if modifiedAt != nil && !modifiedAt.IsZero() {
		modified = modifiedAt.UTC().Format(time.RFC3339)
	}
	var workspace any
	if workspaceID != nil {
		if *workspaceID <= NoWorkspace {
			// The unique key stores a NULL workspace as NoWorkspace, so that is no workspace id.
			return nil, fmt.Errorf("plugins: put data %s/%s: invalid workspace id %d", pluginID, key, *workspaceID)
		}
		workspace = *workspaceID
	}
	// The conflict target coalesces a NULL workspace to NoWorkspace
	// (0, see the idx_plugin_data_key unique index): the user-global row
	// and every workspace's row are distinct rows for the same key.
	d, err := scanData(sqlDB.QueryRowContext(ctx, `
		INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
		VALUES (?, ?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT (pack_id, user_id, `+UniqueKeyWorkspace+`, key) DO UPDATE SET
			data = excluded.data,
			version = plugin_data.version + 1,
			updated_at = excluded.updated_at,
			modified_at = excluded.modified_at,
			deleted_at = NULL
		RETURNING pack_id, user_id, workspace_id, key, data, version, updated_at, deleted_at`,
		pluginID, userID, workspace, key, dataOf(val), stamp, modified))
	if err != nil {
		return nil, fmt.Errorf("plugins: put data %s/%s for user %d: %w", pluginID, key, userID, err)
	}
	return d, nil
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
	list := make([]model.PluginData, 0)
	err := EachData(ctx, sqlDB, userID, since, false, func(d *model.PluginData) error {
		list = append(list, *d)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return list, nil
}

// EachData streams PullData's rows to fn one at a time, in its order;
// liveOnly leaves tombstones out.
func EachData(ctx context.Context, sqlDB *sql.DB, userID int64, since time.Time, liveOnly bool, fn func(*model.PluginData) error) error {
	live := ""
	if liveOnly {
		live = " AND deleted_at IS NULL"
	}
	rows, err := sqlDB.QueryContext(ctx, dataSelect+`
		WHERE user_id = ? AND updated_at >= ?`+live+`
		ORDER BY updated_at, pack_id, key`,
		userID, since.UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("plugins: pull data of user %d: %w", userID, err)
	}
	defer rows.Close()
	for rows.Next() {
		d, err := scanData(rows)
		if err != nil {
			return fmt.Errorf("plugins: scan data of user %d: %w", userID, err)
		}
		if err := fn(d); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("plugins: pull data of user %d: %w", userID, err)
	}
	return nil
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
