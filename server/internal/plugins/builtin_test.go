package plugins_test

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/plugins"
)

func TestBuiltinManifestsValid(t *testing.T) {
	want := []struct {
		id          string
		surfaces    []string
		permissions []string
		events      []string
	}{
		{"qinqin-core", []string{}, []string{"owns-data", "write:study-events"}, []string{"session", "view", "lookup"}},
		{"qinqin-flashcards", []string{"home-widget"}, []string{"owns-data", "read:entries", "read:study-events", "write:study-events"}, []string{"review"}},
		{"qinqin-reader", []string{"page", "home-widget"}, []string{"read:entries", "read:study-events", "write:study-events"}, []string{"read"}},
		{"qinqin-journal", []string{"page"}, []string{"owns-data", "write:study-events"}, []string{"journal"}},
	}
	raws := plugins.Builtin()
	if len(raws) != len(want) {
		t.Fatalf("Builtin() = %d files, want %d", len(raws), len(want))
	}
	var ids []string
	for i, raw := range raws {
		m, err := plugins.ParseManifest(raw)
		if err != nil {
			t.Fatalf("builtin %d: %v", i, err)
		}
		ids = append(ids, m.ID)
		w := want[i]
		var events []string
		for _, e := range m.Events {
			events = append(events, e.Type)
		}
		if m.ID != w.id || m.Version != "1.1" || m.SDK != 1 || m.Type != "feature" ||
			!reflect.DeepEqual(m.Surfaces, w.surfaces) || !reflect.DeepEqual(m.Permissions, w.permissions) ||
			!reflect.DeepEqual(events, w.events) || len(m.Hooks) != 0 || m.Description == "" {
			t.Errorf("builtin %s = %+v, want %+v", m.ID, m, w)
		}
	}
	if got := plugins.BuiltinIDs(); !reflect.DeepEqual(got, ids) {
		t.Errorf("BuiltinIDs() = %v, want %v", got, ids)
	}
}

func TestRegisterRejectsOwnedEventType(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	flashcards := plugins.Builtin()[1]
	if err := plugins.Register(ctx, sqlDB, flashcards); err != nil {
		t.Fatalf("register flashcards: %v", err)
	}
	other := validManifest("qinqin-other", `"permissions":["write:study-events"],"events":[{"type":"review"}]`)
	err := plugins.Register(ctx, sqlDB, []byte(other))
	if !errors.Is(err, plugins.ErrInvalidManifest) || !strings.Contains(err.Error(), `event type "review" is already owned by qinqin-flashcards`) {
		t.Errorf("err = %v", err)
	}
	if err := plugins.Register(ctx, sqlDB, flashcards); err != nil {
		t.Errorf("re-register flashcards: %v", err)
	}
}

func TestRegisterIgnoresUnparsableRowsForOwnership(t *testing.T) {
	sqlDB := newDB(t)
	if _, err := sqlDB.Exec(`INSERT INTO plugin_registry (pack_id, manifest_json, updated_at) VALUES ('legacy', '{"id":"legacy","events":"x"}', '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if err := plugins.Register(context.Background(), sqlDB, plugins.Builtin()[1]); err != nil {
		t.Errorf("register flashcards beside a legacy row: %v", err)
	}
}

func TestRegisterBuiltinWinsConflict(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	other := validManifest("qinqin-other", `"permissions":["write:study-events"],"events":[{"type":"read"}]`)
	if err := plugins.Register(ctx, sqlDB, []byte(other)); err != nil {
		t.Fatal(err)
	}
	conflicts, err := plugins.RegisterBuiltin(ctx, sqlDB, plugins.Builtin()[2])
	if err != nil {
		t.Fatalf("RegisterBuiltin: %v", err)
	}
	if !reflect.DeepEqual(conflicts, []string{"qinqin-other"}) {
		t.Errorf("conflicts = %v", conflicts)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM plugin_registry WHERE pack_id = 'qinqin-reader'`).Scan(&n); err != nil || n != 1 {
		t.Errorf("reader row count = %d, err %v", n, err)
	}
	if _, err := plugins.RegisterBuiltin(ctx, sqlDB, []byte(`{"id":"x"}`)); !errors.Is(err, plugins.ErrInvalidManifest) {
		t.Errorf("unparsable built-in err = %v", err)
	}
}
