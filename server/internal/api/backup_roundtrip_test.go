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
	put(w.wsZh, fmt.Sprintf("card:c-vocab-%d", w.e1), fmt.Sprintf(`{"id":"c-vocab-%d","kind":"vocab","entryId":%d,"deckIds":["general"],"createdAt":"2026-11-10T08:00:00Z"}`, w.e1, w.e1))
	put(w.wsZh, fmt.Sprintf("card:c-reverse-%d", w.e1), fmt.Sprintf(`{"id":"c-reverse-%d","kind":"reverse","entryId":%d,"deckIds":["general"]}`, w.e1, w.e1))
	put(w.wsZh, "card:SENT0000000000000000000001", fmt.Sprintf(`{"id":"SENT0000000000000000000001","kind":"sentence","entryId":%d,"sentenceId":%d,"deckIds":[]}`, w.e1, sent.ID))
	put(w.wsJa, "deck:kana", `{"id":"kana","name":"Kana","createdAt":"2026-11-10T08:00:00Z"}`)
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
	// bob has data of his own
	wsB := createWorkspace(t, e.ts.URL, w.bob, "zh", "")
	doRaw(t, "PUT", e.ts.URL, "/api/plugins/qinqin-flashcards/data/card:bobs?workspace="+itoa(wsB), w.bob, `{"id":"bobs"}`)
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
		out = append(out, "BM "+stripIDs(string(bm)), "HL "+stripIDs(string(hl)))
		out = append(out, "CH "+fmt.Sprint(getJSON(t, e.ts.URL, fmt.Sprintf("/api/library/books/%d/chapters/0", id), w.alice)))
	}
	ent := getJSON(t, e.ts.URL, fmt.Sprintf("/api/entries/%d", w.e1), w.alice).(map[string]any)
	out = append(out, fmt.Sprintf("ENTRY written=%v", ent["written"]))
	tz, _ := json.Marshal(getJSON(t, e.ts.URL, "/api/me/time-zone", w.alice))
	out = append(out, "TZ "+string(tz))
	sort.Strings(out)
	return strings.Join(out, "\n")
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
	doRaw(t, "DELETE", w.ts.URL, fmt.Sprintf("/api/plugins/qinqin-flashcards/data/card:c-vocab-%d?workspace=%d", w.e1, w.wsZh), w.alice, "")
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
	rows := getJSON(t, b.ts.URL, "/api/plugins/qinqin-flashcards/data?workspace="+itoa(zh.ID)+"&prefix=card:", b.alice).([]any)
	keys := map[string]map[string]any{}
	for _, x := range rows {
		m := x.(map[string]any)
		keys[m["key"].(string)] = m["data"].(map[string]any)
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
