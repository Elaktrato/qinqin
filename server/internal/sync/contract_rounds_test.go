package sync

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"qinqin/internal/auth"
	"qinqin/internal/dbtest"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

// The contract harness of the paged pull: docs/contracts/sync/pull-page.json
// (which pages are valid) and pull-rounds.json (scenarios over a fresh
// database each), both run against PullPage.

func readContract(dir, name string) ([]byte, error) {
	return os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", dir, name))
}

func contractFile(t *testing.T, name string, v any) {
	t.Helper()
	raw, err := readContract("sync", name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

// pageContract is pull-page.json minus its cases.
type pageContract struct {
	Collections      []string                   `json:"collections"`
	Moved            []string                   `json:"moved"`
	StudyCollections []string                   `json:"studyCollections"`
	Shapes           map[string]json.RawMessage `json:"shapes"`
	LibraryTombstone []string                   `json:"libraryTombstone"`
	Restartable      []string                   `json:"restartable"`
	Cases            []struct {
		Name      string          `json:"name"`
		Valid     bool            `json:"valid"`
		Reason    string          `json:"reason"`
		Requested []string        `json:"requested"`
		Position  string          `json:"position"`
		Page      json.RawMessage `json:"page"`
	} `json:"cases"`
}

func loadPageContract(t *testing.T) pageContract {
	t.Helper()
	var c pageContract
	contractFile(t, "pull-page.json", &c)
	return c
}

func keysOf(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sameKeys(m map[string]json.RawMessage, want []string) bool {
	w := slices.Clone(want)
	sort.Strings(w)
	return slices.Equal(keysOf(m), w)
}

func isNullJSON(raw json.RawMessage) bool { return string(bytes.TrimSpace(raw)) == "null" }

func isUTCTime(raw json.RawMessage) bool {
	var s string
	if json.Unmarshal(raw, &s) != nil || !strings.HasSuffix(s, "Z") {
		return false
	}
	_, err := time.Parse(time.RFC3339, s)
	return err == nil
}

// validatePage checks one page against the contract; position is first,
// middle, last, only or "" (not checked).
func (c pageContract) validatePage(raw json.RawMessage, requested []string, position string) error {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		return fmt.Errorf("not an object: %v", err)
	}
	if !sameKeys(top, []string{"format", "instanceId", "until", "scope", "restarted", "collections", "more", "next", "cursor"}) {
		return fmt.Errorf("unknown key or missing key: %v", keysOf(top))
	}
	if string(top["format"]) != "2" {
		return errors.New("format is 2")
	}
	var instance string
	if json.Unmarshal(top["instanceId"], &instance) != nil || len(instance) != 26 {
		return errors.New("instanceId is a 26-character ULID")
	}
	if _, err := ulid.ParseStrict(instance); err != nil {
		return errors.New("instanceId is a 26-character ULID")
	}
	if !isUTCTime(top["until"]) {
		return errors.New("until is an RFC 3339 UTC time")
	}
	if isNullJSON(top["scope"]) {
		if position == "first" || position == "only" {
			return errors.New("scope set on the first page")
		}
	} else {
		if position == "middle" || position == "last" {
			return errors.New("scope null after the first page")
		}
		var sc map[string]json.RawMessage
		if json.Unmarshal(top["scope"], &sc) != nil || !sameKeys(sc, []string{"workspaces", "languages", "catalogue"}) {
			return errors.New("scope has workspaces, languages, catalogue")
		}
		var ws []map[string]json.RawMessage
		if json.Unmarshal(sc["workspaces"], &ws) != nil || ws == nil {
			return errors.New("scope.workspaces is an array")
		}
		ids := []int64{}
		for _, w := range ws {
			if !sameKeys(w, []string{"id", "language"}) {
				return errors.New("scope workspace is {id, language}")
			}
			var id int64
			if json.Unmarshal(w["id"], &id) != nil {
				return errors.New("scope workspace id")
			}
			ids = append(ids, id)
		}
		if !slices.IsSorted(ids) {
			return errors.New("scope.workspaces sorted by id")
		}
		var langs []string
		if json.Unmarshal(sc["languages"], &langs) != nil || langs == nil || !slices.IsSorted(langs) || len(slices.Compact(slices.Clone(langs))) != len(langs) {
			return errors.New("scope.languages sorted, unique")
		}
		var cat string
		if json.Unmarshal(sc["catalogue"], &cat) != nil {
			return errors.New("scope.catalogue is a string")
		}
	}
	var restarted []string
	if isNullJSON(top["restarted"]) || json.Unmarshal(top["restarted"], &restarted) != nil {
		return errors.New("restarted is an array")
	}
	for _, r := range restarted {
		if !slices.Contains(c.Restartable, r) {
			return errors.New("restarted is a subset of [overlays, sentences]")
		}
	}
	var more bool
	if json.Unmarshal(top["more"], &more) != nil {
		return errors.New("more is a boolean")
	}
	var next, cursor *string
	if json.Unmarshal(top["next"], &next) != nil || json.Unmarshal(top["cursor"], &cursor) != nil {
		return errors.New("next and cursor are strings or null")
	}
	if more && (next == nil || cursor != nil) {
		return errors.New("a page with more has next and no cursor")
	}
	if !more && (next != nil || cursor == nil) {
		return errors.New("the last page has cursor and no next")
	}
	if next != nil && !strings.HasPrefix(*next, "p2.") {
		return errors.New("next starts with p2.")
	}
	if cursor != nil && !strings.HasPrefix(*cursor, "c2.") {
		return errors.New("cursor starts with c2.")
	}
	if position == "last" || position == "only" {
		if more {
			return errors.New("the last page has cursor and no next")
		}
	} else if position != "" && !more {
		return errors.New("a page with more has next and no cursor")
	}
	var colls map[string]json.RawMessage
	if json.Unmarshal(top["collections"], &colls) != nil {
		return errors.New("collections is an object")
	}
	for name := range colls {
		if !slices.Contains(requested, name) {
			return errors.New("only requested collections")
		}
	}
	for _, name := range requested {
		raw, ok := colls[name]
		if !ok {
			return errors.New("every requested collection key is present")
		}
		var list []json.RawMessage
		if isNullJSON(raw) || json.Unmarshal(raw, &list) != nil {
			return errors.New("collections are arrays")
		}
		for _, row := range list {
			if err := c.validateRow(name, row); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c pageContract) validateRow(coll string, raw json.RawMessage) error {
	if slices.Contains(rowsFamilies(), coll) {
		if _, err := rows.Decode(rows.Family(coll), raw); err != nil {
			return fmt.Errorf("typed rows decode strictly (study/rows.json): %v", err)
		}
		return nil
	}
	var keys []string
	if err := json.Unmarshal(c.Shapes[coll], &keys); err != nil {
		return fmt.Errorf("no shape for %s", coll)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return errors.New("row shape")
	}
	if coll == "books" || coll == "bookmarks" || coll == "highlights" {
		if del, ok := m["deletedAt"]; ok && !isNullJSON(del) {
			if !sameKeys(m, c.LibraryTombstone) || !isUTCTime(del) || string(m["updatedAt"]) != string(del) {
				return errors.New("a library tombstone is exactly {id, workspaceId, updatedAt, deletedAt}")
			}
			return nil
		}
		if !sameKeys(m, c.LibraryTombstone) && !sameKeys(m, keys) {
			return errors.New("row shape")
		}
		if sameKeys(m, c.LibraryTombstone) {
			return errors.New("a library tombstone is exactly {id, workspaceId, updatedAt, deletedAt}")
		}
	}
	if !sameKeys(m, keys) {
		return errors.New("row shape")
	}
	switch coll {
	case "events":
		var typ string
		json.Unmarshal(m["type"], &typ)
		if typ == "lookup" {
			return errors.New("events never carry type lookup")
		}
	case "sentences":
		if string(m["sourcePack"]) != `""` || isNullJSON(m["userId"]) {
			return errors.New(`sentences are own sentences (sourcePack "", userId set)`)
		}
	}
	return nil
}

func rowsFamilies() []string {
	out := []string{}
	for _, f := range rows.Families {
		out = append(out, string(f))
	}
	return out
}

func TestContractPullPage(t *testing.T) {
	c := loadPageContract(t)
	if !slices.Equal(c.Collections, V2Collections) {
		t.Errorf("collections = %v, V2Collections = %v", c.Collections, V2Collections)
	}
	if !slices.Equal(c.Moved, MovedCollections) {
		t.Errorf("moved = %v, MovedCollections = %v", c.Moved, MovedCollections)
	}
	if !slices.Equal(c.Restartable, v2Set.restartable) {
		t.Errorf("restartable = %v, want %v", c.Restartable, v2Set.restartable)
	}
	for _, tc := range c.Cases {
		err := c.validatePage(tc.Page, tc.Requested, tc.Position)
		switch {
		case tc.Valid && err != nil:
			t.Errorf("%s: refused: %v", tc.Name, err)
		case !tc.Valid && err == nil:
			t.Errorf("%s: accepted, want refused (%s)", tc.Name, tc.Reason)
		case !tc.Valid && err.Error() != tc.Reason && !strings.HasPrefix(err.Error(), tc.Reason):
			t.Errorf("%s: refused for %q, want %q", tc.Name, err, tc.Reason)
		}
		if tc.Valid {
			// A valid page decodes into Page and re-encodes to the same JSON value.
			var p Page
			dec := json.NewDecoder(bytes.NewReader(tc.Page))
			dec.DisallowUnknownFields()
			if err := dec.Decode(&p); err != nil {
				t.Errorf("%s: decode: %v", tc.Name, err)
				continue
			}
			out, _ := json.Marshal(p)
			var a, b any
			json.Unmarshal(out, &a)
			json.Unmarshal(tc.Page, &b)
			if fmt.Sprint(a) != fmt.Sprint(b) {
				t.Errorf("%s: re-encoded page differs:\n%s\n%s", tc.Name, out, tc.Page)
			}
		}
	}
}

// --- pull-rounds.json ---

type roundRow struct {
	Ref        string  `json:"ref"`
	User       string  `json:"user"`
	Collection string  `json:"collection"`
	Workspace  *string `json:"workspace"`
	Entry      string  `json:"entry"`
	Book       string  `json:"book"`
	Language   string  `json:"language"`
	UpdatedAt  string  `json:"updatedAt"`
	DeletedAt  string  `json:"deletedAt"`
	DataString int     `json:"dataString"`
	Type       string  `json:"type"`
	// Feature is the feature a features row switches (default journal).
	Feature string `json:"feature"`
}

type roundCase struct {
	Name  string `json:"name"`
	Setup struct {
		Workspaces []struct{ Ref, User, Language string } `json:"workspaces"`
		Entries    []struct{ Ref, Language string }       `json:"entries"`
		Rows       []roundRow                             `json:"rows"`
	} `json:"setup"`
	Requests []struct {
		Before []struct {
			Op  string   `json:"op"`
			Ref string   `json:"ref"`
			At  string   `json:"at"`
			Row roundRow `json:"row"`
		} `json:"before"`
		As     string                     `json:"as"`
		Now    string                     `json:"now"`
		Query  map[string]json.RawMessage `json:"query"`
		Expect struct {
			Status           int                 `json:"status"`
			Error            string              `json:"error"`
			Rows             map[string][]string `json:"rows"`
			Tombstones       []string            `json:"tombstones"`
			Scope            *bool               `json:"scope"`
			ScopeLanguages   []string            `json:"scopeLanguages"`
			ScopeWorkspaces  []string            `json:"scopeWorkspaces"`
			Restarted        []string            `json:"restarted"`
			CatalogueChanged *bool               `json:"catalogueChanged"`
			Keys             []string            `json:"keys"`
			More             *bool               `json:"more"`
			CursorAt         string              `json:"cursorAt"`
		} `json:"expect"`
	} `json:"requests"`
}

// world is one case's database and the ids behind its refs.
type world struct {
	t       *testing.T
	db      *sql.DB
	users   map[string]int64
	ws      map[string]int64 // workspace ref → id
	wsLang  map[int64]string
	entries map[string]int64
	plugin  string
	// rowsByRef: ref → where it lives; refOf: (collection, user, natural id) → ref.
	rowsByRef map[string]placed
	refOf     map[string]string
}

type placed struct {
	coll  string
	user  int64
	id    string // natural id on the wire
	rowid int64  // rowid in its table (library and typed rows)
	ws    int64
}

func refKey(coll string, user int64, id string) string {
	return fmt.Sprintf("%s|%d|%s", coll, user, id)
}

func (w *world) user(name string) int64 {
	if id, ok := w.users[name]; ok {
		return id
	}
	u, err := auth.CreateUser(context.Background(), w.db, name, "secret-pass-"+name, false)
	if err != nil {
		w.t.Fatal(err)
	}
	w.users[name] = u.ID
	return u.ID
}

func (w *world) exec(query string, args ...any) sql.Result {
	w.t.Helper()
	res, err := w.db.Exec(query, args...)
	if err != nil {
		w.t.Fatalf("%s: %v", query, err)
	}
	return res
}

func (w *world) place(ref string, p placed) {
	w.rowsByRef[ref] = p
	w.refOf[refKey(p.coll, p.user, p.id)] = ref
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (w *world) addWorkspace(ref, user, language, updatedAt string) {
	uid := w.user(user)
	res := w.exec(`INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, ?, ?, '{}', ?)`, uid, language, ref, updatedAt)
	id, _ := res.LastInsertId()
	w.ws[ref] = id
	w.wsLang[id] = language
	w.place(ref, placed{coll: "workspaces", user: uid, id: strconv.FormatInt(id, 10), ws: id})
}

func (w *world) addRow(r roundRow) {
	t := w.t
	t.Helper()
	if r.Collection == "workspaces" {
		w.addWorkspace(r.Ref, r.User, r.Language, r.UpdatedAt)
		return
	}
	uid := w.user(r.User)
	var wsID any
	var wsInt int64
	if r.Workspace != nil {
		id, ok := w.ws[*r.Workspace]
		if !ok {
			t.Fatalf("row %s: unknown workspace %s", r.Ref, *r.Workspace)
		}
		wsID, wsInt = id, id
	}
	entry := w.entries[r.Entry]
	switch r.Collection {
	case "features":
		feature := r.Feature
		if feature == "" {
			feature = "journal"
		}
		w.exec(`INSERT INTO feature_switches (user_id, feature, enabled, updated_at) VALUES (?, ?, 1, ?)`, uid, feature, r.UpdatedAt)
		w.place(r.Ref, placed{coll: r.Collection, user: uid, id: feature})
	case "rows":
		data := `{}`
		if r.DataString > 0 {
			data = `"` + strings.Repeat("x", r.DataString) + `"`
		}
		w.exec(`INSERT INTO keyed_rows (user_id, workspace_id, key, data, version, updated_at, deleted_at, modified_at)
			VALUES (?, ?, ?, ?, 1, ?, ?, ?)`, uid, wsID, r.Ref, data, r.UpdatedAt, nullIfEmpty(r.DeletedAt), r.UpdatedAt)
		w.place(r.Ref, placed{coll: r.Collection, user: uid, id: r.Ref, ws: wsInt})
	case "cards":
		card := &rows.Card{ID: r.Ref, Kind: "vocab", EntryID: entry, SkipKinds: []string{}, DeckIDs: []string{}, CreatedAt: r.UpdatedAt}
		card.WorkspaceID = wsInt
		var del *string
		if r.DeletedAt != "" {
			del = &r.DeletedAt
		}
		if err := study.InsertStored(context.Background(), w.db, uid, card, 1, r.UpdatedAt, r.UpdatedAt, del); err != nil {
			t.Fatal(err)
		}
		w.place(r.Ref, placed{coll: r.Collection, user: uid, id: r.Ref, ws: wsInt})
	case "books":
		res := w.exec(`INSERT INTO library_books (user_id, workspace_id, language, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			uid, wsID, w.wsLang[wsInt], r.Ref, r.UpdatedAt, r.UpdatedAt)
		id, _ := res.LastInsertId()
		w.place(r.Ref, placed{coll: r.Collection, user: uid, id: strconv.FormatInt(id, 10), rowid: id, ws: wsInt})
	case "bookmarks", "highlights":
		book := w.rowsByRef[r.Book]
		var res sql.Result
		if r.Collection == "bookmarks" {
			res = w.exec(`INSERT INTO library_bookmarks (user_id, book_id, position, label, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)`,
				uid, book.rowid, r.Ref, r.UpdatedAt, r.UpdatedAt)
		} else {
			res = w.exec(`INSERT INTO library_highlights (user_id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at)
				VALUES (?, ?, 0, 0, 0, 1, ?, 'yellow', '', ?, ?)`, uid, book.rowid, r.Ref, r.UpdatedAt, r.UpdatedAt)
		}
		id, _ := res.LastInsertId()
		w.place(r.Ref, placed{coll: r.Collection, user: uid, id: strconv.FormatInt(id, 10), rowid: id, ws: book.ws})
	case "overlays":
		w.exec(`INSERT INTO user_edits (user_id, entry_id, written, readings, updated_at) VALUES (?, ?, ?, NULL, ?)`, uid, entry, r.Ref, r.UpdatedAt)
		w.place(r.Ref, placed{coll: r.Collection, user: uid, id: strconv.FormatInt(entry, 10)})
	case "sentences":
		res := w.exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, deleted_at)
			VALUES (?, '', ?, ?, '', '', ?, ?)`, entry, uid, r.Ref, r.UpdatedAt, nullIfEmpty(r.DeletedAt))
		id, _ := res.LastInsertId()
		w.place(r.Ref, placed{coll: r.Collection, user: uid, id: strconv.FormatInt(id, 10)})
	case "events":
		id := ulid.Make().String()
		w.exec(`INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES (?, ?, ?, 'd', ?, ?, '{}', ?)`,
			id, uid, wsID, r.UpdatedAt, r.Type, r.UpdatedAt)
		w.place(r.Ref, placed{coll: r.Collection, user: uid, id: id, ws: wsInt})
	default:
		t.Fatalf("row %s: collection %s not handled by the harness", r.Ref, r.Collection)
	}
	if r.DeletedAt != "" && (r.Collection == "books" || r.Collection == "bookmarks" || r.Collection == "highlights") {
		w.delete(r.Ref, r.DeletedAt)
	}
}

var libraryTables = map[string]string{"books": "library_books", "bookmarks": "library_bookmarks", "highlights": "library_highlights"}

func (w *world) delete(ref, at string) {
	p := w.rowsByRef[ref]
	switch p.coll {
	case "rows":
		w.exec(`UPDATE keyed_rows SET deleted_at = ?, updated_at = ?, modified_at = ? WHERE key = ? AND user_id = ?`, at, at, at, p.id, p.user)
	case "cards":
		w.exec(`UPDATE study_cards SET deleted_at = ?, updated_at = ?, modified_at = ? WHERE id = ? AND user_id = ?`, at, at, at, p.id, p.user)
	case "sentences":
		w.exec(`UPDATE sentences SET deleted_at = ?, updated_at = ? WHERE id = ?`, at, at, p.id)
	case "books", "bookmarks", "highlights":
		w.exec(`DELETE FROM `+libraryTables[p.coll]+` WHERE id = ?`, p.rowid)
		w.exec(`INSERT INTO library_deletions (user_id, collection, row_id, workspace_id, deleted_at) VALUES (?, ?, ?, ?, ?)`, p.user, p.coll, p.rowid, p.ws, at)
	default:
		w.t.Fatalf("delete %s: collection %s has no tombstones", ref, p.coll)
	}
}

func (w *world) write(ref, at string) {
	p := w.rowsByRef[ref]
	switch p.coll {
	case "rows":
		w.exec(`UPDATE keyed_rows SET data = '{"w":1}', version = version + 1, updated_at = ?, modified_at = ? WHERE key = ? AND user_id = ?`, at, at, p.id, p.user)
	case "cards":
		w.exec(`UPDATE study_cards SET version = version + 1, updated_at = ?, modified_at = ? WHERE id = ? AND user_id = ?`, at, at, p.id, p.user)
	case "books", "bookmarks", "highlights":
		w.exec(`UPDATE `+libraryTables[p.coll]+` SET updated_at = ? WHERE id = ?`, at, p.rowid)
	default:
		w.t.Fatalf("write %s: collection %s not handled by the harness", ref, p.coll)
	}
}

// naturalID is the id the harness keys a wire row by.
func naturalID(coll string, row json.RawMessage) (string, bool, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(row, &m); err != nil {
		return "", false, err
	}
	field := map[string]string{"features": "id", "rows": "key", "overlays": "entryId"}[coll]
	if field == "" {
		field = "id"
	}
	id := strings.Trim(string(m[field]), `"`)
	dead := false
	if d, ok := m["deletedAt"]; ok && !isNullJSON(d) {
		dead = true
	}
	return id, dead, nil
}

func testCatalogue(_ context.Context, langs []string) (string, error) {
	return `"k-` + strings.Join(langs, ",") + `"`, nil
}

func errorCode(err error) (int, string) {
	switch {
	case err == nil:
		return 200, ""
	case errors.Is(err, ErrMoved):
		return 400, "sync_collection_moved"
	case errors.Is(err, ErrPageInvalid):
		return 400, "sync_page_invalid"
	case errors.Is(err, ErrCursorExpired):
		return 410, "sync_cursor_expired"
	case errors.Is(err, ErrNotFound):
		return 404, "not_found"
	}
	return 500, err.Error()
}

func TestContractPullRounds(t *testing.T) {
	var file struct {
		Defaults struct {
			WorkspaceUpdatedAt string `json:"workspaceUpdatedAt"`
			Plugin             string `json:"plugin"`
		} `json:"defaults"`
		Budget struct {
			Rows       struct{ Min, Max, Default int } `json:"rows"`
			Bytes      int                             `json:"bytes"`
			LagSeconds int                             `json:"lagSeconds"`
		} `json:"budget"`
		Cases []roundCase `json:"cases"`
	}
	contractFile(t, "pull-rounds.json", &file)
	if file.Budget.Rows.Min != 1 || file.Budget.Rows.Max != MaxPageLimit || file.Budget.Rows.Default != DefaultPageLimit ||
		file.Budget.Bytes != MaxPageBytes || time.Duration(file.Budget.LagSeconds)*time.Second != cursorMargin {
		t.Errorf("budget %+v differs from the code", file.Budget)
	}
	pc := loadPageContract(t)
	for _, tc := range file.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			sqlDB := dbtest.Open(t)
			w := &world{t: t, db: sqlDB, users: map[string]int64{}, ws: map[string]int64{}, wsLang: map[int64]string{},
				entries: map[string]int64{}, plugin: file.Defaults.Plugin, rowsByRef: map[string]placed{}, refOf: map[string]string{}}
			for _, u := range []string{"alice", "bob"} {
				w.user(u)
			}
			for _, ws := range tc.Setup.Workspaces {
				w.addWorkspace(ws.Ref, ws.User, ws.Language, file.Defaults.WorkspaceUpdatedAt)
			}
			for _, e := range tc.Setup.Entries {
				res := w.exec(`INSERT INTO entries (language, kind, ext_key, updated_at) VALUES (?, 'word', ?, '2026-01-01T00:00:00Z')`, e.Language, e.Ref)
				w.entries[e.Ref], _ = res.LastInsertId()
			}
			for _, r := range tc.Setup.Rows {
				w.addRow(r)
			}
			var cursor, nextTok, lastCatalogue string
			for i, rq := range tc.Requests {
				for _, op := range rq.Before {
					switch op.Op {
					case "write":
						w.write(op.Ref, op.At)
					case "delete":
						w.delete(op.Ref, op.At)
					case "insert":
						w.addRow(op.Row)
					default:
						t.Fatalf("request %d: op %s", i, op.Op)
					}
				}
				q := url.Values{}
				var requested []string
				for name, raw := range rq.Query {
					var s string
					switch name {
					case "collections":
						var list []string
						json.Unmarshal(raw, &list)
						requested = list
						s = strings.Join(list, ",")
					case "limit":
						s = strings.Trim(string(raw), `"`)
					case "workspace":
						json.Unmarshal(raw, &s)
						if id, ok := w.ws[s]; ok {
							s = strconv.FormatInt(id, 10)
						}
					case "tombstones":
						json.Unmarshal(raw, &s)
					case "since", "page":
						json.Unmarshal(raw, &s)
						switch s {
						case "$cursor":
							s = cursor
						case "$next":
							s = nextTok
						}
					}
					q.Set(name, s)
				}
				if requested == nil {
					requested = V2Collections
				}
				user := w.users[rq.As]
				now, err := time.Parse(time.RFC3339, rq.Now)
				if err != nil {
					t.Fatal(err)
				}
				req, err := ParsePageRequest(q)
				var page Page
				if err == nil {
					req.Now = now
					page, err = PullPage(context.Background(), sqlDB, user, req, testCatalogue)
				}
				status, code := errorCode(err)
				ex := rq.Expect
				if status != ex.Status || code != ex.Error {
					t.Fatalf("request %d (%v): %d %s (%v), want %d %s", i, q, status, code, err, ex.Status, ex.Error)
				}
				if status != 200 {
					continue
				}
				if q.Has("page") {
					requested = nil
					for name := range page.Collections {
						requested = append(requested, name)
					}
				}
				raw, _ := json.Marshal(page)
				position := ""
				switch {
				case !q.Has("page") && !page.More:
					position = "only"
				case !q.Has("page"):
					position = "first"
				case page.More:
					position = "middle"
				default:
					position = "last"
				}
				if err := pc.validatePage(raw, requested, position); err != nil {
					t.Errorf("request %d: page breaks the contract: %v", i, err)
				}
				if ex.Keys != nil && !sameKeys(page.Collections, ex.Keys) {
					t.Errorf("request %d: keys %v, want %v", i, keysOf(page.Collections), ex.Keys)
				}
				var dead []string
				for name, list := range page.Collections {
					var items []json.RawMessage
					json.Unmarshal(list, &items)
					got := []string{}
					for _, item := range items {
						id, isDead, err := naturalID(name, item)
						if err != nil {
							t.Fatal(err)
						}
						ref, ok := w.refOf[refKey(name, user, id)]
						if !ok {
							t.Errorf("request %d: %s row %s is not one of the caller's rows", i, name, id)
							ref = "?" + id
						}
						got = append(got, ref)
						if isDead {
							dead = append(dead, ref)
						}
					}
					wantRows := ex.Rows[name]
					if wantRows == nil {
						wantRows = []string{}
					}
					if !slices.Equal(got, wantRows) {
						t.Errorf("request %d: %s = %v, want %v", i, name, got, wantRows)
					}
				}
				for name := range ex.Rows {
					if _, ok := page.Collections[name]; !ok && len(ex.Rows[name]) > 0 {
						t.Errorf("request %d: no %s key", i, name)
					}
				}
				sort.Strings(dead)
				wantDead := slices.Clone(ex.Tombstones)
				if wantDead == nil {
					wantDead = []string{}
				}
				sort.Strings(wantDead)
				if dead == nil {
					dead = []string{}
				}
				if !slices.Equal(dead, wantDead) {
					t.Errorf("request %d: tombstones %v, want %v", i, dead, wantDead)
				}
				wantScope := !q.Has("page")
				if ex.Scope != nil {
					wantScope = *ex.Scope
				}
				if (page.Scope != nil) != wantScope {
					t.Errorf("request %d: scope %v, want set=%v", i, page.Scope, wantScope)
				}
				if page.Scope != nil {
					if ex.ScopeLanguages != nil && !slices.Equal(page.Scope.Languages, ex.ScopeLanguages) {
						t.Errorf("request %d: scope languages %v, want %v", i, page.Scope.Languages, ex.ScopeLanguages)
					}
					if ex.ScopeWorkspaces != nil {
						var got []string
						for _, ref := range page.Scope.Workspaces {
							got = append(got, w.refOf[refKey("workspaces", user, strconv.FormatInt(ref.ID, 10))])
						}
						if !slices.Equal(got, ex.ScopeWorkspaces) {
							t.Errorf("request %d: scope workspaces %v, want %v", i, got, ex.ScopeWorkspaces)
						}
					}
					if ex.CatalogueChanged != nil && (page.Scope.Catalogue != lastCatalogue) != *ex.CatalogueChanged {
						t.Errorf("request %d: catalogue %s after %s, want changed=%v", i, page.Scope.Catalogue, lastCatalogue, *ex.CatalogueChanged)
					}
					lastCatalogue = page.Scope.Catalogue
				}
				wantRestarted := ex.Restarted
				if wantRestarted == nil {
					wantRestarted = []string{}
				}
				if !slices.Equal(page.Restarted, wantRestarted) {
					t.Errorf("request %d: restarted %v, want %v", i, page.Restarted, wantRestarted)
				}
				if ex.More != nil && page.More != *ex.More {
					t.Errorf("request %d: more = %v, want %v", i, page.More, *ex.More)
				}
				if page.More {
					nextTok = *page.Next
				} else {
					cursor = *page.Cursor
					var ct cursorToken
					if err := decodeToken(cursorPrefix, cursor, &ct); err != nil {
						t.Fatalf("request %d: cursor: %v", i, err)
					}
					if ct.User != user {
						t.Errorf("request %d: cursor of user %d", i, ct.User)
					}
					if ex.CursorAt != "" && ct.Time != ex.CursorAt {
						t.Errorf("request %d: cursor at %s, want %s", i, ct.Time, ex.CursorAt)
					}
				}
			}
		})
	}
}
