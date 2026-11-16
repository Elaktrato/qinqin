package study

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"qinqin/internal/model"
	"qinqin/internal/study/rows"
)

// The legacy view (docs/contracts/study/README.md): a cached v0.3.x web
// shell reads and writes study rows as qinqin-flashcards plugin data. These
// functions serve that view from the typed tables; nothing here writes
// plugin_data. Deprecated from v0.4.0; removed only in a release that says
// so and answers old shells that they are too old.

// LegacyKeySQL is a SQL condition on a plugin_data key column named key
// that holds exactly for the keys rows.FamilyOf assigns to a typed family
// (GLOB is case-sensitive, like FamilyOf). Callers add pack_id = Namespace.
const LegacyKeySQL = `(key GLOB 'card:*' OR key GLOB 'deck:*' OR key GLOB 'deckcfg:*' OR key = 'limits:workspace' ` +
	`OR key GLOB 'limits:deck:*' OR key GLOB 'fsrs:set:*' OR key = 'fsrs:active')`

// ReadableLeftover reports whether a qinqin-flashcards plugin row of a typed
// family still carries a study row a client can read: it has a workspace of
// the user, the codec reads it, and no typed row holds its key. The
// migration moved every such row, so after it only a write through the
// plugin store or a restore of an older server could leave one; a backup
// export carries those and drops every other leftover.
func ReadableLeftover(ctx context.Context, q Querier, userID int64, workspaceID *int64, key string, data json.RawMessage) (bool, error) {
	if workspaceID == nil {
		return false, nil
	}
	var owner int64
	err := q.QueryRowContext(ctx, `SELECT user_id FROM workspaces WHERE id = ?`, *workspaceID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && owner != userID) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("study: workspace of %s: %w", key, err)
	}
	r, err := rows.FromLegacy(key, data)
	if err != nil {
		return false, nil
	}
	r.M().WorkspaceID = *workspaceID
	if rows.Validate(r) != nil {
		return false, nil
	}
	held, err := HasTypedRow(ctx, q, userID, *workspaceID, key)
	return !held, err
}

// ErrNoTypedRow is a legacy deletion of a key no typed row holds: the caller
// falls back to plugin data (a leftover row the migration could not read).
var ErrNoTypedRow = errors.New("study: no typed row for the legacy key")

// LegacyRow is the legacy plugin-data form of a typed row of userID.
func LegacyRow(userID int64, r rows.Row) model.PluginData {
	key, data := rows.ToLegacy(r)
	m := r.M()
	ws := m.WorkspaceID
	return model.PluginData{PluginID: rows.Namespace, Key: key, UserID: userID, WorkspaceID: &ws,
		Data: data, Version: m.Version, UpdatedAt: m.UpdatedAt, DeletedAt: m.DeletedAt}
}

// LegacyRows returns every typed row of the user changed since since (the
// PullRows rule: zero = live only) as legacy rows, family by family.
func LegacyRows(ctx context.Context, q Querier, userID int64, since time.Time) ([]model.PluginData, error) {
	out := []model.PluginData{}
	for _, f := range rows.Families {
		list, err := PullRows(ctx, q, userID, f, since)
		if err != nil {
			return nil, err
		}
		for _, r := range list {
			out = append(out, LegacyRow(userID, r))
		}
	}
	return out, nil
}

// HasTypedRow reports whether a typed row (live or tombstoned) holds the
// legacy key in the workspace; such a key shadows a leftover plugin row.
func HasTypedRow(ctx context.Context, q Querier, userID, workspaceID int64, key string) (bool, error) {
	f, id, ok := rows.KeyIdentity(key)
	if !ok {
		return false, nil
	}
	_, exists, err := Load(ctx, q, userID, workspaceID, f, id)
	return exists, err
}

// ApplyLegacy applies a legacy qinqin-flashcards row of a typed family under
// the same last-write-wins as a typed push (edited is the client's edit
// time; Apply clamps it). A live row is decoded with the codec
// (rows.ErrUnreadable when it refuses, and for a row without a workspace);
// a deletion tombstones the typed row, or is ErrNoTypedRow when none exists.
func ApplyLegacy(ctx context.Context, q Querier, userID int64, row model.PluginData, edited time.Time) (bool, error) {
	if row.WorkspaceID == nil {
		return false, fmt.Errorf("%w: %s: typed study rows belong to a workspace", rows.ErrUnreadable, row.Key)
	}
	ws := *row.WorkspaceID
	if row.DeletedAt != nil {
		f, id, ok := rows.KeyIdentity(row.Key)
		if !ok {
			return false, ErrNoTypedRow
		}
		existing, exists, err := Load(ctx, q, userID, ws, f, id)
		if err != nil {
			return false, err
		}
		if !exists {
			return false, ErrNoTypedRow
		}
		return Apply(ctx, q, userID, existing, edited, true)
	}
	r, err := rows.FromLegacy(row.Key, row.Data)
	if err != nil {
		return false, err
	}
	r.M().WorkspaceID = ws
	if err := rows.Validate(r); err != nil {
		return false, fmt.Errorf("%w: %s: %v", rows.ErrUnreadable, row.Key, err)
	}
	return Apply(ctx, q, userID, r, edited, false)
}

// LegacyGet answers a legacy read of one key in a workspace: held is true
// when a typed row (live or tombstoned) holds the key, and then live
// reports whether it is live and row is its legacy form. When held is
// false the caller reads plugin data (a leftover row).
func LegacyGet(ctx context.Context, q Querier, userID, workspaceID int64, key string) (row model.PluginData, held, live bool, err error) {
	f, id, ok := rows.KeyIdentity(key)
	if !ok {
		return model.PluginData{}, false, false, nil
	}
	r, exists, err := Load(ctx, q, userID, workspaceID, f, id)
	if err != nil || !exists {
		return model.PluginData{}, false, false, err
	}
	if r.M().DeletedAt != nil {
		return model.PluginData{}, true, false, nil
	}
	return LegacyRow(userID, r), true, true, nil
}

// legacyKeySpace is the key prefix every legacy key of a family starts with.
var legacyKeySpace = map[rows.Family]string{
	rows.Cards: "card:", rows.Decks: "deck:", rows.DeckSettings: "deckcfg:", rows.Limits: "limits:",
	rows.FsrsSets: "fsrs:set:", rows.FsrsActive: "fsrs:active",
}

// LegacyList answers a legacy prefix list in a workspace: the live typed
// rows whose legacy key starts with prefix, as legacy rows in key order,
// and the set of keys a typed row holds (live or tombstoned) among them,
// which shadow leftover plugin rows of the same key.
func LegacyList(ctx context.Context, q Querier, userID, workspaceID int64, prefix string) (list []model.PluginData, held map[string]bool, err error) {
	list, held = []model.PluginData{}, map[string]bool{}
	for _, f := range rows.Families {
		space := legacyKeySpace[f]
		if !strings.HasPrefix(space, prefix) && !strings.HasPrefix(prefix, space) {
			continue
		}
		t := tables[f]
		rs, err := q.QueryContext(ctx, `SELECT `+selectCols(f)+` FROM `+t.name+` WHERE user_id = ? AND workspace_id = ?`, userID, workspaceID)
		if err != nil {
			return nil, nil, fmt.Errorf("study: legacy list %s: %w", f, err)
		}
		for rs.Next() {
			r, err := scanRow(f, rs)
			if err != nil {
				rs.Close()
				return nil, nil, fmt.Errorf("study: legacy list %s: %w", f, err)
			}
			row := LegacyRow(userID, r)
			if !strings.HasPrefix(row.Key, prefix) {
				continue
			}
			held[row.Key] = true
			if row.DeletedAt == nil {
				list = append(list, row)
			}
		}
		if err := rs.Close(); err != nil {
			return nil, nil, err
		}
		if err := rs.Err(); err != nil {
			return nil, nil, fmt.Errorf("study: legacy list %s: %w", f, err)
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Key < list[j].Key })
	return list, held, nil
}
