package study_test

import (
	"context"
	"testing"

	"qinqin/internal/study"
)

// Review fix (phase A, 4): a binary downgrade to v0.3.x (unsupported, but it
// happens) writes study rows into plugin_data again after migration 038 has
// run. At startup the server adopts every readable typed-family row whose key
// no typed row holds, row by row; shadowed, unreadable, user-global and
// foreign-workspace rows stay untouched. A second run moves nothing.
func TestAdoptLeftoversAfterADowngrade(t *testing.T) {
	ctx := context.Background()
	sqlDB := openDB(t)
	apply(t, sqlDB, 1, card(t, 7, "c-vocab-1", 1), "2026-11-12T10:00:00Z", false)
	ins := func(user int64, ws any, key, data string) {
		t.Helper()
		if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
			VALUES ('qinqin-flashcards', ?, ?, ?, ?, 2, '2026-11-14T08:00:00Z', '2026-11-14T07:59:59Z')`, user, ws, key, data); err != nil {
			t.Fatal(err)
		}
	}
	ins(1, 7, "card:c-vocab-2", `{"id":"c-vocab-2","kind":"vocab","entryId":2,"deckIds":["general"],"createdAt":"2026-11-14T08:00:00Z"}`)
	ins(1, 7, "deck:01JDECK", `{"id":"01JDECK","name":"Words","createdAt":"2026-11-14T08:00:00Z"}`)
	ins(1, 7, "card:c-vocab-1", `{"id":"c-vocab-1","kind":"vocab","entryId":1,"deckIds":["d2"],"createdAt":"t"}`) // shadowed by the typed row
	ins(1, 7, "card:c-vocab-15", `{"id":"c-vocab-15","kind":"vocab","entryId":1.5,"deckIds":[],"createdAt":"t"}`) // unreadable
	ins(1, nil, "card:c-vocab-3", `{"id":"c-vocab-3","kind":"vocab","entryId":3,"deckIds":[],"createdAt":"t"}`)   // user-global
	ins(1, 9, "card:c-vocab-4", `{"id":"c-vocab-4","kind":"vocab","entryId":4,"deckIds":[],"createdAt":"t"}`)     // bob's workspace
	ins(1, 7, "known:5", `{"version":1,"entryId":5,"createdAt":"t"}`)                                             // keyed row

	moved, err := study.AdoptLeftovers(ctx, sqlDB)
	if err != nil || moved != 2 {
		t.Fatalf("AdoptLeftovers = %d, %v; want 2", moved, err)
	}
	r, ok, err := study.Get(ctx, sqlDB, 1, 7, "cards", "c-vocab-2")
	if err != nil || !ok || r.M().Version != 2 || r.M().ModifiedAt.Format("15:04:05") != "07:59:59" {
		t.Fatalf("adopted card: %+v %v %v", r, ok, err)
	}
	if _, ok, _ := study.Get(ctx, sqlDB, 1, 7, "decks", "01JDECK"); !ok {
		t.Error("adopted deck missing")
	}
	var left []string
	q, _ := sqlDB.Query(`SELECT key FROM plugin_data ORDER BY key`)
	for q.Next() {
		var k string
		q.Scan(&k)
		left = append(left, k)
	}
	q.Close()
	want := []string{"card:c-vocab-1", "card:c-vocab-15", "card:c-vocab-3", "card:c-vocab-4", "known:5"}
	if len(left) != len(want) {
		t.Fatalf("plugin_data keys %v, want %v", left, want)
	}
	for i := range want {
		if left[i] != want[i] {
			t.Fatalf("plugin_data keys %v, want %v", left, want)
		}
	}
	if c, _, _ := study.Get(ctx, sqlDB, 1, 7, "cards", "c-vocab-1"); c.M().Version != 1 {
		t.Error("the shadowing typed row changed")
	}
	if again, err := study.AdoptLeftovers(ctx, sqlDB); err != nil || again != 0 {
		t.Errorf("second run = %d, %v", again, err)
	}
}
