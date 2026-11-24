package workspaces_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lang"
	"qinqin/internal/workspaces"
)

func TestValidName(t *testing.T) {
	for raw, want := range map[string]string{
		"  Main  ":                       "Main",
		"":                               "",
		strings.Repeat("x", 40):          strings.Repeat("x", 40),
		"a‍b":                            "a‍b",                            // ZWJ builds visible text
		"a‌b":                            "a‌b",                            // ZWNJ
		"\U0001F3F4\U000E0067\U000E007F": "\U0001F3F4\U000E0067\U000E007F", // tag characters
	} {
		if got, err := workspaces.ValidName(raw); err != nil || got != want {
			t.Errorf("ValidName(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	for raw, reason := range map[string]string{
		strings.Repeat("x", 41): "name is longer than 40 characters",
		"a\tb":                  "name contains control or invisible characters",
		"a​b":                   "name contains control or invisible characters",
		"a­b":                   "name contains control or invisible characters",
		"a‮b":                   "name contains control or invisible characters",
	} {
		_, err := workspaces.ValidName(raw)
		var ne *workspaces.NameError
		if !errors.As(err, &ne) || err.Error() != reason {
			t.Errorf("ValidName(%q) = %v, want NameError %q", raw, err, reason)
		}
	}
}

func TestCreate(t *testing.T) {
	lang.Register(lang.Zh{})
	db := dbtest.Open(t)
	ctx := context.Background()
	alice := dbtest.User(t, db, "alice")
	create := func(in workspaces.NewWorkspace) (workspaces.Workspace, error) {
		in.UserID = alice
		return workspaces.Create(ctx, db, in)
	}
	for _, c := range []struct {
		in   workspaces.NewWorkspace
		want error
	}{
		{workspaces.NewWorkspace{Language: "  "}, workspaces.ErrLanguageRequired},
		{workspaces.NewWorkspace{Language: "e s"}, workspaces.ErrInvalidLanguage},
		{workspaces.NewWorkspace{Language: "ko"}, workspaces.ErrUnknownLanguage},
	} {
		if _, err := create(c.in); !errors.Is(err, c.want) {
			t.Errorf("Create(%+v) = %v, want %v", c.in, err, c.want)
		}
	}
	var ne *workspaces.NameError
	if _, err := create(workspaces.NewWorkspace{Language: "zh", Name: "a\tb"}); !errors.As(err, &ne) {
		t.Errorf("bad name: %v", err)
	}
	ws, err := create(workspaces.NewWorkspace{Language: "ZH", Name: " Main "})
	if err != nil || ws.Language != "zh" || ws.Name != "Main" || string(ws.Settings) != "{}" || ws.UpdatedAt.IsZero() {
		t.Errorf("Create = %+v, %v", ws, err)
	}
	if _, err := create(workspaces.NewWorkspace{Language: "zh", Name: "Main"}); !errors.Is(err, workspaces.ErrExists) {
		t.Errorf("taken: %v", err)
	}
	// An administrator opens a new data-only language, which registers it.
	ko, err := create(workspaces.NewWorkspace{Language: "KO", Admin: true})
	if err != nil || ko.Language != "ko" {
		t.Fatalf("admin ko = %+v, %v", ko, err)
	}
	if ok, _ := lang.Exists(ctx, db, "ko"); !ok {
		t.Error("ko was not registered")
	}
	if _, err := create(workspaces.NewWorkspace{Language: "ko", Name: "Mine"}); err != nil {
		t.Errorf("now known: %v", err)
	}
	// A stored legacy spelling is kept as it is.
	if _, err := db.Exec(`INSERT INTO languages (code, name, updated_at) VALUES ('pt_br', 'pt', 't')`); err != nil {
		t.Fatal(err)
	}
	if ws, err := create(workspaces.NewWorkspace{Language: "pt_br"}); err != nil || ws.Language != "pt_br" {
		t.Errorf("legacy = %+v, %v", ws, err)
	}
	if ws, err := create(workspaces.NewWorkspace{Language: "es_MX", Admin: true}); err != nil || ws.Language != "es-mx" {
		t.Errorf("normalised = %+v, %v", ws, err)
	}
}

func TestListGivesDefaultsOnce(t *testing.T) {
	lang.Register(lang.Zh{})
	db := dbtest.Open(t)
	ctx := context.Background()
	alice := dbtest.User(t, db, "alice")
	if list, err := workspaces.List(ctx, db, alice); err != nil || list == nil || len(list) != 0 {
		t.Fatalf("no installed language: %+v, %v", list, err)
	}
	for _, q := range []string{
		`INSERT INTO languages (code, name, updated_at) VALUES ('es', 'Spanish', 't')`,
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at) VALUES (1, 'd', 'd', '1', 'l', 'a', 't')`,
		`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (1, 'es', 'word', 'hola', 't'), (2, 'zh', 'word', 'z', 't')`,
		`INSERT INTO senses (entry_id, dictionary_id, ord, updated_at) VALUES (1, 1, 0, 't'), (2, 1, 0, 't')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	list, err := workspaces.List(ctx, db, alice)
	if err != nil || len(list) != 2 || list[0].Language != "zh" || list[1].Language != "es" || list[0].Name != "" {
		t.Fatalf("defaults = %+v, %v; want zh (code pack) then es", list, err)
	}
	if _, err := workspaces.Delete(ctx, db, alice, list[0].ID); err != nil {
		t.Fatal(err)
	}
	again, err := workspaces.List(ctx, db, alice)
	if err != nil || len(again) != 1 || again[0].ID != list[1].ID {
		t.Errorf("after a delete = %+v, %v; a user with a workspace gets no defaults", again, err)
	}
}

func TestUpdate(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := dbtest.User(t, db, "alice"), dbtest.User(t, db, "bob")
	a1, a2 := dbtest.Workspace(t, db, alice, "zh"), dbtest.Workspace(t, db, alice, "ja")
	b1 := dbtest.Workspace(t, db, bob, "zh")
	name := func(s string) *string { return &s }

	ws, err := workspaces.Update(ctx, db, alice, a1, workspaces.Patch{Name: name(" Main "), Settings: []byte(`{"a":"1","b":{"c":2}}`)})
	if err != nil || ws.Name != "Main" || string(ws.Settings) != `{"a":"1","b":{"c":2}}` {
		t.Fatalf("Update = %+v, %v", ws, err)
	}
	ws, err = workspaces.Update(ctx, db, alice, a1, workspaces.Patch{Settings: []byte(`{"a":null,"b":{"d":3}}`)})
	var got map[string]any
	json.Unmarshal(ws.Settings, &got)
	if err != nil || ws.Name != "Main" || got["a"] != nil || len(got["b"].(map[string]any)) != 2 {
		t.Errorf("merge = %s, %v", ws.Settings, err)
	}
	if _, err := workspaces.Update(ctx, db, alice, b1, workspaces.Patch{Name: name("x")}); !errors.Is(err, workspaces.ErrNotFound) {
		t.Errorf("foreign: %v", err)
	}
	if _, err := workspaces.Update(ctx, db, alice, b1, workspaces.Patch{Settings: []byte(`{}`)}); !errors.Is(err, workspaces.ErrNotFound) {
		t.Errorf("foreign settings: %v", err)
	}
	var ne *workspaces.NameError
	if _, err := workspaces.Update(ctx, db, alice, a1, workspaces.Patch{Name: name(strings.Repeat("x", 41))}); !errors.As(err, &ne) {
		t.Errorf("long name: %v", err)
	}
	if _, err := db.Exec(`UPDATE workspaces SET language = 'zh' WHERE id = ?`, a2); err != nil {
		t.Fatal(err)
	}
	if _, err := workspaces.Update(ctx, db, alice, a2, workspaces.Patch{Name: name("Main")}); !errors.Is(err, workspaces.ErrExists) {
		t.Errorf("taken: %v", err)
	}
	big := `{"k":"` + strings.Repeat("s", workspaces.MaxSettings) + `"}`
	if _, err := workspaces.Update(ctx, db, alice, a1, workspaces.Patch{Settings: []byte(big)}); !errors.Is(err, workspaces.ErrSettingsTooLarge) {
		t.Errorf("too large: %v", err)
	}
	if ws, _ := workspaces.Update(ctx, db, alice, a1, workspaces.Patch{Name: name("Main")}); strings.Contains(string(ws.Settings), "sss") {
		t.Error("a refused patch changed the settings")
	}
}

func TestOwnedLanguageAndLanguages(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := dbtest.User(t, db, "alice"), dbtest.User(t, db, "bob")
	a1 := dbtest.Workspace(t, db, alice, "zh")
	dbtest.Workspace(t, db, alice, "es")
	if _, err := db.Exec(`INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, 'zh', 'second', '{}', 't')`, alice); err != nil {
		t.Fatal(err)
	}
	b1 := dbtest.Workspace(t, db, bob, "ja")
	if ok, err := workspaces.Owned(ctx, db, alice, a1); err != nil || !ok {
		t.Errorf("own = %v %v", ok, err)
	}
	for _, id := range []int64{b1, 999} {
		if ok, err := workspaces.Owned(ctx, db, alice, id); err != nil || ok {
			t.Errorf("Owned(%d) = %v %v", id, ok, err)
		}
		if _, err := workspaces.Language(ctx, db, alice, id); !errors.Is(err, workspaces.ErrNotFound) {
			t.Errorf("Language(%d) = %v", id, err)
		}
	}
	if l, err := workspaces.Language(ctx, db, alice, a1); err != nil || l != "zh" {
		t.Errorf("Language = %q %v", l, err)
	}
	if ls, err := workspaces.Languages(ctx, db, alice); err != nil || strings.Join(ls, ",") != "es,zh" {
		t.Errorf("Languages = %v %v", ls, err)
	}
	carol := dbtest.User(t, db, "carol")
	if ls, err := workspaces.Languages(ctx, db, carol); err != nil || ls == nil || len(ls) != 0 {
		t.Errorf("none = %#v %v", ls, err)
	}
}
