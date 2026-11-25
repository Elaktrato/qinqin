package journal

import (
	"context"
	"encoding/json"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/dbtest"
)

// The keyed form carries every document and restores it into another
// workspace; what does not decode is refused, never an error.
func TestKeyedRoundTrip(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u, v := dbtest.User(t, sqlDB, "alice"), dbtest.User(t, sqlDB, "bob")
	ws, target := dbtest.Workspace(t, sqlDB, u, "zh"), dbtest.Workspace(t, sqlDB, v, "zh")
	if _, err := PutEntry(ctx, sqlDB, u, ws, Entry{ID: "E1", Date: "2026-11-19", Title: "T", Text: "你好", Source: "photo", CreatedAt: "2026-11-19T08:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	if err := PutReview(ctx, sqlDB, u, ws, Review{EntryID: "E1", TextHash: "h", Annotations: []Annotation{{ID: "a", Kind: "suggestion"}}, Model: "m", CreatedAt: "2026-11-20T09:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	if err := PutSuggestions(ctx, sqlDB, u, ws, Suggestions{Items: []ai.SuggestionItem{{Title: "x"}}, Model: "m", CreatedAt: "c"}); err != nil {
		t.Fatal(err)
	}
	if _, err := PutSettings(ctx, sqlDB, u, ws, Settings{Guidance: "g", ExplanationLanguage: "fr"}); err != nil {
		t.Fatal(err)
	}
	var docs []KeyedDoc
	if err := EachKeyed(ctx, sqlDB, u, func(d KeyedDoc) error { docs = append(docs, d); return nil }); err != nil {
		t.Fatal(err)
	}
	keys := []string{}
	for _, d := range docs {
		keys = append(keys, d.Key)
		if d.WorkspaceID != ws || !IsKeyed(d.Key) || !json.Valid(d.Data) {
			t.Errorf("doc %+v", d)
		}
	}
	if want := []string{"journal:entry:E1", "journal:review:E1", "journal:suggestions", "journal:settings"}; len(keys) != len(want) ||
		keys[0] != want[0] || keys[1] != want[1] || keys[2] != want[2] || keys[3] != want[3] {
		t.Fatalf("keys = %v, want %v", keys, want)
	}
	for _, d := range docs {
		if ok, err := RestoreKeyed(ctx, sqlDB, v, target, d.Key, d.Data); !ok || err != nil {
			t.Errorf("restore %s: %v %v", d.Key, ok, err)
		}
	}
	e, err := GetEntry(ctx, sqlDB, v, target, "E1")
	if err != nil || e.Text != "你好" || e.Source != "photo" || e.CreatedAt != "2026-11-19T08:00:00Z" {
		t.Errorf("restored entry %+v (%v)", e, err)
	}
	if r, err := GetReview(ctx, sqlDB, v, target, "E1"); err != nil || r == nil || r.Annotations[0].Kind != "suggestion" {
		t.Errorf("restored review %+v (%v)", r, err)
	}
	if s, err := GetSettings(ctx, sqlDB, v, target); err != nil || s.ExplanationLanguage != "fr" {
		t.Errorf("restored settings %+v (%v)", s, err)
	}
	if s, err := GetSuggestions(ctx, sqlDB, v, target); err != nil || s == nil || s.Items[0].Title != "x" {
		t.Errorf("restored suggestions %+v (%v)", s, err)
	}
	for key, data := range map[string]string{
		"journal:entry:E2":    `{"id":"OTHER","date":"2026-11-19","text":"t","source":"typed"}`,
		"journal:entry:E3":    `{"id":"E3","date":"bad","text":"t","source":"typed"}`,
		"journal:review:E9":   `{"entryId":"E9","annotations":[]}`,
		"journal:settings":    `{"explanationLanguage":"xx"}`,
		"journal:suggestions": `[]`,
		"journal:other":       `{}`,
	} {
		if ok, err := RestoreKeyed(ctx, sqlDB, v, target, key, json.RawMessage(data)); ok || err != nil {
			t.Errorf("%s restored: %v %v", key, ok, err)
		}
	}
}
