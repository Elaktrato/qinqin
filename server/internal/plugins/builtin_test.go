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
		// review and read moved into the core (v0.4.0): flashcards and the
		// reader are core features; their rows stay as reserved registry
		// rows (the study namespace, the reader's switch) with no surface.
		{"qinqin-core", []string{}, []string{"owns-data", "write:study-events"}, []string{"session", "view", "lookup", "review", "read"}},
		{"qinqin-flashcards", []string{}, []string{"owns-data"}, nil},
		{"qinqin-reader", []string{}, []string{}, nil},
		{"qinqin-journal", []string{"page"}, []string{"owns-data", "write:study-events"}, []string{"journal"}},
		{"qinqin-grammar", []string{"page"}, []string{"owns-data"}, nil},
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
		version := map[string]string{"qinqin-core": "1.2", "qinqin-flashcards": "2.0", "qinqin-reader": "2.0"}[m.ID]
		if version == "" {
			version = "1.1"
		}
		if m.ID != w.id || m.Version != version || m.SDK != 1 || m.Type != "feature" ||
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
	core := plugins.Builtin()[0]
	if _, err := plugins.RegisterBuiltin(ctx, sqlDB, core); err != nil {
		t.Fatalf("register core: %v", err)
	}
	other := validManifest("qinqin-other", `"permissions":["write:study-events"],"events":[{"type":"review"}]`)
	err := plugins.Register(ctx, sqlDB, []byte(other))
	if !errors.Is(err, plugins.ErrInvalidManifest) || !strings.Contains(err.Error(), `event type "review" is already owned by qinqin-core`) {
		t.Errorf("err = %v", err)
	}
	if _, err := plugins.RegisterBuiltin(ctx, sqlDB, core); err != nil {
		t.Errorf("re-register core: %v", err)
	}
}

func TestRegisterIgnoresUnparsableRowsForOwnership(t *testing.T) {
	sqlDB := newDB(t)
	if _, err := sqlDB.Exec(`INSERT INTO plugin_registry (pack_id, manifest_json, updated_at) VALUES ('legacy', '{"id":"legacy","events":"x"}', '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if _, err := plugins.RegisterBuiltin(context.Background(), sqlDB, plugins.Builtin()[1]); err != nil {
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
	conflicts, err := plugins.RegisterBuiltin(ctx, sqlDB, plugins.Builtin()[0])
	if err != nil {
		t.Fatalf("RegisterBuiltin: %v", err)
	}
	if !reflect.DeepEqual(conflicts, []string{"qinqin-other"}) {
		t.Errorf("conflicts = %v", conflicts)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM plugin_registry WHERE pack_id = 'qinqin-core'`).Scan(&n); err != nil || n != 1 {
		t.Errorf("core row count = %d, err %v", n, err)
	}
	if _, err := plugins.RegisterBuiltin(ctx, sqlDB, []byte(`{"id":"x"}`)); !errors.Is(err, plugins.ErrInvalidManifest) {
		t.Errorf("unparsable built-in err = %v", err)
	}
}

// The v0.3.0 registry rows of flashcards (owning review) and the reader
// (owning read) are in every upgraded database. Registering the v0.4.0
// built-ins over them in Builtin() order reports no conflict (a built-in
// never conflicts with another built-in's stale row), and afterwards the
// core owns both event types.
func TestRegisterBuiltinsOverV030Rows(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	for id, raw := range map[string]string{
		"qinqin-flashcards": `{"id":"qinqin-flashcards","name":"Flashcards","version":"1.2","type":"feature","sdk":1,"description":"d","surfaces":["home-widget","page"],"permissions":["owns-data","read:entries","read:study-events","write:study-events"],"hooks":[],"events":[{"type":"review","activity":{"label":"Flashcard reviews","describe":{"one":"{n} flashcard review","other":"{n} flashcard reviews"}}}]}`,
		"qinqin-reader":     `{"id":"qinqin-reader","name":"Reader","version":"1.1","type":"feature","sdk":1,"description":"d","surfaces":["page","home-widget"],"permissions":["read:entries","read:study-events","write:study-events"],"hooks":[],"events":[{"type":"read","activity":{"label":"Reading","describe":{"one":"{n} minute of reading","other":"{n} minutes of reading"},"measure":{"field":"seconds","unit":"seconds","min":30,"max":7200},"pointsPer":300}}]}`,
		"qinqin-core":       `{"id":"qinqin-core","name":"Core","version":"1.1","type":"feature","sdk":1,"description":"d","surfaces":[],"permissions":["owns-data","write:study-events"],"hooks":[],"events":[{"type":"session"},{"type":"view"},{"type":"lookup"}]}`,
	} {
		if _, err := sqlDB.Exec(`INSERT INTO plugin_registry (pack_id, manifest_json, updated_at) VALUES (?, ?, '2026-11-01T00:00:00Z')`, id, raw); err != nil {
			t.Fatal(err)
		}
	}
	for _, raw := range plugins.Builtin() {
		conflicts, err := plugins.RegisterBuiltin(ctx, sqlDB, raw)
		if err != nil {
			t.Fatal(err)
		}
		if len(conflicts) != 0 {
			m, _ := plugins.ParseManifest(raw)
			t.Errorf("registering %s reported conflicts %v", m.ID, conflicts)
		}
	}
	got, err := plugins.ActivityRules(ctx, sqlDB)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"review/qinqin-core", "read/qinqin-core", "journal/qinqin-journal"}; !reflect.DeepEqual(pairs(got), want) {
		t.Errorf("rules = %v, want %v", pairs(got), want)
	}
	// An admin plugin claiming review still conflicts with the core.
	other := validManifest("qinqin-other", `"permissions":["write:study-events"],"events":[{"type":"review"}]`)
	if err := plugins.Register(ctx, sqlDB, []byte(other)); !errors.Is(err, plugins.ErrInvalidManifest) ||
		!strings.Contains(err.Error(), "already owned by qinqin-core") {
		t.Errorf("register a review claimer: %v", err)
	}
}
