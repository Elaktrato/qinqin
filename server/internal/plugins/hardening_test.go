package plugins_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"qinqin/internal/plugins"
)

func TestParseManifestRefusesTrailingData(t *testing.T) {
	valid := string(marshalMutated(t, func(map[string]any) {}))
	for name, raw := range map[string]string{
		"garbage":       valid + " garbage",
		"second object": valid + valid,
		"stray brace":   valid + "}",
	} {
		_, err := plugins.ParseManifest([]byte(raw))
		if !errors.Is(err, plugins.ErrInvalidManifest) {
			t.Errorf("%s: err = %v, want ErrInvalidManifest", name, err)
		} else if !strings.Contains(err.Error(), "after the manifest") {
			t.Errorf("%s: err = %q, want it to name the trailing data", name, err)
		}
	}
	if _, err := plugins.ParseManifest([]byte(" \n" + valid + "\n\t ")); err != nil {
		t.Errorf("surrounding whitespace: %v", err)
	}
}

func TestRegisterStoresNothingForTrailingData(t *testing.T) {
	sqlDB := newDB(t)
	err := plugins.Register(context.Background(), sqlDB, []byte(validManifest("trailing-x", "")+" garbage"))
	if !errors.Is(err, plugins.ErrInvalidManifest) {
		t.Fatalf("err = %v", err)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM plugin_registry`).Scan(&n); err != nil || n != 0 {
		t.Errorf("rows = %d, %v", n, err)
	}
}

func TestParseManifestAcceptsNullActivity(t *testing.T) {
	raw := marshalMutated(t, func(m map[string]any) {
		m["events"] = []any{map[string]any{"type": "journal", "activity": nil}}
	})
	if _, err := plugins.ParseManifest(raw); err != nil {
		t.Errorf("activity null: %v", err)
	}
	raw = marshalMutated(t, func(m map[string]any) {
		m["events"] = []any{map[string]any{"type": "journal", "activity": []any{}}}
	})
	if _, err := plugins.ParseManifest(raw); !errors.Is(err, plugins.ErrInvalidManifest) {
		t.Errorf("activity array: err = %v", err)
	}
}

func TestListForSkipsRowsThatAreNotJSON(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	uid := newUser(t, sqlDB, "alice")
	mustRegister(t, sqlDB, validManifest("good-one", ""))
	if _, err := sqlDB.Exec(`INSERT INTO plugin_registry (pack_id, manifest_json, updated_at) VALUES ('broken', '{"id":"broken"} garbage', 'x')`); err != nil {
		t.Fatal(err)
	}
	list, err := plugins.ListFor(ctx, sqlDB, uid)
	if err != nil {
		t.Fatalf("ListFor: %v", err)
	}
	var ids []string
	for _, p := range list {
		ids = append(ids, p.ID)
	}
	if !strings.Contains(strings.Join(ids, ","), "good-one") || strings.Contains(strings.Join(ids, ","), "broken") {
		t.Errorf("ids = %v, want good-one and not broken", ids)
	}
}

func TestRegisterRefusesBuiltinIDs(t *testing.T) {
	sqlDB := newDB(t)
	for _, id := range plugins.BuiltinIDs() {
		err := plugins.Register(context.Background(), sqlDB, []byte(validManifest(id, "")))
		if !errors.Is(err, plugins.ErrBuiltinID) {
			t.Errorf("%s: err = %v, want ErrBuiltinID", id, err)
		} else if !strings.Contains(err.Error(), id) {
			t.Errorf("%s: message %q does not name the id", id, err)
		}
	}
}

func TestRegisterConcurrentClaimsOneWinner(t *testing.T) {
	for round := 0; round < 10; round++ {
		sqlDB := newDB(t)
		const n = 4
		errs := make([]error, n)
		var wg sync.WaitGroup
		start := make(chan struct{})
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				m := fmt.Sprintf(`{"id":"racer-%d","name":"X","version":"1.0","type":"feature","sdk":1,"surfaces":[],"permissions":["write:study-events"],"hooks":[],"events":[{"type":"contested"}]}`, i)
				errs[i] = plugins.Register(context.Background(), sqlDB, []byte(m))
			}()
		}
		close(start)
		wg.Wait()
		wins := 0
		for i, err := range errs {
			switch {
			case err == nil:
				wins++
			case !errors.Is(err, plugins.ErrInvalidManifest):
				t.Fatalf("round %d racer %d: err = %v, want nil or ErrInvalidManifest", round, i, err)
			}
		}
		if wins != 1 {
			t.Fatalf("round %d: %d winners, want exactly 1", round, wins)
		}
	}
}
