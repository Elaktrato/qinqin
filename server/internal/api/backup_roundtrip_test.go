package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"qinqin/internal/library"
)

type rtWorld struct {
	*backupEnv
	alice, bob string
	aliceID    int64
	e1, e2     int64
	wsZh, wsJa int64
}

// newRTWorld builds a server: dictionary entries (ids shifted by `shift` dummies),
// two users, and for alice workspaces, cards, reviews, an overlay, an own sentence,
// a library book with bookmark and highlight, a vacation period and a time zone.
func newRTWorld(t *testing.T, shift int) *rtWorld {
	t.Helper()
	e := newBackupEnv(t)
	e.db.Exec(`INSERT INTO languages (code, name, updated_at) VALUES ('ja', 'Japanese', '2026-01-01T00:00:00Z')`)
	for i := 0; i < shift; i++ {
		e.db.Exec(`INSERT INTO entries (language, kind, ext_key, updated_at) VALUES ('zh', 'word', ?, '2026-01-01T00:00:00Z')`, fmt.Sprintf("dummy-%d", i))
	}
	mk := func(ext, written string) int64 {
		res, err := e.db.Exec(`INSERT INTO entries (language, kind, ext_key, updated_at) VALUES ('zh', 'word', ?, '2026-01-01T00:00:00Z')`, ext)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		e.db.Exec(`INSERT INTO forms (entry_id, text, ord, updated_at) VALUES (?, ?, 0, '2026-01-01T00:00:00Z')`, id, written)
		return id
	}
	w := &rtWorld{backupEnv: e}
	w.e1, w.e2 = mk("cc-1", "你好"), mk("cc-2", "世界")
	w.alice = registerUser(t, e.ts.URL, "alice", "")
	w.bob = registerUser(t, e.ts.URL, "bobby", w.alice)
	w.aliceID = userID(t, e.db, "alice")
	return w
}

func (w *rtWorld) seedAlice(t *testing.T) {
	t.Helper()
	e := w.backupEnv
	w.wsZh = createWorkspace(t, e.ts.URL, w.alice, "zh", "")
	w.wsJa = createWorkspace(t, e.ts.URL, w.alice, "ja", "kana")
	// an own sentence on entry 1 (new id), cards of three kinds, a vacation row
	var sent struct {
		ID int64 `json:"id"`
	}
	r := doJSON(t, "POST", e.ts.URL, fmt.Sprintf("/api/entries/%d/sentences", w.e1), w.alice, map[string]string{"hanzi": "你好吗", "pinyin": "nǐ hǎo ma", "translation": "how are you"})
	if r.StatusCode >= 300 {
		b, _ := io.ReadAll(r.Body)
		t.Fatalf("add sentence = %d %s", r.StatusCode, b)
	}
	decodeJSON(t, r, &sent)
	put := func(ws int64, key, body string) {
		t.Helper()
		path := "/api/plugins/qinqin-flashcards/data/" + key
		if ws != 0 {
			path += "?workspace=" + itoa(ws)
		}
		if r := doRaw(t, "PUT", e.ts.URL, path, w.alice, body); r.StatusCode != 200 {
			t.Fatalf("PUT %s = %d", key, r.StatusCode)
		}
	}
	card := func(ws int64, id, kind string, sentenceID any, decks []string) map[string]any {
		return map[string]any{"workspaceId": ws, "id": id, "kind": kind, "entryId": w.e1, "written": nil, "entryKind": nil,
			"sentenceId": sentenceID, "skipKinds": []string{}, "deckIds": decks, "createdAt": "2026-11-10T08:00:00Z", "extra": map[string]any{},
			"updatedAt": "2026-11-10T08:00:00Z"}
	}
	pushTyped(t, e, w.alice, map[string]any{
		"cards": []any{
			card(w.wsZh, fmt.Sprintf("c-vocab-%d", w.e1), "vocab", nil, []string{"general"}),
			card(w.wsZh, fmt.Sprintf("c-reverse-%d", w.e1), "reverse", nil, []string{"general"}),
			card(w.wsZh, "SENT0000000000000000000001", "sentence", sent.ID, []string{}),
		},
		"decks": []any{map[string]any{"workspaceId": w.wsJa, "id": "kana", "name": "Kana", "createdAt": "2026-11-10T08:00:00Z",
			"source": nil, "extra": map[string]any{}, "updatedAt": "2026-11-10T08:00:00Z"}},
	})
	put(0, "vacation:V0000000000000000000000001", fmt.Sprintf(`{"version":1,"id":"V0000000000000000000000001","start":"2026-12-20","end":null,"scope":{"workspaces":[%d]},"createdDay":"2026-11-15","createdAt":"2026-11-15T10:00:00Z"}`, w.wsZh))
	evs := []map[string]any{
		{"id": "01JD0000000000000000000001", "workspaceId": w.wsZh, "device": "web", "ts": "2026-11-10T09:00:00Z", "type": "review", "payload": map[string]any{"cardId": fmt.Sprintf("c-vocab-%d", w.e1), "mode": "vocab", "grade": 3}},
		{"id": "01JD0000000000000000000002", "workspaceId": w.wsZh, "device": "web", "ts": "2026-11-10T09:01:00Z", "type": "review", "payload": map[string]any{"cardId": fmt.Sprintf("c-reverse-%d", w.e1), "mode": "reverse", "grade": 2}},
		{"id": "01JD0000000000000000000003", "workspaceId": w.wsZh, "device": "web", "ts": "2026-11-10T09:02:00Z", "type": "review", "payload": map[string]any{"cardId": "c-vocab-999999", "mode": "vocab", "grade": 1}},
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/events/batch", w.alice, map[string]any{"events": evs}); r.StatusCode != 200 {
		t.Fatalf("events = %d", r.StatusCode)
	}
	if r := doJSON(t, "PUT", e.ts.URL, fmt.Sprintf("/api/entries/%d", w.e1), w.alice, map[string]any{"written": "你好呀"}); r.StatusCode != 200 {
		t.Fatalf("overlay = %d", r.StatusCode)
	}
	if r := doJSON(t, "PUT", e.ts.URL, "/api/me/time-zone", w.alice, map[string]any{"zone": "Asia/Tokyo"}); r.StatusCode >= 300 {
		t.Fatalf("time zone = %d", r.StatusCode)
	}
	store := library.Store{DB: e.db, Dir: filepath.Join(e.data, "books")}
	b, err := store.Create(context.Background(), library.Book{UserID: w.aliceID, WorkspaceID: w.wsZh, Language: "zh", Title: "Tiny", Source: "upload", SourceID: "x1"},
		[]library.Chapter{{Title: "One", Paragraphs: []library.Paragraph{{{Text: "你好世界"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	book := fmt.Sprintf("/api/library/books/%d", b.ID)
	doJSON(t, "POST", e.ts.URL, book+"/bookmarks", w.alice, map[string]string{"position": "0:0", "label": "start"})
	doJSON(t, "POST", e.ts.URL, book+"/highlights", w.alice, map[string]any{"chapter": 0, "paragraph": 0, "start": 0, "end": 2, "text": "你好"})
	doJSON(t, "PUT", e.ts.URL, book+"/position", w.alice, map[string]string{"position": "0:3"})
	// a read event for the book (reads follow the NEW book id)
	doJSON(t, "POST", e.ts.URL, "/api/events/batch", w.alice, map[string]any{"events": []map[string]any{
		{"id": "01JD0000000000000000000004", "workspaceId": w.wsZh, "device": "web", "ts": "2026-11-10T10:00:00Z", "type": "read", "payload": map[string]any{"bookId": b.ID, "seconds": 90}}}})
	// a journal entry and the journal settings (#199: typed storage, keyed form in the archive)
	if r := doJSON(t, "PUT", e.ts.URL, "/api/journal/entries/J1?workspace="+itoa(w.wsZh), w.alice,
		map[string]any{"date": "2026-11-10", "title": "Day", "text": "今天很好。", "source": "typed", "createdAt": "2026-11-10T08:00:00Z"}); r.StatusCode != 200 {
		t.Fatalf("journal entry = %d", r.StatusCode)
	}
	if r := doJSON(t, "PUT", e.ts.URL, "/api/journal/settings?workspace="+itoa(w.wsZh), w.alice,
		map[string]any{"guidance": "short", "explanationLanguage": "de"}); r.StatusCode != 200 {
		t.Fatalf("journal settings = %d", r.StatusCode)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/grammar/progress?workspace="+itoa(w.wsZh), w.alice,
		map[string]any{"packId": "zh-grammar", "lessonId": "le-change", "score": 2, "total": 3}); r.StatusCode != 200 {
		t.Fatalf("grammar progress = %d", r.StatusCode)
	}
	// bob has data of his own
	wsB := createWorkspace(t, e.ts.URL, w.bob, "zh", "")
	pushTyped(t, e, w.bob, map[string]any{"cards": []any{map[string]any{"workspaceId": wsB, "id": "bobs", "kind": "vocab", "entryId": 1,
		"written": nil, "entryKind": nil, "sentenceId": nil, "skipKinds": []string{}, "deckIds": []string{}, "createdAt": "2026-11-10T08:00:00Z",
		"extra": map[string]any{}, "updatedAt": "2026-11-10T08:00:00Z"}}})
}

func getJSON(t *testing.T, base, path, token string) any {
	t.Helper()
	status, _, body := getRaw(t, base, path, token)
	if status != 200 {
		t.Fatalf("GET %s = %d %s", path, status, body)
	}
	var v any
	json.Unmarshal(body, &v)
	return v
}

// snapshot reads alice's data through the API and normalises workspace and
// book ids to names, so snapshots of different ids compare equal.
func (w *rtWorld) snapshot(t *testing.T, mapEntry func(float64) string) string {
	t.Helper()
	e := w.backupEnv
	var out []string
	wsList := getJSON(t, e.ts.URL, "/api/workspaces", w.alice).([]any)
	name := map[float64]string{}
	for _, x := range wsList {
		m := x.(map[string]any)
		name[m["id"].(float64)] = fmt.Sprintf("%v/%v", m["language"], m["name"])
		out = append(out, fmt.Sprintf("WS %v/%v %v", m["language"], m["name"], m["settings"]))
	}
	sub := func(s string) string {
		for id, n := range name {
			s = strings.ReplaceAll(s, fmt.Sprintf(`"workspaces":[%d]`, int64(id)), `"workspaces":["`+n+`"]`)
		}
		return s
	}
	scopes := []string{""}
	for id := range name {
		scopes = append(scopes, fmt.Sprintf("?workspace=%d", int64(id)))
	}
	for _, sc := range scopes {
		rows := getJSON(t, e.ts.URL, "/api/plugins/qinqin-flashcards/data"+sc, w.alice).([]any)
		for _, x := range rows {
			m := x.(map[string]any)
			b, _ := json.Marshal(m["data"])
			out = append(out, fmt.Sprintf("PD %q %v %s", sc2name(sc, name), m["key"], mapEntryIDs(sub(string(b)), mapEntry)))
		}
	}
	for id, n := range name {
		q := fmt.Sprintf("?workspace=%d", int64(id))
		for _, x := range getJSON(t, e.ts.URL, "/api/journal/entries"+q, w.alice).([]any) {
			m := x.(map[string]any)
			delete(m, "updatedAt") // the restore's write stamp
			b, _ := json.Marshal(m)
			out = append(out, fmt.Sprintf("JE ws=%s %s", n, b))
		}
		b, _ := json.Marshal(getJSON(t, e.ts.URL, "/api/journal/settings"+q, w.alice))
		out = append(out, fmt.Sprintf("JS ws=%s %s", n, b))
		gp, _ := json.Marshal(getJSON(t, e.ts.URL, "/api/grammar/progress"+q, w.alice))
		out = append(out, fmt.Sprintf("GP ws=%s %s", n, gp))
	}
	for _, r := range typedRows(t, e, w.alice) {
		ws := name[r.row["workspaceId"].(float64)]
		for _, meta := range []string{"workspaceId", "version", "updatedAt", "deletedAt"} {
			delete(r.row, meta)
		}
		b, _ := json.Marshal(r.row)
		out = append(out, fmt.Sprintf("TY %s ws=%s %s", r.coll, ws, mapEntryIDs(string(b), mapEntry)))
	}
	evs := getJSON(t, e.ts.URL, "/api/events", w.alice).([]any)
	books := getJSON(t, e.ts.URL, "/api/library/books", w.alice).([]any)
	bookName := map[float64]string{}
	for _, x := range books {
		m := x.(map[string]any)
		bookName[m["id"].(float64)] = m["title"].(string)
	}
	for _, x := range evs {
		m := x.(map[string]any)
		b, _ := json.Marshal(m["payload"])
		p := mapEntryIDs(string(b), mapEntry)
		for id, n := range bookName {
			p = strings.ReplaceAll(p, fmt.Sprintf(`"bookId":%d`, int64(id)), `"bookId":"`+n+`"`)
		}
		out = append(out, fmt.Sprintf("EV %v ws=%s %v %v %s", m["id"], name[m["workspaceId"].(float64)], m["ts"], m["type"], p))
	}
	for _, x := range books {
		m := x.(map[string]any)
		id := int64(m["id"].(float64))
		out = append(out, fmt.Sprintf("BOOK %v ws=%s pos=%v chapters=%v", m["title"], name[m["workspaceId"].(float64)], m["position"], m["chapterCount"]))
		bm, _ := json.Marshal(getJSON(t, e.ts.URL, fmt.Sprintf("/api/library/books/%d/bookmarks", id), w.alice))
		hl, _ := json.Marshal(getJSON(t, e.ts.URL, fmt.Sprintf("/api/library/books/%d/highlights", id), w.alice))
		// updatedAt is a write stamp a restore resets (the restore time), like the ids.
		out = append(out, "BM "+stripStamps(stripIDs(string(bm))), "HL "+stripStamps(stripIDs(string(hl))))
		out = append(out, "CH "+fmt.Sprint(getJSON(t, e.ts.URL, fmt.Sprintf("/api/library/books/%d/chapters/0", id), w.alice)))
	}
	ent := getJSON(t, e.ts.URL, fmt.Sprintf("/api/entries/%d", w.e1), w.alice).(map[string]any)
	out = append(out, fmt.Sprintf("ENTRY written=%v", ent["written"]))
	tz, _ := json.Marshal(getJSON(t, e.ts.URL, "/api/me/time-zone", w.alice))
	out = append(out, "TZ "+string(tz))
	sort.Strings(out)
	return strings.Join(out, "\n")
}

// pushTyped pushes typed study rows (POST /api/sync/push).
func pushTyped(t *testing.T, e *backupEnv, token string, body map[string]any) {
	t.Helper()
	r := doJSON(t, "POST", e.ts.URL, "/api/sync/push", token, body)
	var res struct{ DataAccepted, DataRefused int }
	decodeJSON(t, r, &res)
	if r.StatusCode != 200 || res.DataRefused != 0 {
		t.Fatalf("typed push = %d %+v", r.StatusCode, res)
	}
}

type typedRow struct {
	coll string
	row  map[string]any
}

// typedRows is the caller's live typed study rows from a paged pull, by
// collection (the rows are backdated a minute first: a pull ships rows
// stamped before the current second only).
func typedRows(t *testing.T, e *backupEnv, token string) []typedRow {
	t.Helper()
	backdate(t, e.db.Exec)
	status, _, body := get(t, e.ts.URL, "/api/sync/pull?v=2&collections=cards,decks,deckSettings,limits,fsrsSets,fsrsActive", token)
	var page v2Page
	if status != 200 || json.Unmarshal(body, &page) != nil || page.More {
		t.Fatalf("typed pull = %d %s", status, body)
	}
	var out []typedRow
	for coll, list := range page.Collections {
		for _, raw := range list {
			var m map[string]any
			if err := json.Unmarshal(raw, &m); err != nil {
				t.Fatal(err)
			}
			out = append(out, typedRow{coll, m})
		}
	}
	return out
}

func sc2name(sc string, name map[float64]string) string {
	if sc == "" {
		return "global"
	}
	var id float64
	fmt.Sscanf(sc, "?workspace=%f", &id)
	return name[id]
}

// mapEntryIDs rewrites entry ids (inside "entryId" fields and c-<kind>-<id> ids) to a stable label.
func mapEntryIDs(s string, mapEntry func(float64) string) string {
	if mapEntry == nil {
		return s
	}
	return mapEntry2(s, mapEntry)
}

func mapEntry2(s string, f func(float64) string) string { return rewriteIDs(s, f) }

var idRe = regexpMust(`(c-(?:vocab|sentence|writing|tone|reverse|cloze)-|"entryId":)(\d+)`)

func rewriteIDs(s string, f func(float64) string) string {
	return idRe.ReplaceAllStringFunc(s, func(m string) string {
		sub := idRe.FindStringSubmatch(m)
		var n float64
		fmt.Sscan(sub[2], &n)
		return sub[1] + f(n)
	})
}

func stripIDs(s string) string { return regexpMust(`"(id|bookId)":\d+,?`).ReplaceAllString(s, "") }

func stripStamps(s string) string { return regexpMust(`,?"updatedAt":"[^"]*"`).ReplaceAllString(s, "") }

func TestRoundTripOnTheSameServer(t *testing.T) {
	w := newRTWorld(t, 0)
	w.seedAlice(t)
	label := func(n float64) string {
		switch int64(n) {
		case w.e1:
			return "E1"
		case w.e2:
			return "E2"
		}
		return fmt.Sprint(int64(n))
	}
	before := w.snapshot(t, label)
	bobBefore := getJSON(t, w.ts.URL, "/api/workspaces", w.bob)
	archive := w.export(t, w.alice)
	// change everything afterwards
	pushTyped(t, w.backupEnv, w.alice, map[string]any{"cards": []any{map[string]any{"workspaceId": w.wsZh, "id": fmt.Sprintf("c-vocab-%d", w.e1),
		"kind": "vocab", "entryId": w.e1, "written": nil, "entryKind": nil, "sentenceId": nil, "skipKinds": []string{}, "deckIds": []string{"general"},
		"createdAt": "2026-11-10T08:00:00Z", "extra": map[string]any{}, "updatedAt": "2026-11-10T08:00:00Z", "deletedAt": "2026-11-11T08:00:00Z"}}})
	doJSON(t, "PUT", w.ts.URL, fmt.Sprintf("/api/entries/%d", w.e1), w.alice, map[string]any{"written": "ÄNDERUNG"})
	createWorkspace(t, w.ts.URL, w.alice, "zh", "later")
	doJSON(t, "DELETE", w.ts.URL, fmt.Sprintf("/api/workspaces/%d", w.wsJa), w.alice, nil)
	if w.snapshot(t, label) == before {
		t.Fatal("the change had no effect")
	}
	code, rt, _ := w.upload(t, w.alice, archive)
	if code != 202 {
		t.Fatalf("upload %d", code)
	}
	w.wait(t)
	if c, eb := w.apply(t, w.alice, rt, map[string]any{"confirm": "alice", "password": "secret-pass-alice"}); c != 202 {
		t.Fatalf("apply %d %+v", c, eb)
	}
	w.wait(t)
	if _, v := w.status(t, w.alice, rt); v.Status != "done" {
		t.Fatalf("status %+v %+v", v.Status, v.Error)
	}
	// a review of a card whose entry never existed is kept under orphan:<id>
	after := strings.ReplaceAll(w.snapshot(t, label), "orphan:", "")
	if after != before {
		t.Errorf("after the restore:\n%s\n--- before:\n%s", after, before)
	}
	// vacation (a user-global row) and bob
	if !strings.Contains(after, `PD "global" vacation:V0000000000000000000000001`) || !strings.Contains(after, `"workspaces":["zh/"]`) {
		t.Errorf("the user-global vacation row did not round-trip with its workspace remapped:\n%s", after)
	}
	bobAfter := getJSON(t, w.ts.URL, "/api/workspaces", w.bob)
	if fmt.Sprint(bobAfter) != fmt.Sprint(bobBefore) {
		t.Error("bob's workspaces changed")
	}
	// the read event follows the NEW book id
	if !strings.Contains(after, `"bookId":"Tiny"`) {
		t.Errorf("read event lost its book:\n%s", after)
	}
	if ents, _ := os.ReadDir(filepath.Join(w.data, "books", fmt.Sprint(w.aliceID))); len(ents) != 1 {
		t.Errorf("book files %d", len(ents))
	}
}

func TestRestoreOntoAnotherServerWithShiftedEntryIds(t *testing.T) {
	a := newRTWorld(t, 0)
	a.seedAlice(t)
	archive := a.export(t, a.alice)

	b := newRTWorld(t, 50) // the same words, other entry ids
	if b.e1 == a.e1 {
		t.Fatal("ids not shifted")
	}
	b.wsZh = createWorkspace(t, b.ts.URL, b.alice, "zh", "") // something to be replaced
	code, rt, _ := b.upload(t, b.alice, archive)
	if code != 202 {
		t.Fatalf("upload %d", code)
	}
	b.wait(t)
	_, v := b.status(t, b.alice, rt)
	if v.Status != "ready" || v.Report.Unresolved.EntryCount != 0 {
		t.Fatalf("status %s %+v", v.Status, v.Report)
	}
	if c, eb := b.apply(t, b.alice, rt, map[string]any{"confirm": "alice", "password": "secret-pass-alice"}); c != 202 {
		t.Fatalf("apply %d %+v", c, eb)
	}
	b.wait(t)
	if _, v := b.status(t, b.alice, rt); v.Status != "done" {
		t.Fatalf("status %+v %+v", v.Status, v.Error)
	}
	// every card points at the same WORD as on server A
	var zh struct{ ID int64 }
	for _, x := range getJSON(t, b.ts.URL, "/api/workspaces", b.alice).([]any) {
		m := x.(map[string]any)
		if m["language"] == "zh" {
			zh.ID = int64(m["id"].(float64))
		}
	}
	keys := map[string]map[string]any{}
	for _, r := range typedRows(t, b.backupEnv, b.alice) {
		if r.coll == "cards" && int64(r.row["workspaceId"].(float64)) == zh.ID {
			keys["card:"+r.row["id"].(string)] = r.row
		}
	}
	wantKeys := []string{fmt.Sprintf("card:c-vocab-%d", b.e1), fmt.Sprintf("card:c-reverse-%d", b.e1), "card:SENT0000000000000000000001"}
	for _, k := range wantKeys {
		d, ok := keys[k]
		if !ok {
			t.Fatalf("card %s missing; have %v", k, keys)
		}
		if int64(d["entryId"].(float64)) != b.e1 {
			t.Errorf("%s points at entry %v, want %d", k, d["entryId"], b.e1)
		}
		ent := getJSON(t, b.ts.URL, fmt.Sprintf("/api/entries/%d", int64(d["entryId"].(float64))), b.alice).(map[string]any)
		if !strings.HasPrefix(fmt.Sprint(ent["written"]), "你好") {
			t.Errorf("%s: the entry reads %v", k, ent["written"])
		}
		if id := d["id"].(string); id != strings.TrimPrefix(k, "card:") {
			t.Errorf("%s has id %s inside", k, id)
		}
	}
	// the old derived ids are gone; reviews follow the new ids or are orphans
	if _, ok := keys[fmt.Sprintf("card:c-vocab-%d", a.e1)]; ok {
		t.Error("an old derived card key survived")
	}
	valid := map[string]bool{fmt.Sprintf("c-vocab-%d", b.e1): true, fmt.Sprintf("c-reverse-%d", b.e1): true, "orphan:c-vocab-999999": true}
	for _, x := range getJSON(t, b.ts.URL, "/api/events", b.alice).([]any) {
		m := x.(map[string]any)
		if m["type"] != "review" {
			continue
		}
		cid := m["payload"].(map[string]any)["cardId"].(string)
		if !valid[cid] {
			t.Errorf("review of %s: not a card of the restored set", cid)
		}
	}
	// the overlay is on the target's entry, the own sentence too
	ent := getJSON(t, b.ts.URL, fmt.Sprintf("/api/entries/%d", b.e1), b.alice).(map[string]any)
	if ent["written"] != "你好呀" {
		t.Errorf("overlay: %v", ent["written"])
	}
	var sentOK bool
	var e1raw, _ = json.Marshal(getJSON(t, b.ts.URL, fmt.Sprintf("/api/entries/%d", b.e1), b.alice))
	sentOK = strings.Contains(string(e1raw), "你好吗")
	if !sentOK {
		t.Errorf("the own sentence is not on the target entry: %s", e1raw)
	}
	_ = http.StatusOK
}

func regexpMust(p string) *regexp.Regexp { return regexp.MustCompile(p) }
