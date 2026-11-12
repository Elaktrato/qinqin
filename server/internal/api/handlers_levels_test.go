package api_test

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/levels"
	"qinqin/internal/model"
)

// levelsFixture is the shared levels pack fixture, relative to this
// package's test working directory.
const levelsFixture = "../levels/testdata/hsk-mini"

// schemeBody mirrors one element of GET /api/schemes.
type schemeBody struct {
	ID          int64       `json:"id"`
	PackID      string      `json:"packId"`
	Name        string      `json:"name"`
	Unit        string      `json:"unit"`
	Language    string      `json:"language"`
	Version     string      `json:"version"`
	License     string      `json:"license"`
	Attribution string      `json:"attribution"`
	Levels      []levelBody `json:"levels"`
}

// levelBody mirrors one level of a served scheme.
type levelBody struct {
	ID   int64  `json:"id"`
	Ord  int    `json:"ord"`
	Name string `json:"name"`
}

// badgeBody mirrors one badge of GET /api/entries/{id}.
type badgeBody struct {
	SchemeID   int64  `json:"schemeId"`
	SchemeName string `json:"schemeName"`
	LevelName  string `json:"levelName"`
	Derived    bool   `json:"derived"`
}

// schemeIDs are the entry ids TestSchemeRoutes refers to.
type schemeIDs struct {
	nihao, xiexie, yinhang int64 // the fixture's member words
	hao, fa                int64 // 好 is a derived member, 发 is unaffiliated
}

// seedSchemeEntries upserts the fixture scheme's words and characters.
func seedSchemeEntries(t *testing.T, st entries.Store) schemeIDs {
	t.Helper()
	upsert := func(kind, written, pinyin string) int64 {
		return mustUpsertEntry(t, st, &model.Entry{
			Language: "zh", Kind: kind, Written: written,
			Readings: []model.Reading{{Type: "pinyin", Value: pinyin}},
		})
	}
	return schemeIDs{
		nihao:   upsert("word", "你好", "nǐ hǎo"),
		xiexie:  upsert("word", "谢谢", "xiè xie"),
		yinhang: upsert("word", "银行", "yín háng"),
		hao:     upsert("character", "好", "hǎo"),
		fa:      upsert("character", "发", "fā"),
	}
}

// listSchemes fetches GET /api/schemes and returns its list.
func listSchemes(t *testing.T, tsURL string) []schemeBody {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, "/api/schemes", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/schemes: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var list []schemeBody
	decodeJSON(t, resp, &list)
	return list
}

// getEntryBody fetches GET /api/entries/{id} and decodes its body.
func getEntryBody(t *testing.T, tsURL string, id int64) entryBody {
	t.Helper()
	resp := getEntry(t, tsURL, "/api/entries/"+strconv.FormatInt(id, 10))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/entries/%d: status = %d, want %d", id, resp.StatusCode, http.StatusOK)
	}
	var body entryBody
	decodeJSON(t, resp, &body)
	return body
}

func TestSchemeRoutes(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	ctx := context.Background()
	ids := seedSchemeEntries(t, entries.Store{DB: sqlDB})

	// The admin layer dispatches levels packs by manifest type; the
	// fixture imports through the library like the seed CLI does.
	pack, err := dict.LoadPack(levelsFixture)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import fixture scheme: %v", err)
	}

	// The scheme list is public: name, unit, levels in pack order.
	list := listSchemes(t, ts.URL)
	if len(list) != 1 {
		t.Fatalf("GET /api/schemes = %+v, want one scheme", list)
	}
	s := list[0]
	if s.ID == 0 || s.PackID != "hsk-mini" || s.Name != "HSK mini" || s.Unit != "word" ||
		s.Language != "zh" || s.Version != "1.0" || s.License != "CC BY-SA 4.0" ||
		s.Attribution != "Qinqin test fixtures" {
		t.Errorf("served scheme = %+v, want the fixture pack's registry row", s)
	}
	if len(s.Levels) != 2 || s.Levels[0].Name != "1" || s.Levels[0].Ord != 0 ||
		s.Levels[1].Name != "2" || s.Levels[1].Ord != 1 {
		t.Errorf("served scheme levels = %+v, want 1 then 2 in pack order", s.Levels)
	}

	// Entry GET carries badges: the member word's direct one, its
	// character's derived one, and none for an unaffiliated entry.
	if body := getEntryBody(t, ts.URL, ids.nihao); len(body.Badges) != 1 ||
		body.Badges[0] != (badgeBody{SchemeID: s.ID, SchemeName: "HSK mini", LevelName: "1", Derived: false}) {
		t.Errorf("badges of 你好 = %+v, want HSK mini level 1", body.Badges)
	}
	if body := getEntryBody(t, ts.URL, ids.hao); len(body.Badges) != 1 ||
		body.Badges[0] != (badgeBody{SchemeID: s.ID, SchemeName: "HSK mini", LevelName: "1", Derived: true}) {
		t.Errorf("badges of 好 = %+v, want derived HSK mini level 1", body.Badges)
	}
	if body := getEntryBody(t, ts.URL, ids.fa); body.Badges == nil || len(body.Badges) != 0 {
		t.Errorf("badges of 发 = %+v, want an empty array", body.Badges)
	}

	// The PUT response carries badges too: it shares the entry body
	// shape with GET.
	admin := registerUser(t, ts.URL, "admin", "") // first user = instance admin
	put := doJSON(t, http.MethodPut, ts.URL, "/api/entries/"+strconv.FormatInt(ids.hao, 10),
		admin, map[string]any{})
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT /api/entries/%d: status = %d, want %d", ids.hao, put.StatusCode, http.StatusOK)
	}
	var putBody entryBody
	decodeJSON(t, put, &putBody)
	if len(putBody.Badges) != 1 || !putBody.Badges[0].Derived {
		t.Errorf("PUT response badges = %+v, want derived HSK mini level 1", putBody.Badges)
	}

	// Uninstall is admin-only: anonymous and non-admin calls are 403.
	bob := registerUser(t, ts.URL, "bob", admin)
	schemePath := "/api/admin/schemes/" + strconv.FormatInt(s.ID, 10)
	if resp := doJSON(t, http.MethodDelete, ts.URL, schemePath, "", nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("DELETE scheme without token: status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}
	if resp := doJSON(t, http.MethodDelete, ts.URL, schemePath, bob, nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("DELETE scheme as non-admin: status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}

	// Unknown and malformed ids are 404.
	for _, id := range []string{"999999", "NaN"} {
		if resp := doJSON(t, http.MethodDelete, ts.URL, "/api/admin/schemes/"+id, admin, nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("DELETE scheme %s: status = %d, want %d", id, resp.StatusCode, http.StatusNotFound)
		}
	}

	// Uninstall soft-deletes the scheme and its memberships; the
	// entries survive without badges.
	if resp := doJSON(t, http.MethodDelete, ts.URL, schemePath, admin, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE scheme: status = %d, want %d", resp.StatusCode, http.StatusNoContent)
	}
	if list := listSchemes(t, ts.URL); len(list) != 0 {
		t.Errorf("GET /api/schemes after uninstall = %+v, want empty", list)
	}
	if body := getEntryBody(t, ts.URL, ids.nihao); body.Badges == nil || len(body.Badges) != 0 {
		t.Errorf("badges of 你好 after uninstall = %+v, want an empty array", body.Badges)
	}
	if resp := getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(ids.nihao, 10)); resp.StatusCode != http.StatusOK {
		t.Errorf("GET entry after scheme uninstall: status = %d, want %d — entries survive",
			resp.StatusCode, http.StatusOK)
	}
	// The already-uninstalled scheme is 404.
	if resp := doJSON(t, http.MethodDelete, ts.URL, schemePath, admin, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("DELETE uninstalled scheme: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

// writeLevelsPack writes a json levels pack into a fresh temp directory
// and returns its path.
func writeLevelsPack(t *testing.T, id, levelsJSON string) string {
	t.Helper()
	dir := t.TempDir()
	manifest := `{"id":"` + id + `","name":"Empty scheme","version":"1.0","type":"levels",` +
		`"language":"zh","license":"CC BY-SA 4.0","attribution":"Qinqin test fixtures","format":"json"}`
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("write manifest.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "levels.json"), []byte(levelsJSON), 0o644); err != nil {
		t.Fatalf("write levels.json: %v", err)
	}
	return dir
}

// entryIDsOf returns the ids of es, for failure messages.
func entryIDsOf(es []model.Entry) []int64 {
	ids := make([]int64, len(es))
	for i, e := range es {
		ids[i] = e.ID
	}
	return ids
}

// schemeEntries fetches GET /api/schemes/{id}/entries with the given query
// and returns the decoded entries, failing on null or a non-200 status.
func schemeEntries(t *testing.T, tsURL string, id int64, query string) []model.Entry {
	t.Helper()
	path := "/api/schemes/" + strconv.FormatInt(id, 10) + "/entries" + query
	resp := getEntry(t, tsURL, path)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status = %d, want %d", path, resp.StatusCode, http.StatusOK)
	}
	var list []model.Entry
	decodeJSON(t, resp, &list)
	if list == nil {
		t.Errorf("GET %s body is null, want an array", path)
	}
	return list
}

func TestSchemeEntriesRoute(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	ctx := context.Background()
	st := entries.Store{DB: sqlDB}
	upsert := func(kind, written, pinyin string) int64 {
		return mustUpsertEntry(t, st, &model.Entry{
			Language: "zh", Kind: kind, Written: written,
			Readings: []model.Reading{{Type: "pinyin", Value: pinyin}},
		})
	}
	nihao := upsert("word", "你好", "nǐ hǎo")
	xiexie := upsert("word", "谢谢", "xiè xie")
	yinhang := upsert("word", "银行", "yín háng")
	ni := upsert("character", "你", "nǐ")
	hao := upsert("character", "好", "hǎo")
	xie := upsert("character", "谢", "xiè")
	yin := upsert("character", "银", "yín")
	xing := upsert("character", "行", "xíng")
	upsert("character", "发", "fā") // unaffiliated

	pack, err := dict.LoadPack(levelsFixture)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import fixture scheme: %v", err)
	}
	schemes := listSchemes(t, ts.URL)
	if len(schemes) != 1 {
		t.Fatalf("GET /api/schemes = %+v, want one scheme", schemes)
	}
	s := schemes[0]

	level1 := []int64{nihao, xiexie, ni, hao, xie}
	level2 := []int64{yinhang, yin, xing}
	slices.Sort(level1)
	slices.Sort(level2)

	// The route is public and lists members of every level — words and
	// derived characters — in level order, then entry id.
	all := schemeEntries(t, ts.URL, s.ID, "")
	wantAll := append(append([]int64{}, level1...), level2...)
	if ids := entryIDsOf(all); !slices.Equal(ids, wantAll) {
		t.Errorf("GET scheme entries ids = %v, want %v", ids, wantAll)
	}

	// The level filter narrows the list to one level.
	if ids := entryIDsOf(schemeEntries(t, ts.URL, s.ID, "?level=2")); !slices.Equal(ids, level2) {
		t.Errorf("GET scheme entries level 2 ids = %v, want %v", ids, level2)
	}

	// Unknown scheme, malformed scheme id, and unknown level are 404.
	for _, path := range []string{
		"/api/schemes/999999/entries",
		"/api/schemes/NaN/entries",
		"/api/schemes/" + strconv.FormatInt(s.ID, 10) + "/entries?level=3",
	} {
		if resp := getEntry(t, ts.URL, path); resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: status = %d, want %d", path, resp.StatusCode, http.StatusNotFound)
		}
	}

	// A scheme whose only level has no members answers an empty array,
	// never null.
	emptyPack, err := dict.LoadPack(writeLevelsPack(t, "empty-scheme",
		`{"unit":"word","levels":[{"name":"1","entries":["电脑"]}]}`))
	if err != nil {
		t.Fatalf("load empty pack: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, emptyPack); err != nil {
		t.Fatalf("import empty scheme: %v", err)
	}
	var emptyID int64
	for _, sc := range listSchemes(t, ts.URL) {
		if sc.PackID == "empty-scheme" {
			emptyID = sc.ID
		}
	}
	if emptyID == 0 {
		t.Fatalf("GET /api/schemes has no empty-scheme entry")
	}
	for _, query := range []string{"", "?level=1"} {
		if got := schemeEntries(t, ts.URL, emptyID, query); len(got) != 0 {
			t.Errorf("GET empty scheme entries %q = %v, want an empty array", query, entryIDsOf(got))
		}
	}
}
