package lang_test

import (
	"context"
	"database/sql"
	"errors"
	"maps"
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lang"
)

func exec(t *testing.T, db *sql.DB, stmts ...string) {
	t.Helper()
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
}

// seedInstalled gives es a live sense in a live dictionary (installed), ko
// only a dead dictionary and fr only a dead sense (neither installed).
func seedInstalled(t *testing.T, db *sql.DB) {
	exec(t, db,
		`INSERT INTO languages (code, name, updated_at) VALUES ('es', 'Spanish', 't'), ('ko', 'Korean', 't'), ('fr', 'French', 't')`,
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at) VALUES (1, 'es', 'es', '1', 'l', 'a', 't'), (3, 'fr', 'fr', '1', 'l', 'a', 't')`,
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at, deleted_at) VALUES (2, 'ko', 'ko', '1', 'l', 'a', 't', 't')`,
		`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (1, 'es', 'word', 'hola', 't'), (2, 'ko', 'word', 'k', 't'), (3, 'fr', 'word', 'f', 't'), (4, 'de', 'word', 'hallo', 't')`,
		`INSERT INTO senses (entry_id, dictionary_id, ord, updated_at) VALUES (1, 1, 0, 't'), (2, 2, 0, 't'), (4, 1, 0, 't')`,
		`INSERT INTO senses (entry_id, dictionary_id, ord, updated_at, deleted_at) VALUES (3, 3, 0, 't', 't')`,
	)
}

func TestInstalledLanguages(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	if got, err := lang.Installed(ctx, db); err != nil || len(got) != 0 || got == nil {
		t.Fatalf("empty = %#v, %v; want an empty list", got, err)
	}
	seedInstalled(t, db)
	got, err := lang.Installed(ctx, db)
	want := []lang.Info{{Code: "de", Name: "de", Installed: true}, {Code: "es", Name: "Spanish", Installed: true}}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Errorf("Installed = %+v, %v; want %+v", got, err, want)
	}
}

// TestInstalledLanguagesPlan pins the installed-languages query to index
// seeks: it runs on every GET /api/languages and on a new user's first
// GET /api/workspaces, so it must not scan every entry or sense.
func TestInstalledLanguagesPlan(t *testing.T) {
	db := dbtest.Open(t)
	plan, err := lang.InstalledPlanForTest(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan) == 0 {
		t.Fatal("no plan")
	}
	// Only the CTE's own rows (one per language) may be scanned.
	for _, step := range plan {
		if strings.HasPrefix(step, "SCAN ") && step != "SCAN langs" {
			t.Errorf("plan step %q scans a table; plan = %q", step, plan)
		}
	}
}

func TestKnownLanguages(t *testing.T) {
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
	db := dbtest.Open(t)
	seedInstalled(t, db)
	exec(t, db, `INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (5, 'zh', 'word', 'z', 't')`,
		`INSERT INTO senses (entry_id, dictionary_id, ord, updated_at) VALUES (5, 1, 0, 't')`)
	got, err := lang.Known(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	want := []lang.Info{
		{Code: "de", Name: "de", Installed: true, Kind: lang.KindData},
		{Code: "es", Name: "Spanish", Installed: true, Kind: lang.KindData},
		{Code: "fr", Name: "French", Kind: lang.KindData},
		{Code: "ja", Name: "ja", Kind: lang.KindCode},
		{Code: "ko", Name: "Korean", Kind: lang.KindData},
		{Code: "zh", Name: "zh", Installed: true, Kind: lang.KindCode},
	}
	// Other tests may register more code packs; compare the codes above.
	var picked []lang.Info
	for _, li := range got {
		for _, w := range want {
			if li.Code == w.Code {
				picked = append(picked, li)
			}
		}
	}
	if !reflect.DeepEqual(picked, want) {
		t.Errorf("Known = %+v, want %+v", picked, want)
	}
}

func TestLanguageExists(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	seedInstalled(t, db)
	exec(t, db,
		`INSERT INTO schemes (id, pack_id, name, unit, version, language, license, attribution, updated_at) VALUES (1, 's', 'n', 'word', '1', 'sv', 'l', 'a', 't')`,
		`INSERT INTO schemes (id, pack_id, name, unit, version, language, license, attribution, updated_at, deleted_at) VALUES (2, 's2', 'n', 'word', '1', 'nl', 'l', 'a', 't', 't')`,
		`INSERT INTO frequency_packs (id, pack_id, name, version, language, license, attribution, ord, updated_at) VALUES (1, 'f', 'n', '1', 'it', 'l', 'a', 1, 't')`,
		`INSERT INTO sentence_packs (pack_id, name, version, language, license, attribution, updated_at) VALUES ('sp', 'n', '1', 'pl', 'l', 'a', 't')`,
		`INSERT INTO grammar_packs (pack_id, name, version, language, license, attribution, levels_json, updated_at) VALUES ('g', 'n', '1', 'cs', 'l', 'a', '[]', 't')`,
		`INSERT INTO audio_packs (pack_id, language, name, version, license, attribution, created_at, updated_at) VALUES ('a', 'fi', 'n', '1', 'l', 'a', 't', 't')`,
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, language, updated_at) VALUES (9, 'pt', 'pt', '1', 'l', 'a', 'pt', 't')`,
	)
	for code, want := range map[string]bool{
		"es": true, "ko": true, "fr": true, // languages rows
		"de": true,                                                             // installed data only
		"sv": true, "it": true, "pl": true, "cs": true, "fi": true, "pt": true, // live packs
		"nl": false, "xx": false, "ES": false, // a dead pack; unknown; compared exactly
	} {
		if got, err := lang.Exists(ctx, db, code); err != nil || got != want {
			t.Errorf("Exists(%q) = %v, %v; want %v", code, got, err, want)
		}
	}
}

func TestAddDataLanguage(t *testing.T) {
	lang.Register(lang.Zh{})
	db := dbtest.Open(t)
	ctx := context.Background()
	if _, _, err := lang.AddData(ctx, db, "e s"); !errors.Is(err, lang.ErrInvalidCode) {
		t.Errorf("bad code: %v, want ErrInvalidCode", err)
	}
	var builtIn *lang.BuiltInError
	if _, _, err := lang.AddData(ctx, db, " ZH "); !errors.As(err, &builtIn) || builtIn.Code != "zh" || err.Error() != "zh is built in." {
		t.Errorf("built in: %v, want BuiltInError zh", err)
	}
	li, created, err := lang.AddData(ctx, db, "PT_br")
	if err != nil || !created || li != (lang.Info{Code: "pt-br", Name: "pt-br", Kind: lang.KindData}) {
		t.Errorf("new = %+v %v %v", li, created, err)
	}
	li, created, err = lang.AddData(ctx, db, "pt-br")
	if err != nil || created || li.Code != "pt-br" {
		t.Errorf("again = %+v %v %v, want not created", li, created, err)
	}
	// The plain row insert keeps a stored row (a workspace of a new language).
	if err := lang.AddDataRow(ctx, db, "pt-br"); err != nil {
		t.Fatal(err)
	}
	if err := lang.AddDataRow(ctx, db, "eo"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := lang.Exists(ctx, db, "eo"); !ok {
		t.Error("AddDataRow did not store eo")
	}
}

func TestLanguageUse(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	dbtest.User(t, db, "u")
	exec(t, db,
		`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (1, 'de', 'a', 't'), (1, 'de', 'b', 't')`,
		`INSERT INTO schemes (id, pack_id, name, unit, version, language, license, attribution, updated_at) VALUES (1, 's1', 'n', 'word', '1', 'de', 'l', 'a', 't'), (2, 's2', 'n', 'word', '1', 'de', 'l', 'a', 't')`,
		`INSERT INTO frequency_packs (id, pack_id, name, version, language, license, attribution, ord, updated_at) VALUES (1, 'f', 'n', '1', 'de', 'l', 'a', 1, 't')`,
		`INSERT INTO grammar_packs (pack_id, name, version, language, license, attribution, levels_json, updated_at) VALUES ('g', 'n', '1', 'de', 'l', 'a', '[]', 't')`,
		`INSERT INTO audio_packs (pack_id, language, name, version, license, attribution, created_at, updated_at) VALUES ('a', 'de', 'n', '1', 'l', 'a', 't', 't')`,
		`INSERT INTO sentence_packs (pack_id, name, version, language, license, attribution, updated_at) VALUES ('sp', 'n', '1', 'de', 'l', 'a', 't')`,
		`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at) VALUES (1, 'd', 'd', '1', 'l', 'a', 't')`,
		`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (1, 'de', 'word', 'hallo', 't')`,
		`INSERT INTO senses (entry_id, dictionary_id, ord, updated_at) VALUES (1, 1, 0, 't')`,
		`INSERT INTO sentences (entry_id, source_pack, hanzi, pinyin, translation, updated_at) VALUES (1, 'old-b', 'h', 'h', 'h', 't'), (1, 'old-a', 'h', 'h', 'h', 't'), (1, 'sp', 'h', 'h', 'h', 't'), (1, '', 'h', 'h', 'h', 't')`,
	)
	u, err := lang.Use(ctx, db, "de")
	if err != nil {
		t.Fatal(err)
	}
	wantCounts := map[string]int{"workspaces": 2, "dictionaries": 1, "levelLists": 2, "frequencyPacks": 1,
		"sentencePacks": 1, "grammarPacks": 1, "audioPacks": 1, "legacySentences": 1}
	if !maps.Equal(u.Counts(), wantCounts) {
		t.Errorf("Counts = %v, want %v", u.Counts(), wantCounts)
	}
	wantText := "2 workspaces, installed dictionary data, 2 level lists, a frequency pack, a sentence pack, a grammar pack, an audio pack, " +
		"sentences from an older pack without a registry row (remove with DELETE /api/admin/sentences/old-a, DELETE /api/admin/sentences/old-b)"
	if got := u.Blockers(); got != wantText {
		t.Errorf("Blockers = %q\nwant      %q", got, wantText)
	}
	one, err := lang.Use(ctx, db, "xx")
	if err != nil || one.Blockers() != "" || one.InUse() {
		t.Errorf("unused = %+v %v", one, err)
	}
	exec(t, db, `INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (1, 'yy', '', 't')`)
	if one, _ := lang.Use(ctx, db, "yy"); one.Blockers() != "1 workspace" || !one.InUse() {
		t.Errorf("one workspace = %q", one.Blockers())
	}
}

func TestRemoveDataLanguage(t *testing.T) {
	lang.Register(lang.Zh{})
	db := dbtest.Open(t)
	ctx := context.Background()
	dbtest.User(t, db, "u")
	exec(t, db,
		`INSERT INTO languages (code, name, updated_at) VALUES ('fr', 'fr', 't'), ('ES', 'es', 't'), ('Odd_Code', 'o', 't'), ('de', 'de', 't'), ('zh', 'zh', 't')`,
		`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (1, 'de', '', 't')`,
	)
	if err := lang.Remove(ctx, db, "xx"); !errors.Is(err, lang.ErrNotFound) {
		t.Errorf("unknown: %v", err)
	}
	var builtIn *lang.BuiltInError
	if err := lang.Remove(ctx, db, "JA_x"); !errors.Is(err, lang.ErrNotFound) {
		t.Errorf("unknown odd: %v", err)
	}
	lang.Register(lang.Ja{})
	if err := lang.Remove(ctx, db, "JA"); !errors.As(err, &builtIn) || builtIn.Code != "ja" {
		t.Errorf("built in without a row: %v", err)
	}
	if err := lang.Remove(ctx, db, "zh"); !errors.As(err, &builtIn) || builtIn.Code != "zh" {
		t.Errorf("built in with a row: %v", err)
	}
	var inUse *lang.InUseError
	if err := lang.Remove(ctx, db, "de"); !errors.As(err, &inUse) || inUse.Use.Blockers() != "1 workspace" {
		t.Errorf("in use: %v", err)
	}
	// The path value matches exactly, then lowercased: a stored ES is not "es".
	if err := lang.Remove(ctx, db, "es"); !errors.Is(err, lang.ErrNotFound) {
		t.Errorf("es for a stored ES: %v", err)
	}
	for _, code := range []string{"FR", "ES", "Odd_Code"} {
		if err := lang.Remove(ctx, db, code); err != nil {
			t.Errorf("Remove(%q) = %v", code, err)
		}
	}
	if err := lang.Remove(ctx, db, "fr"); !errors.Is(err, lang.ErrNotFound) {
		t.Errorf("again: %v", err)
	}
}

func TestWorkspacesPerLanguage(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	if got, err := lang.WorkspaceCounts(ctx, db); err != nil || got == nil || len(got) != 0 {
		t.Fatalf("empty = %#v %v", got, err)
	}
	dbtest.User(t, db, "u")
	dbtest.User(t, db, "v")
	exec(t, db,
		`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (1, 'zh', '', 't'), (2, 'zh', '', 't'), (1, 'es', '', 't')`,
	)
	got, err := lang.WorkspaceCounts(ctx, db)
	want := []lang.WorkspaceCount{{Code: "es", Workspaces: 1}, {Code: "zh", Workspaces: 2}}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Errorf("WorkspaceCounts = %+v %v, want %+v", got, err, want)
	}
}
