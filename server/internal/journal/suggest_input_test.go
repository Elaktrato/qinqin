package journal_test

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"qinqin/internal/db"
	"qinqin/internal/events"
	"qinqin/internal/journal"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/plugins"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

func TestSuggestionInput(t *testing.T) {
	ctx := context.Background()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	exec := func(q string, a ...any) int64 {
		t.Helper()
		var id int64
		if err := sqlDB.QueryRow(q+" RETURNING id", a...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	uid := exec(`INSERT INTO users (username, hash, admin, updated_at) VALUES ('u','h',0,'2026-01-01T00:00:00Z')`)
	w := exec(`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (?, 'zh', '', '2026-01-01T00:00:00Z')`, uid)
	v := exec(`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (?, 'zh', 'v', '2026-01-01T00:00:00Z')`, uid)
	dict := exec(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at) VALUES ('d','d','1','x','x','2026-01-01T00:00:00Z')`)
	st := lexicon.Store{DB: sqlDB}
	e1, err := st.Put(ctx, &lexicon.Entry{Language: "zh", Kind: "word", Key: "k1", Forms: []lexicon.Form{{Text: "学校"}}}, dict)
	if err != nil {
		t.Fatal(err)
	}
	e2, err := st.Put(ctx, &lexicon.Entry{Language: "zh", Kind: "word", Key: "k2", Forms: []lexicon.Form{{Text: "老师"}}}, dict)
	if err != nil {
		t.Fatal(err)
	}

	// Cards are typed study rows (migration 038), written as a client would.
	cardAt := func(ws int64, id string, entry int64, written string, deleted bool) {
		t.Helper()
		data := map[string]any{"id": id, "kind": "vocab", "entryId": entry, "deckIds": []string{}, "createdAt": "2026-11-01T00:00:00Z"}
		if written != "" {
			data["written"] = written
		}
		b, _ := json.Marshal(data)
		r, err := rows.FromLegacy("card:"+id, b)
		if err != nil {
			t.Fatal(err)
		}
		r.M().WorkspaceID = ws
		if _, err := study.Apply(ctx, sqlDB, uid, r, time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), false); err != nil {
			t.Fatal(err)
		}
		if deleted {
			if _, err := study.Apply(ctx, sqlDB, uid, r, time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC), true); err != nil {
				t.Fatal(err)
			}
		}
	}
	card := func(ws int64, id string, entry int64, written string) { cardAt(ws, id, entry, written, false) }
	card(w, "c1", e1, "學校") // written wins over the entry form
	card(w, "c2", e2, "")   // falls back to the entry's first form
	card(w, "c3", e1, "学校") // duplicate of c1 by word? "學校" vs "学校" differ; c4 dups c2
	card(w, "c4", e2, "老师")
	card(v, "cv", e1, "只在V")
	cardAt(w, "gone", e1, "删掉", true) // a deleted card is never suggested
	// A leftover plugin row (unreadable to every client) is not a card.
	if _, err := plugins.PutData(ctx, sqlDB, uid, &w, "qinqin-flashcards", "card:old", json.RawMessage(`{"id":"old","entryId":1,"written":"旧"}`)); err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	ev := func(n int, ws int64, card string, ago time.Duration) model.StudyEvent {
		return model.StudyEvent{ID: fmt.Sprintf("01J%023d", n), UserID: uid, WorkspaceID: ws, Device: "d",
			TS: now.Add(-ago), Type: "review", Payload: json.RawMessage(fmt.Sprintf(`{"cardId":%q}`, card))}
	}
	day := 24 * time.Hour
	if _, _, err := events.Append(ctx, sqlDB, []model.StudyEvent{
		ev(1, w, "c1", 2*day), ev(2, w, "c2", day), ev(3, w, "c4", 3*day), ev(4, w, "c3", 40*day), ev(5, v, "cv", day),
		ev(6, w, "gone", day/2), ev(7, w, "old", day/3),
	}); err != nil {
		t.Fatal(err)
	}

	for i := 0; i < 12; i++ {
		b, _ := json.Marshal(map[string]any{"id": fmt.Sprint(i), "date": fmt.Sprintf("2026-11-%02d", i+1), "title": fmt.Sprint("T", i),
			"text": strings.Repeat("字", 300), "updatedAt": "2026-11-15T00:00:00Z"})
		if _, err := plugins.PutData(ctx, sqlDB, uid, &w, journal.PluginID, journal.EntryKey(fmt.Sprint(i)), b); err != nil {
			t.Fatal(err)
		}
	}

	words, recent, err := journal.SuggestionInput(ctx, sqlDB, uid, w, now)
	if err != nil {
		t.Fatal(err)
	}
	// Newest first: c2 (老师), c1 (學校); c4 (老师) is a duplicate; c3 is 40 days old; cv is another workspace.
	if strings.Join(words, ",") != "老师,學校" {
		t.Errorf("words = %v", words)
	}
	if len(recent) != 10 {
		t.Fatalf("recent = %d, want 10", len(recent))
	}
	if recent[0].Title != "T11" {
		t.Errorf("recent[0] = %q, want newest first", recent[0].Title)
	}
	if n := len([]rune(recent[0].Opening)); n != 200 {
		t.Errorf("opening runes = %d, want 200", n)
	}
}
