package plugins_test

import (
	"context"
	"encoding/json"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/plugins"
)

// TestSetStateRowMatchesStorage: the state returned by a write is the
// stored row — second-truncated like every updated_at — not a separate
// nanosecond clock reading.
func TestSetStateRowMatchesStorage(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	alice := newUser(t, sqlDB, "alice")

	st, err := plugins.SetStateRow(ctx, sqlDB, alice, "qinqin-heatmap", false, 3)
	if err != nil {
		t.Fatalf("SetStateRow: %v", err)
	}
	if st.PluginID != "qinqin-heatmap" || st.UserID != alice || st.Enabled || st.Order != 3 {
		t.Errorf("state = %+v, want heatmap, alice, disabled, order 3", st)
	}
	if st.UpdatedAt.Nanosecond() != 0 {
		t.Errorf("UpdatedAt = %v, want whole seconds like the stored row", st.UpdatedAt)
	}
	var stored string
	if err := sqlDB.QueryRow(`SELECT updated_at FROM plugin_states WHERE user_id = ? AND pack_id = ?`, alice, "qinqin-heatmap").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if got := st.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"); got != stored {
		t.Errorf("UpdatedAt = %s, stored %s", got, stored)
	}
}

// TestPutDataRowReturnsWrittenRow: the row comes back from the write itself.
func TestPutDataRowReturnsWrittenRow(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	alice := newUser(t, sqlDB, "alice")
	mustRegister(t, sqlDB, `{"id":"notes","name":"Notes","version":"1.0","type":"feature","sdk":1,"surfaces":[],"permissions":["owns-data"],"hooks":[],"events":[]}`)

	for want := 1; want <= 2; want++ {
		row, err := plugins.PutDataRow(ctx, sqlDB, alice, nil, "notes", "k", json.RawMessage(`{"n":1}`), nil)
		if err != nil {
			t.Fatalf("PutDataRow: %v", err)
		}
		if row.Version != want || row.PluginID != "notes" || row.Key != "k" || string(row.Data) != `{"n":1}` {
			t.Errorf("row = %+v, want version %d of notes/k", row, want)
		}
		got, err := plugins.GetData(ctx, sqlDB, alice, nil, "notes", "k")
		if err != nil || got.Version != row.Version || !got.UpdatedAt.Equal(row.UpdatedAt) {
			t.Errorf("stored = %+v (%v), returned %+v", got, err, row)
		}
	}
}

// TestPutDataRejectsWorkspaceZero: the unique key coalesces a NULL
// workspace to 0, so 0 (or less) must never be a real workspace id.
func TestPutDataRejectsWorkspaceZero(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	alice := newUser(t, sqlDB, "alice")
	for _, ws := range []int64{0, -1} {
		if _, err := plugins.PutData(ctx, sqlDB, alice, &ws, "notes", "k", json.RawMessage(`1`)); err == nil {
			t.Errorf("PutData with workspace %d succeeded, want an error", ws)
		}
	}
}

// TestListFlagsSurfacelessBuiltinsHidden: qinqin-core (registered only so its
// data is accepted) is listed with hidden=true; the reserved rows of the core
// features flashcards and reader are listed with hidden=false (introduced for
// v0.3.x shells; kept as the documented answer until #199, see the #198 plan),
// while clients know the reserved ids and keep them out of their plugin lists. Built-ins with a surface and admin plugins are not
// hidden either.
func TestListFlagsSurfacelessBuiltinsHidden(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	alice := newUser(t, sqlDB, "alice")
	for _, raw := range plugins.Builtin() {
		if _, err := plugins.RegisterBuiltin(ctx, sqlDB, raw); err != nil {
			t.Fatalf("RegisterBuiltin: %v", err)
		}
	}
	// An admin plugin that also declares no surface stays visible: only
	// the built-ins are the app's own.
	mustRegister(t, sqlDB, `{"id":"quiet","name":"Quiet","version":"1.0","type":"feature","sdk":1,"surfaces":[],"permissions":["owns-data"],"hooks":[],"events":[]}`)

	list, err := plugins.ListFor(ctx, sqlDB, alice)
	if err != nil {
		t.Fatal(err)
	}
	hidden := map[string]bool{}
	for _, p := range list {
		hidden[p.ID] = p.Hidden
	}
	if h, ok := hidden["qinqin-core"]; !ok || !h {
		t.Errorf("qinqin-core: listed=%v hidden=%v, want listed and hidden", ok, h)
	}
	for _, id := range []string{"qinqin-flashcards", "qinqin-reader", "qinqin-journal", "qinqin-grammar", "quiet"} {
		if h, ok := hidden[id]; !ok || h {
			t.Errorf("%s: listed=%v hidden=%v, want listed and visible", id, ok, h)
		}
	}
}
