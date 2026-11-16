package study

import (
	"context"
	"errors"
	"fmt"
	"time"

	"qinqin/internal/model"
	"qinqin/internal/study/rows"
)

// The legacy view (docs/contracts/study/README.md): a cached v0.3.x web
// shell reads and writes study rows as qinqin-flashcards plugin data. These
// functions serve that view from the typed tables; nothing here writes
// plugin_data. Deprecated from v0.4.0; removed only in a release that says
// so and answers old shells that they are too old.

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
