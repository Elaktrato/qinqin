package journal_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"qinqin/internal/dbtest"
	"qinqin/internal/events"
	"qinqin/internal/journal"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

// TestSuggestionInputUsesTheDisplayForm: a card without a written snapshot
// suggests its entry's display form — の, not the search-only 乃; する,
// not the usually-kana 為る.
func TestSuggestionInputUsesTheDisplayForm(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	exec := func(q string, a ...any) int64 {
		t.Helper()
		var id int64
		if err := sqlDB.QueryRow(q+" RETURNING id", a...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	uid := exec(`INSERT INTO users (username, hash, admin, updated_at) VALUES ('u','h',0,'2026-01-01T00:00:00Z')`)
	w := exec(`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (?, 'ja', '', '2026-01-01T00:00:00Z')`, uid)
	dict := exec(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at) VALUES ('d','d','1','x','x','2026-01-01T00:00:00Z')`)
	st := lexicon.Store{DB: sqlDB}
	no, err := st.Put(ctx, &lexicon.Entry{Language: "ja", Kind: "word", Key: "j:1469800",
		Forms:    []lexicon.Form{{Text: "乃", Flags: []string{"sK"}}, {Text: "之", Flags: []string{"sK"}}},
		Readings: []lexicon.Reading{{Type: "kana", Value: "の", Plain: "の"}},
		Senses:   []lexicon.Sense{{Glosses: []string{"of"}}}}, dict)
	if err != nil {
		t.Fatal(err)
	}
	suru, err := st.Put(ctx, &lexicon.Entry{Language: "ja", Kind: "word", Key: "j:1157170", UK: true,
		Forms:    []lexicon.Form{{Text: "為る", Flags: []string{"rK"}}},
		Readings: []lexicon.Reading{{Type: "kana", Value: "する", Plain: "する"}},
		Senses:   []lexicon.Sense{{Tags: []string{"uk"}, Glosses: []string{"to do"}}}}, dict)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		id    string
		entry int64
	}{{"c1", no}, {"c2", suru}} {
		b, _ := json.Marshal(map[string]any{"id": c.id, "kind": "vocab", "entryId": c.entry, "deckIds": []string{}, "createdAt": "2026-11-01T00:00:00Z"})
		r, err := rows.FromLegacy("card:"+c.id, b)
		if err != nil {
			t.Fatal(err)
		}
		r.M().WorkspaceID = w
		if _, err := study.Apply(ctx, sqlDB, uid, r, time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), false); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	if _, _, err := events.Append(ctx, sqlDB, []model.StudyEvent{
		{ID: "01J00000000000000000000001", UserID: uid, WorkspaceID: w, Device: "d", TS: now.Add(-2 * time.Hour),
			Type: "review", Payload: json.RawMessage(`{"cardId":"c1"}`)},
		{ID: "01J00000000000000000000002", UserID: uid, WorkspaceID: w, Device: "d", TS: now.Add(-time.Hour),
			Type: "review", Payload: json.RawMessage(`{"cardId":"c2"}`)},
	}); err != nil {
		t.Fatal(err)
	}
	words, _, err := journal.SuggestionInput(ctx, sqlDB, uid, w, now)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(words, ",") != "する,の" {
		t.Errorf("words = %v, want する,の", words)
	}
}
