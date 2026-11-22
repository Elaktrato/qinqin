package backup

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"

	"qinqin/internal/auth"
)

func deps(w *baseWorld) RestoreDeps {
	return RestoreDeps{DB: w.DB, DataDir: w.Data, Users: auth.NewUsers(w.DB)}
}

// canon turns an export into a text that is equal for equal user data: workspace and
// book ids are replaced by their names, row stamps that a restore resets are left out.
func canon(t *testing.T, data []byte) string {
	t.Helper()
	files, _ := unzipAll(t, data)
	for n, b := range files {
		files[n] = []byte(strings.ReplaceAll(string(b), "orphan:", "")) // an unresolvable review id is kept as orphan:<id>
	}
	var ws []map[string]any
	json.Unmarshal(files[NameWorkspaces], &ws)
	wsName := map[float64]string{}
	var out []string
	for _, w := range ws {
		wsName[w["id"].(float64)] = fmt.Sprintf("%v/%v", w["language"], w["name"])
		out = append(out, fmt.Sprintf("WS %v/%v %v", w["language"], w["name"], jsonOf(w["settings"])))
	}
	var books []map[string]any
	json.Unmarshal(files[NameBooks], &books)
	bookName := map[float64]string{}
	for _, b := range books {
		bookName[b["id"].(float64)] = b["title"].(string)
		out = append(out, fmt.Sprintf("BOOK %v ws=%s src=%v pos=%v file=%s", b["title"], wsName[b["workspaceId"].(float64)], b["sourceId"], b["position"], files[BookName(int64(b["id"].(float64)))]))
	}
	for name, b := range files {
		switch {
		case FamilyOf(name) == FamEvents:
			for _, l := range lines(b) {
				var e map[string]any
				json.Unmarshal([]byte(l), &e)
				out = append(out, fmt.Sprintf("EV %v ws=%s %v %v %s", e["id"], wsName[e["workspaceId"].(float64)], e["ts"], e["type"], jsonOf(e["payload"])))
			}
		case FamilyOf(name) == NamePluginData:
			for _, l := range lines(b) {
				var r map[string]any
				json.Unmarshal([]byte(l), &r)
				ws := "global"
				if r["workspaceId"] != nil {
					ws = wsName[r["workspaceId"].(float64)]
				}
				data := r["data"]
				if m, ok := data.(map[string]any); ok {
					if sc, ok := m["scope"].(map[string]any); ok {
						var names []string
						for _, id := range sc["workspaces"].([]any) {
							names = append(names, wsName[id.(float64)])
						}
						sort.Strings(names)
						m["scope"] = map[string]any{"workspaces": names}
					}
				}
				out = append(out, fmt.Sprintf("PD %v ws=%s %v %v v=%v mod=%v", r["pluginId"], ws, r["key"], jsonOf(data), r["version"], r["modifiedAt"]))
			}
		case FamilyOf(name) == NameOverlays:
			for _, l := range lines(b) {
				out = append(out, "OV "+l)
			}
		case FamilyOf(name) == NameSentences:
			for _, l := range lines(b) {
				var s map[string]any
				json.Unmarshal([]byte(l), &s)
				out = append(out, fmt.Sprintf("SE %v|%v|%v", s["hanzi"], s["pinyin"], s["translation"]))
			}
		case FamilyOf(name) == NameBookmarks:
			for _, l := range lines(b) {
				var x map[string]any
				json.Unmarshal([]byte(l), &x)
				out = append(out, fmt.Sprintf("BM %s %v %v", bookName[x["bookId"].(float64)], x["position"], x["label"]))
			}
		case FamilyOf(name) == NameHighlights:
			for _, l := range lines(b) {
				var x map[string]any
				json.Unmarshal([]byte(l), &x)
				out = append(out, fmt.Sprintf("HL %s %v %v %v %v", bookName[x["bookId"].(float64)], x["chapter"], x["startCp"], x["endCp"], x["text"]))
			}
		case name == NameAccount:
			out = append(out, "ACC "+string(b))
		}
	}
	sort.Strings(out)
	return strings.Join(out, "\n")
}

func jsonOf(v any) string { b, _ := json.Marshal(v); return string(b) }

func scramble(t *testing.T, w *baseWorld) (extraWS, extraBook int64) {
	t.Helper()
	uid := w.AliceUID
	exec(t, w.DB, `DELETE FROM study_events WHERE user_id = ? AND workspace_id = ?`, uid, w.Alice.WS1)
	exec(t, w.DB, `INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at) VALUES ('junk', ?, NULL, 'j', '{"junk":1}', 1, 't')`, uid)
	exec(t, w.DB, `UPDATE user_edits SET written = 'CHANGED' WHERE user_id = ?`, uid)
	exec(t, w.DB, `DELETE FROM user_time_zones WHERE user_id = ?`, uid)
	res, _ := w.DB.Exec(`INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, 'zh', 'Extra', '{}', 't')`, uid)
	extraWS, _ = res.LastInsertId()
	exec(t, w.DB, `INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES (?, ?, ?, 'd', '2026-11-13T00:00:00Z', 'view', '{}', 't')`, evID(uid, "Z"), uid, extraWS)
	res, _ = w.DB.Exec(`INSERT INTO library_books (user_id, workspace_id, language, title, created_at) VALUES (?, ?, 'zh', 'Extra book', 't')`, uid, extraWS)
	extraBook, _ = res.LastInsertId()
	os.WriteFile(filepath.Join(w.Data, "books", strconv.FormatInt(uid, 10), strconv.FormatInt(extraBook, 10)+".json"), []byte(`[]`), 0o644)
	exec(t, w.DB, `INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES ('keep', ?, 't', 't'), ('other', ?, 't', 't')`, uid, uid)
	exec(t, w.DB, `INSERT INTO access_tokens (user_id, name, token_hash, hint, scope, created_at, expires_at) VALUES (?, 'n', 'pat', 'abcdef', 'write', 't', '9999')`, uid)
	// a typed card written after the backup, a typed tombstone and a library deletion log row:
	// a restore replaces the first and clears the other two (clients pull in full afterwards)
	exec(t, w.DB, `INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, created_at, version, updated_at, modified_at)
		VALUES (?, ?, 'c-later', 'vocab', 1, 't', 1, '2026-11-15T00:00:00Z', '2026-11-15T00:00:00Z')`, uid, w.Alice.WS1)
	exec(t, w.DB, `INSERT INTO study_decks (user_id, workspace_id, id, name, created_at, version, updated_at, modified_at, deleted_at)
		VALUES (?, ?, 'd-gone-too', 'x', 't', 2, '2026-11-15T00:00:00Z', '2026-11-15T00:00:00Z', '2026-11-15T00:00:00Z')`, uid, w.Alice.WS1)
	exec(t, w.DB, `INSERT INTO library_deletions (user_id, collection, row_id, workspace_id, deleted_at) VALUES (?, 'books', 999, ?, '2026-11-15T00:00:00Z')`, uid, w.Alice.WS1)
	return
}

func TestRestoreReplacesTheUsersDataAndOnlyTheirs(t *testing.T) {
	w := newWorld(t)
	uid := w.AliceUID
	orig, _ := exportBytes(t, w, uid)
	bobBefore, _ := exportBytes(t, w, w.BobID)
	a := openExport(t, w, uid)
	extraWS, extraBook := scramble(t, w)
	var keepSession int64
	w.DB.QueryRow(`SELECT id FROM sessions WHERE token_hash = 'keep'`).Scan(&keepSession)
	var hashBefore string
	w.DB.QueryRow(`SELECT hash FROM users WHERE id = ?`, uid).Scan(&hashBefore)

	res, rep, err := Restore(context.Background(), deps(w), uid, keepSession, a, Options{})
	if err != nil {
		t.Fatalf("Restore: %v (%+v)", err, rep)
	}
	after, _ := exportBytes(t, w, uid)
	if got, want := canon(t, after), canon(t, orig); got != want {
		t.Errorf("restored data differs from the backup\n--- got\n%s\n--- want\n%s", got, want)
	}
	bobAfter, _ := exportBytes(t, w, w.BobID)
	if string(bobBefore) != string(bobAfter) && canon(t, bobBefore) != canon(t, bobAfter) {
		t.Error("another user's data changed")
	}
	// bob's rows are really untouched, ids included
	if string(bobAfter) == "" || !strings.Contains(string(mustUnzip(t, bobAfter)[NameWorkspaces]), fmt.Sprintf(`"id": %d`, w.Bob.WS1)) && !strings.Contains(string(mustUnzip(t, bobAfter)[NameWorkspaces]), fmt.Sprintf(`"id":%d`, w.Bob.WS1)) {
		t.Error("bob's workspace ids changed")
	}
	// old workspaces and everything scoped to them are gone, the archive's got NEW ids
	for _, q := range []string{
		fmt.Sprintf(`SELECT COUNT(*) FROM workspaces WHERE id IN (%d, %d, %d)`, w.Alice.WS1, w.Alice.WS2, extraWS),
		fmt.Sprintf(`SELECT COUNT(*) FROM study_events WHERE workspace_id IN (%d, %d, %d)`, w.Alice.WS1, w.Alice.WS2, extraWS),
		fmt.Sprintf(`SELECT COUNT(*) FROM library_books WHERE id IN (%d, %d)`, w.Alice.Book, extraBook),
		`SELECT COUNT(*) FROM plugin_data WHERE pack_id = 'junk'`,
		fmt.Sprintf(`SELECT COUNT(*) FROM journal_photos WHERE user_id = %d`, uid),
		fmt.Sprintf(`SELECT COUNT(*) FROM study_cards WHERE user_id = %d AND id = 'c-later'`, uid),
		fmt.Sprintf(`SELECT COUNT(*) FROM study_decks WHERE user_id = %d`, uid),
		fmt.Sprintf(`SELECT COUNT(*) FROM library_deletions WHERE user_id = %d`, uid),
		// typed families land in the typed tables, never in plugin_data
		fmt.Sprintf(`SELECT COUNT(*) FROM plugin_data WHERE user_id = %d AND pack_id = 'qinqin-flashcards' AND key LIKE 'card:%%'`, uid),
	} {
		var n int
		w.DB.QueryRow(q).Scan(&n)
		if n != 0 {
			t.Errorf("%s = %d", q, n)
		}
	}
	// account identity untouched, security rows kept, other sessions revoked
	var hashAfter string
	w.DB.QueryRow(`SELECT hash FROM users WHERE id = ?`, uid).Scan(&hashAfter)
	if hashAfter != hashBefore {
		t.Error("the password hash changed")
	}
	for _, q := range []string{`SELECT COUNT(*) FROM ai_keys WHERE user_id = %d`, `SELECT COUNT(*) FROM mfa_totp WHERE user_id = %d`, `SELECT COUNT(*) FROM mfa_recovery_codes WHERE user_id = %d`} {
		var n int
		w.DB.QueryRow(fmt.Sprintf(q, uid)).Scan(&n)
		if n != 1 {
			t.Errorf("%s = %d, security data must survive", q, n)
		}
	}
	var sess []string
	rs, _ := w.DB.Query(`SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY id`, uid)
	for rs.Next() {
		var s string
		rs.Scan(&s)
		sess = append(sess, s)
	}
	rs.Close()
	if len(sess) != 1 || sess[0] != "keep" || res.RevokedSessions != 2 {
		t.Errorf("sessions %v revoked %d (the seeded one and 'other' go, 'keep' stays)", sess, res.RevokedSessions)
	}
	// Matrix 14: a personal restore is not a security action; access tokens stay.
	var toks int
	w.DB.QueryRow(`SELECT COUNT(*) FROM access_tokens WHERE user_id = ?`, uid).Scan(&toks)
	if toks != 1 {
		t.Errorf("access tokens after restore = %d, want the seeded one kept", toks)
	}
	var bobSess int
	w.DB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, w.BobID).Scan(&bobSess)
	if bobSess != 1 {
		t.Errorf("bob's sessions %d", bobSess)
	}
	// plugin rows got updated_at = now (restored stamp), modified_at kept (NULL stays NULL)
	var nullMod int
	w.DB.QueryRow(`SELECT COUNT(*) FROM plugin_data WHERE user_id = ? AND modified_at IS NULL`, uid).Scan(&nullMod)
	var stale int
	w.DB.QueryRow(`SELECT COUNT(*) FROM plugin_data WHERE user_id = ? AND updated_at < '2026-11-16'`, uid).Scan(&stale)
	if nullMod != 1 || stale != 0 {
		t.Errorf("modified_at NULL rows %d, rows with an old updated_at %d", nullMod, stale)
	}
	// typed cards: updated_at = now (the restore's stamp, so every pull sees them), version and
	// modified_at kept, workspaces remapped to the new ids
	var cards, keptStamps, staleCards int
	w.DB.QueryRow(`SELECT COUNT(*), SUM(version = 2 AND modified_at = '2026-11-10T08:00:00Z'), SUM(updated_at < '2026-11-16')
		FROM study_cards WHERE user_id = ? AND deleted_at IS NULL AND workspace_id IN (SELECT id FROM workspaces WHERE user_id = ?)`, uid, uid).Scan(&cards, &keptStamps, &staleCards)
	if cards != 3 || keptStamps != 3 || staleCards != 0 || res.Restored.Cards != 3 {
		t.Errorf("typed cards %d (stamps kept %d, stale %d), restored cards %d", cards, keptStamps, staleCards, res.Restored.Cards)
	}
	// user-global rows (workspaceId null) round-trip, and the vacation scope follows the NEW workspace
	var vac string
	var vws sql_NullInt
	if err := w.DB.QueryRow(`SELECT data, workspace_id FROM plugin_data WHERE user_id = ? AND key LIKE 'vacation:%'`, uid).Scan(&vac, &vws); err != nil {
		t.Fatalf("vacation row: %v", err)
	}
	var newWS1 int64
	w.DB.QueryRow(`SELECT id FROM workspaces WHERE user_id = ? AND language = 'zh'`, uid).Scan(&newWS1)
	if vws.Valid || !strings.Contains(vac, fmt.Sprintf(`"workspaces":[%d]`, newWS1)) {
		t.Errorf("vacation row: ws=%v data=%s (new workspace %d)", vws, vac, newWS1)
	}
	// files
	books := filepath.Join(w.Data, "books", strconv.FormatInt(uid, 10))
	ents, _ := os.ReadDir(books)
	var names []string
	for _, e := range ents {
		names = append(names, e.Name())
	}
	var newBook int64
	w.DB.QueryRow(`SELECT id FROM library_books WHERE user_id = ?`, uid).Scan(&newBook)
	if len(names) != 1 || names[0] != strconv.FormatInt(newBook, 10)+".json" {
		t.Errorf("book dir %v, want only %d.json (no staging, no old files)", names, newBook)
	}
	if _, err := os.Stat(filepath.Join(w.Data, "journal", strconv.FormatInt(uid, 10))); !os.IsNotExist(err) {
		t.Errorf("journal dir: %v", err)
	}
	if _, err := os.Stat(filepath.Join(w.Data, "journal", strconv.FormatInt(w.BobID, 10))); err != nil {
		t.Errorf("bob's journal dir: %v", err)
	}
	// audit row with counts and no secrets
	var detail string
	if err := w.DB.QueryRow(`SELECT detail FROM auth_audit WHERE action = 'data_restored'`).Scan(&detail); err != nil || !strings.Contains(detail, `"revoked":2`) {
		t.Errorf("audit %q %v", detail, err)
	}
}

type sql_NullInt struct {
	V     int64
	Valid bool
}

func (n *sql_NullInt) Scan(v any) error {
	if v == nil {
		n.Valid = false
		return nil
	}
	n.Valid = true
	n.V = v.(int64)
	return nil
}

func mustUnzip(t *testing.T, data []byte) map[string][]byte {
	f, _ := unzipAll(t, data)
	return f
}

func TestSafetyExportIsWrittenFirstAndOlderOnesGo(t *testing.T) {
	w := newWorld(t)
	uid := w.AliceUID
	a := openExport(t, w, uid)
	scramble(t, w)
	pre, _ := exportBytes(t, w, uid)
	dir := SafetyDir(w.Data, uid)
	os.MkdirAll(dir, 0o700)
	os.WriteFile(filepath.Join(dir, "20200101-000000.000.zip"), []byte("old"), 0o600)
	if _, _, err := Restore(context.Background(), deps(w), uid, 0, a, Options{}); err != nil {
		t.Fatal(err)
	}
	p, ok := LatestSafetyExport(w.Data, uid)
	if !ok {
		t.Fatal("no safety export")
	}
	b, _ := os.ReadFile(p)
	if canon(t, b) != canon(t, pre) {
		t.Error("the safety export does not hold the data as it was before the restore")
	}
	ents, _ := os.ReadDir(dir)
	if len(ents) != 2 {
		t.Errorf("%d files in the safety dir, want the old copy and the new one (the only older copy is never dropped for a newer one)", len(ents))
	}
}

func TestRestoreUnresolvedNeedsAcknowledgementAndChangesNothing(t *testing.T) {
	src := newWorld(t)
	a := openExport(t, src, src.AliceUID)
	tg := newTarget(t, func(b *baseWorld) {
		mkEntry(t, b.DB, "zh", "word", "cc-1", "你好") // 世界 is missing
	})
	exec(t, tg.DB, `INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, 'zh', 'mine', '{}', 't')`, tg.UID)
	before := tableCounts(t, tg.DB)
	_, rep, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{})
	if !errors.Is(err, ErrUnresolved) || rep.Unresolved.EntryCount != 1 {
		t.Fatalf("err %v, report %+v", err, rep.Unresolved)
	}
	if !equalCounts(before, tableCounts(t, tg.DB)) {
		t.Error("rows changed although the restore refused")
	}
	if _, ok := LatestSafetyExport(tg.Data, tg.UID); ok {
		t.Error("a safety export was written for a refused restore")
	}
	res, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.DroppedRows == 0 {
		t.Error("nothing was dropped")
	}
	var n int
	tg.DB.QueryRow(`SELECT COUNT(*) FROM workspaces WHERE user_id = ? AND name = 'mine'`, tg.UID).Scan(&n)
	if n != 0 {
		t.Error("the old workspace survived")
	}
	tg.DB.QueryRow(`SELECT COUNT(*) FROM study_cards WHERE user_id = ?`, tg.UID).Scan(&n)
	if n != 2 {
		t.Errorf("cards after dropping: %d, want the two cards of 你好", n)
	}
}

func TestRestoreFailureRollsEverythingBack(t *testing.T) {
	for name, opts := range map[string]Options{
		"injected after the last insert": {BeforeCommit: func(*sql.Tx) error { return errors.New("boom") }},
	} {
		t.Run(name, func(t *testing.T) { runFailure(t, opts, nil) })
	}
	t.Run("a trigger fails the third table", func(t *testing.T) {
		runFailure(t, Options{}, func(w *baseWorld) {
			exec(t, w.DB, `CREATE TRIGGER boom BEFORE INSERT ON library_highlights BEGIN SELECT RAISE(ABORT, 'boom'); END`)
		})
	})
}

func runFailure(t *testing.T, opts Options, setup func(*baseWorld)) {
	w := newWorld(t)
	uid := w.AliceUID
	a := openExport(t, w, uid)
	scramble(t, w)
	if setup != nil {
		setup(w)
	}
	before, _ := exportBytes(t, w, uid)
	counts := tableCounts(t, w.DB)
	books := filepath.Join(w.Data, "books", strconv.FormatInt(uid, 10))
	listBefore := dirNames(books)
	_, _, err := Restore(context.Background(), deps(w), uid, 0, a, opts)
	if err == nil {
		t.Fatal("restore succeeded although it had to fail")
	}
	after, _ := exportBytes(t, w, uid)
	if string(canonBytes(t, before)) != string(canonBytes(t, after)) || !equalCounts(counts, tableCounts(t, w.DB)) {
		t.Error("rows changed after a failed restore")
	}
	if got := dirNames(books); strings.Join(got, ",") != strings.Join(listBefore, ",") {
		t.Errorf("book dir %v, was %v (staging dir left or old files gone)", got, listBefore)
	}
	if _, err := os.Stat(filepath.Join(w.Data, "journal", strconv.FormatInt(uid, 10))); err != nil {
		t.Errorf("journal dir removed by a failed restore: %v", err)
	}
	var sessions int
	w.DB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = ?`, uid).Scan(&sessions)
	if sessions != 3 {
		t.Errorf("sessions %d: revoked by a failed restore", sessions)
	}
}

func canonBytes(t *testing.T, b []byte) []byte { return []byte(canon(t, b)) }

func dirNames(dir string) []string {
	ents, _ := os.ReadDir(dir)
	var out []string
	for _, e := range ents {
		out = append(out, e.Name())
	}
	sort.Strings(out)
	return out
}

func TestRestoreOntoAServerWithShiftedEntryIds(t *testing.T) {
	src := newWorld(t)
	a := openExport(t, src, src.AliceUID)
	tg := newTarget(t, nil)
	if tg.E1 == src.E1 {
		t.Fatal("ids not shifted")
	}
	exec(t, tg.DB, `INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (?, 'tatoeba', NULL, 'packsatz', 'p', 't', 't')`, tg.E2)
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{}); err != nil {
		t.Fatal(err)
	}
	// card keys and ids follow the target's entry ids; the review events too
	var key string
	var entry int64
	var extra string
	if err := tg.DB.QueryRow(`SELECT id, entry_id, extra FROM study_cards WHERE user_id = ? AND id LIKE 'c-reverse-%'`, tg.UID).Scan(&key, &entry, &extra); err != nil {
		t.Fatal(err)
	}
	if key != "c-reverse-"+strconv.FormatInt(tg.E1, 10) || entry != tg.E1 || !strings.Contains(extra, `"x-unknown"`) {
		t.Errorf("card %s entry %d extra %s", key, entry, extra)
	}
	var n int
	tg.DB.QueryRow(`SELECT COUNT(*) FROM study_events WHERE user_id = ? AND payload LIKE ?`, tg.UID, `%"cardId":"c-reverse-`+strconv.FormatInt(tg.E1, 10)+`"%`).Scan(&n)
	if n != 1 {
		t.Errorf("review events of the reverse card: %d", n)
	}
	tg.DB.QueryRow(`SELECT COUNT(*) FROM study_events WHERE user_id = ? AND payload LIKE '%orphan:c-vocab-424242%'`, tg.UID).Scan(&n)
	if n != 1 {
		t.Errorf("orphan review kept: %d", n)
	}
	tg.DB.QueryRow(`SELECT COUNT(*) FROM user_edits WHERE user_id = ? AND entry_id = ?`, tg.UID, tg.E1).Scan(&n)
	if n != 1 {
		t.Errorf("overlay not on the target entry")
	}
	var sid, cardSent int64
	tg.DB.QueryRow(`SELECT sentence_id FROM study_cards WHERE user_id = ? AND id = 'SENTCARD01'`, tg.UID).Scan(&cardSent)
	tg.DB.QueryRow(`SELECT id FROM sentences WHERE source_pack = 'tatoeba'`).Scan(&sid)
	if cardSent != sid || sid == 0 {
		t.Errorf("sentence card's sentence %d, pack sentence %d", cardSent, sid)
	}
}

func TestRestoreReidentifiesEventsOfAnotherUser(t *testing.T) {
	src := newWorld(t)
	a := openExport(t, src, src.AliceUID)
	tg := newTarget(t, nil)
	carol := mkUser(t, tg.DB, "carol")
	exec(t, tg.DB, `INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, 'zh', '', '{}', 't')`, carol)
	var cw int64
	tg.DB.QueryRow(`SELECT id FROM workspaces WHERE user_id = ?`, carol).Scan(&cw)
	exec(t, tg.DB, `INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (?, 'tatoeba', NULL, 'packsatz', 'p', 't', 't')`, tg.E2)
	taken := evID(src.AliceUID, "A")
	exec(t, tg.DB, `INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES (?, ?, ?, 'd', 't', 'review', '{}', 't')`, taken, carol, cw)
	res, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if res.ReidentifiedEvents != 1 || res.Restored.Events != 4 {
		t.Errorf("result %+v", res)
	}
	var owner int64
	tg.DB.QueryRow(`SELECT user_id FROM study_events WHERE id = ?`, taken).Scan(&owner)
	if owner != carol {
		t.Error("carol's event was taken over")
	}
	var n int
	tg.DB.QueryRow(`SELECT COUNT(*) FROM study_events WHERE user_id = ?`, tg.UID).Scan(&n)
	if n != 4 {
		t.Errorf("alice has %d events", n)
	}
}

func TestRestoreVersusDeleteUserNeverLeavesDataOrBusy(t *testing.T) {
	for round := 0; round < 25; round++ {
		w := newWorld(t)
		uid := w.AliceUID
		a := openExport(t, w, uid)
		d := deps(w)
		admin := mkUser(t, w.DB, fmt.Sprintf("admin%d", round))
		w.DB.Exec(`UPDATE users SET admin = 1 WHERE id = ?`, admin)
		var wg sync.WaitGroup
		var restoreErr, deleteErr error
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, _, restoreErr = Restore(context.Background(), d, uid, 0, a, Options{})
		}()
		go func() {
			defer wg.Done()
			deleteErr = d.Users.DeleteUser(context.Background(), admin, uid, w.Data)
		}()
		wg.Wait()
		if deleteErr != nil {
			t.Fatalf("round %d: delete: %v", round, deleteErr)
		}
		if restoreErr != nil && !errors.Is(restoreErr, ErrUserGone) {
			t.Fatalf("round %d: restore: %v (never SQLITE_BUSY or a half state)", round, restoreErr)
		}
		for _, q := range []string{`SELECT COUNT(*) FROM workspaces WHERE user_id = %d`, `SELECT COUNT(*) FROM study_events WHERE user_id = %d`,
			`SELECT COUNT(*) FROM plugin_data WHERE user_id = %d`, `SELECT COUNT(*) FROM library_books WHERE user_id = %d`, `SELECT COUNT(*) FROM user_edits WHERE user_id = %d`} {
			var n int
			w.DB.QueryRow(fmt.Sprintf(q, uid)).Scan(&n)
			if n != 0 {
				t.Fatalf("round %d: %s = %d for a deleted user", round, q, n)
			}
		}
		for _, dir := range auth.UserDirs {
			if _, err := os.Stat(filepath.Join(w.Data, dir, strconv.FormatInt(uid, 10))); !os.IsNotExist(err) {
				t.Fatalf("round %d: %s of the deleted user exists: %v", round, dir, err)
			}
		}
	}
}

// TestRestoreKeepsReplacementLinks: a changed grade (#131) names the review
// it replaces by id. When that review's id belongs to another user on the
// target and is re-identified, the restored replacement names the new id,
// other members byte for byte, and the other user's event is untouched.
func TestRestoreKeepsReplacementLinks(t *testing.T) {
	src := newWorld(t)
	uid := src.AliceUID
	target := evID(uid, "A")
	repl := evID(uid, "R")
	exec(t, src.DB, `INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES (?, ?, ?, 'web', '2026-11-10T09:00:00Z', 'review', ?, 't')`,
		repl, uid, src.Alice.WS1, fmt.Sprintf(`{"cardId":"c-vocab-%d","mode":"vocab","grade":1,"replaces":"%s","x":[1,2]}`, src.E1, target))
	a := openExport(t, src, uid)
	tg := newTarget(t, nil)
	carol := mkUser(t, tg.DB, "carol")
	exec(t, tg.DB, `INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, 'zh', '', '{}', 't')`, carol)
	var cw int64
	tg.DB.QueryRow(`SELECT id FROM workspaces WHERE user_id = ?`, carol).Scan(&cw)
	exec(t, tg.DB, `INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (?, 'tatoeba', NULL, 'packsatz', 'p', 't', 't')`, tg.E2)
	exec(t, tg.DB, `INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES (?, ?, ?, 'd', '2026-11-10T09:00:00Z', 'review', '{"cardId":"x","grade":3}', 't')`, target, carol, cw)
	// Carol's own replacement of her review names the same id: only the
	// restoring user's rows are relinked (review fix 6).
	carolRepl := fmt.Sprintf(`{"cardId":"x","grade":2,"replaces":"%s"}`, target)
	exec(t, tg.DB, `INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES ('01JD0000000000000000CAROL1', ?, ?, 'd', '2026-11-10T09:00:00Z', 'review', ?, 't')`, carol, cw, carolRepl)
	res, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if res.ReidentifiedEvents != 1 {
		t.Fatalf("result %+v", res)
	}
	var newID string
	tg.DB.QueryRow(`SELECT id FROM study_events WHERE user_id = ? AND ts = '2026-11-10T09:00:00Z' AND id <> ?`, tg.UID, repl).Scan(&newID)
	if newID == "" || newID == target {
		t.Fatalf("target restored as %q", newID)
	}
	var payload string
	tg.DB.QueryRow(`SELECT payload FROM study_events WHERE user_id = ? AND id = ?`, tg.UID, repl).Scan(&payload)
	want := fmt.Sprintf(`{"cardId":"c-vocab-%d","mode":"vocab","grade":1,"replaces":"%s","x":[1,2]}`, tg.E1, newID)
	if payload != want {
		t.Errorf("replacement payload %s, want %s", payload, want)
	}
	var carolPayload string
	tg.DB.QueryRow(`SELECT payload FROM study_events WHERE id = ? AND user_id = ?`, target, carol).Scan(&carolPayload)
	if carolPayload != `{"cardId":"x","grade":3}` {
		t.Errorf("carol's event changed: %q", carolPayload)
	}
	tg.DB.QueryRow(`SELECT payload FROM study_events WHERE id = '01JD0000000000000000CAROL1'`).Scan(&carolPayload)
	if carolPayload != carolRepl {
		t.Errorf("carol's replacement changed: %q", carolPayload)
	}
}
