package journal

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"qinqin/internal/ai"
	"qinqin/internal/dbtest"
)

func TestEntriesStoreAndIsolation(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := dbtest.User(t, sqlDB, "alice"), dbtest.User(t, sqlDB, "bob")
	ws, ws2 := dbtest.Workspace(t, sqlDB, alice, "zh"), dbtest.Workspace(t, sqlDB, alice, "ja")
	bobWS := dbtest.Workspace(t, sqlDB, bob, "zh")

	first, err := PutEntry(ctx, sqlDB, alice, ws, Entry{ID: "E1", Date: "2026-11-19", Title: "T", Text: "你好", Source: "typed", CreatedAt: "2026-11-19T08:00:00.123Z"})
	if err != nil {
		t.Fatal(err)
	}
	if first.CreatedAt != "2026-11-19T08:00:00.123Z" || first.UpdatedAt == "" {
		t.Errorf("stored %+v", first)
	}
	if _, err := time.Parse(time.RFC3339, first.UpdatedAt); err != nil {
		t.Errorf("updatedAt %q is not the server stamp: %v", first.UpdatedAt, err)
	}
	// a rewrite keeps the first createdAt
	again, err := PutEntry(ctx, sqlDB, alice, ws, Entry{ID: "E1", Date: "2026-11-19", Title: "T2", Text: "再见", Source: "photo", CreatedAt: "2030-01-01T00:00:00Z"})
	if err != nil || again.CreatedAt != first.CreatedAt || again.Title != "T2" || again.Source != "photo" {
		t.Errorf("rewrite = %+v (%v)", again, err)
	}
	if _, err := PutEntry(ctx, sqlDB, alice, ws, Entry{ID: "E2", Date: "2026-11-20", Text: "later", Source: "typed"}); err != nil {
		t.Fatal(err)
	}
	if _, err := PutEntry(ctx, sqlDB, alice, ws2, Entry{ID: "E3", Date: "2026-11-21", Text: "other ws", Source: "typed"}); err != nil {
		t.Fatal(err)
	}
	if _, err := PutEntry(ctx, sqlDB, bob, bobWS, Entry{ID: "E1", Date: "2026-11-22", Text: "bob's", Source: "typed"}); err != nil {
		t.Fatal(err)
	}

	list, err := ListEntries(ctx, sqlDB, alice, ws)
	if err != nil || len(list) != 2 || list[0].ID != "E2" || list[1].ID != "E1" || list[1].Text != "再见" {
		t.Fatalf("list = %+v (%v), want E2 then E1 (newest date first)", list, err)
	}
	if got, err := GetEntry(ctx, sqlDB, bob, bobWS, "E1"); err != nil || got.Text != "bob's" {
		t.Errorf("bob's E1 = %+v (%v)", got, err)
	}
	if _, err := GetEntry(ctx, sqlDB, bob, ws, "E1"); !errors.Is(err, ErrNotFound) {
		t.Errorf("bob reads alice's workspace: %v", err)
	}
	if _, err := GetEntry(ctx, sqlDB, alice, ws2, "E1"); !errors.Is(err, ErrNotFound) {
		t.Errorf("E1 in another workspace: %v", err)
	}

	// a review lives and dies with its entry
	rev := Review{EntryID: "E1", TextHash: "h", Annotations: []Annotation{{ID: "a", Quote: "你", Kind: "mistake"}},
		Overall: ai.Overall{Summary: "s"}, Model: "m", Provider: "anthropic", Dropped: DropCounts{NotFound: 1}, CreatedAt: "2026-11-20T09:00:00Z"}
	if err := PutReview(ctx, sqlDB, alice, ws, rev); err != nil {
		t.Fatal(err)
	}
	if err := PutReview(ctx, sqlDB, alice, ws, Review{EntryID: "missing", Annotations: []Annotation{}}); !errors.Is(err, ErrNotFound) {
		t.Errorf("review of a missing entry: %v", err)
	}
	got, err := GetReview(ctx, sqlDB, alice, ws, "E1")
	if err != nil || got == nil {
		t.Fatalf("review: %v %v", got, err)
	}
	a, _ := json.Marshal(got)
	b, _ := json.Marshal(rev)
	if string(a) != string(b) {
		t.Errorf("review round trip\n got %s\nwant %s", a, b)
	}
	if none, err := GetReview(ctx, sqlDB, bob, bobWS, "E1"); err != nil || none != nil {
		t.Errorf("bob's review = %v (%v)", none, err)
	}
	if err := DeleteEntry(ctx, sqlDB, alice, ws, "E1"); err != nil {
		t.Fatal(err)
	}
	if none, err := GetReview(ctx, sqlDB, alice, ws, "E1"); err != nil || none != nil {
		t.Errorf("review after the entry's delete = %v (%v)", none, err)
	}
	if err := DeleteEntry(ctx, sqlDB, alice, ws, "E1"); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete: %v", err)
	}
	if _, err := GetEntry(ctx, sqlDB, bob, bobWS, "E1"); err != nil {
		t.Errorf("alice's delete reached bob: %v", err)
	}
}

func TestPutEntryValidates(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u := dbtest.User(t, sqlDB, "alice")
	ws := dbtest.Workspace(t, sqlDB, u, "zh")
	ok := Entry{ID: "01JD0000000000000000000000", Date: "2026-11-19", Text: "t", Source: "typed"}
	for name, e := range map[string]Entry{
		"empty id":     {ID: "", Date: ok.Date, Text: "t", Source: "typed"},
		"id with /":    {ID: "a/b", Date: ok.Date, Text: "t", Source: "typed"},
		"long id":      {ID: strings.Repeat("a", 65), Date: ok.Date, Text: "t", Source: "typed"},
		"bad date":     {ID: "x", Date: "2026-13-01", Text: "t", Source: "typed"},
		"bad source":   {ID: "x", Date: ok.Date, Text: "t", Source: "voice"},
		"long title":   {ID: "x", Date: ok.Date, Title: strings.Repeat("字", MaxTitleRunes+1), Text: "t", Source: "typed"},
		"long text":    {ID: "x", Date: ok.Date, Text: strings.Repeat("字", MaxTextRunes+1), Source: "typed"},
		"bad created":  {ID: "x", Date: ok.Date, Text: "t", Source: "typed", CreatedAt: "yesterday"},
		"control char": {ID: "x", Date: ok.Date, Title: "a\x00b", Text: "t", Source: "typed"},
	} {
		var inv *InvalidError
		if _, err := PutEntry(ctx, sqlDB, u, ws, e); !errors.As(err, &inv) {
			t.Errorf("%s: %v, want an InvalidError", name, err)
		}
	}
	if got, err := PutEntry(ctx, sqlDB, u, ws, ok); err != nil || got.CreatedAt != got.UpdatedAt {
		t.Errorf("no createdAt: %+v (%v), want the server stamp for both", got, err)
	}
}

func TestSettingsAndSuggestions(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u, other := dbtest.User(t, sqlDB, "alice"), dbtest.User(t, sqlDB, "bob")
	ws := dbtest.Workspace(t, sqlDB, u, "zh")
	if s, err := GetSettings(ctx, sqlDB, u, ws); err != nil || s != (Settings{ExplanationLanguage: "en"}) {
		t.Errorf("defaults = %+v (%v)", s, err)
	}
	if _, err := PutSettings(ctx, sqlDB, u, ws, Settings{ExplanationLanguage: "klingon"}); err == nil {
		t.Error("unknown language accepted")
	}
	if _, err := PutSettings(ctx, sqlDB, u, ws, Settings{Guidance: strings.Repeat("g", MaxGuidanceRunes+1), ExplanationLanguage: "en"}); err == nil {
		t.Error("long guidance accepted")
	}
	want := Settings{Guidance: "be strict", ExplanationLanguage: "de"}
	if s, err := PutSettings(ctx, sqlDB, u, ws, want); err != nil || s != want {
		t.Errorf("put = %+v (%v)", s, err)
	}
	if s, err := GetSettings(ctx, sqlDB, u, ws); err != nil || s != want {
		t.Errorf("get = %+v (%v)", s, err)
	}
	if s, err := GetSettings(ctx, sqlDB, other, ws); err != nil || s != (Settings{ExplanationLanguage: "en"}) {
		t.Errorf("another user's view = %+v (%v)", s, err)
	}

	if s, err := GetSuggestions(ctx, sqlDB, u, ws); err != nil || s != nil {
		t.Errorf("no suggestions = %v (%v)", s, err)
	}
	doc := Suggestions{Items: []ai.SuggestionItem{{Title: "travel"}}, Model: "m", CreatedAt: "2026-11-20T09:00:00Z"}
	if err := PutSuggestions(ctx, sqlDB, u, ws, doc); err != nil {
		t.Fatal(err)
	}
	got, err := GetSuggestions(ctx, sqlDB, u, ws)
	if err != nil || got == nil || len(got.Items) != 1 || got.Items[0].Title != "travel" || got.Model != "m" {
		t.Errorf("suggestions = %+v (%v)", got, err)
	}
	if s, err := GetSuggestions(ctx, sqlDB, other, ws); err != nil || s != nil {
		t.Errorf("another user's suggestions = %v (%v)", s, err)
	}
}
