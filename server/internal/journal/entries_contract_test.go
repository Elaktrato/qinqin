package journal

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
)

// docs/contracts/journal/entries.json: what PUT of an entry and of the
// settings accepts, and how stored settings read.
func TestEntriesContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/journal/entries.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Puts []struct {
			Name string `json:"name"`
			ID   string `json:"id"`
			Body Entry  `json:"body"`
			OK   bool   `json:"ok"`
		} `json:"puts"`
		Limits struct {
			ID       string `json:"idPattern"`
			Title    int    `json:"titleCodePoints"`
			Text     int    `json:"textCodePoints"`
			Guidance int    `json:"guidanceCodePoints"`
		} `json:"limits"`
		Settings struct {
			Defaults  Settings `json:"defaults"`
			Languages []string `json:"explanationLanguages"`
			Puts      []struct {
				Name string   `json:"name"`
				Body Settings `json:"body"`
				OK   bool     `json:"ok"`
			} `json:"puts"`
			Reads []struct {
				Name   string          `json:"name"`
				Stored json.RawMessage `json:"stored"`
				Expect Settings        `json:"expect"`
			} `json:"reads"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Puts) < 10 || len(fx.Settings.Puts) < 3 {
		t.Fatalf("fixture too small: %d entry puts, %d settings puts", len(fx.Puts), len(fx.Settings.Puts))
	}
	if fx.Limits.ID != entryID.String() || fx.Limits.Title != MaxTitleRunes || fx.Limits.Text != MaxTextRunes || fx.Limits.Guidance != MaxGuidanceRunes {
		t.Errorf("limits %+v differ from the server's", fx.Limits)
	}
	if !slices.Equal(fx.Settings.Languages, ExplanationLanguages) {
		t.Errorf("explanation languages %v, server %v", fx.Settings.Languages, ExplanationLanguages)
	}
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u := dbtest.User(t, sqlDB, "alice")
	ws := dbtest.Workspace(t, sqlDB, u, "zh")
	for _, c := range fx.Puts {
		e := c.Body
		e.ID = c.ID
		got, err := PutEntry(ctx, sqlDB, u, ws, e)
		var inv *InvalidError
		switch {
		case c.OK && err != nil:
			t.Errorf("%s: refused: %v", c.Name, err)
		case c.OK && (got.Text != e.Text || got.Title != e.Title || (e.CreatedAt != "" && got.CreatedAt != e.CreatedAt)):
			t.Errorf("%s: stored %+v", c.Name, got)
		case !c.OK && !errors.As(err, &inv):
			t.Errorf("%s: %v, want a refusal", c.Name, err)
		}
	}
	if s, err := GetSettings(ctx, sqlDB, u, ws); err != nil || s != fx.Settings.Defaults {
		t.Errorf("defaults = %+v (%v), want %+v", s, err, fx.Settings.Defaults)
	}
	for _, c := range fx.Settings.Puts {
		_, err := PutSettings(ctx, sqlDB, u, ws, c.Body)
		if (err == nil) != c.OK {
			t.Errorf("settings %s: %v, ok %v", c.Name, err, c.OK)
		}
	}
	for _, c := range fx.Settings.Reads {
		var stored Settings
		if json.Unmarshal(c.Stored, &stored) != nil {
			continue // not an object: the table cannot hold it; the web case decodes it
		}
		if _, err := sqlDB.Exec(`INSERT INTO journal_settings (user_id, workspace_id, guidance, explanation_language, updated_at) VALUES (?, ?, ?, ?, 't')
			ON CONFLICT (user_id, workspace_id) DO UPDATE SET guidance = excluded.guidance, explanation_language = excluded.explanation_language`,
			u, ws, stored.Guidance, stored.ExplanationLanguage); err != nil {
			t.Fatal(err)
		}
		if s, err := GetSettings(ctx, sqlDB, u, ws); err != nil || s != c.Expect {
			t.Errorf("read %s = %+v (%v), want %+v", c.Name, s, err, c.Expect)
		}
	}
}
