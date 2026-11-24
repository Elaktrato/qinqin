package api_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
	"qinqin/internal/lang"
)

type backupEnv struct {
	ts   *httptest.Server
	db   *sql.DB
	data string
	done chan int64
}

func newBackupEnv(t *testing.T, opts ...api.Option) *backupEnv {
	t.Helper()
	lang.Register(lang.Zh{})
	sqlDB := dbtest.Open(t)
	e := &backupEnv{db: sqlDB, data: t.TempDir(), done: make(chan int64, 16)}
	p := api.DefaultAuthPolicy()
	p.Client.Burst = 5000
	opts = append([]api.Option{api.WithAuthPolicy(p), api.WithStageDone(e.done)}, opts...)
	e.ts = httptest.NewServer(api.New(sqlDB, e.data, nil, opts...))
	t.Cleanup(e.ts.Close)
	return e
}

func (e *backupEnv) wait(t *testing.T) {
	t.Helper()
	select {
	case <-e.done:
	case <-time.After(20 * time.Second):
		t.Fatal("the stage did not finish")
	}
}

// export downloads the user's archive through the ticket flow.
func (e *backupEnv) export(t *testing.T, token string) []byte {
	t.Helper()
	var tk ticketReply
	r := doJSON(t, "POST", e.ts.URL, "/api/account/export", token, nil)
	if r.StatusCode != 200 {
		t.Fatalf("export = %d", r.StatusCode)
	}
	decodeJSON(t, r, &tk)
	status, _, body := getRaw(t, e.ts.URL, tk.URL, "")
	if status != 200 {
		t.Fatalf("download = %d", status)
	}
	return body
}

func (e *backupEnv) upload(t *testing.T, token string, body []byte) (int, string, errBody) {
	t.Helper()
	req, _ := http.NewRequest("POST", e.ts.URL+"/api/account/restore", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/zip")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out struct {
		Token string `json:"token"`
		errBody
	}
	json.Unmarshal(raw, &out)
	return resp.StatusCode, out.Token, out.errBody
}

type stageBody struct {
	Status string `json:"status"`
	Report *struct {
		Replaces   map[string]int `json:"replaces"`
		Restores   map[string]int `json:"restores"`
		Unresolved struct {
			EntryCount int `json:"entryCount"`
			Sentences  int `json:"sentences"`
		} `json:"unresolved"`
		Backup struct {
			Username string `json:"username"`
		} `json:"backup"`
	} `json:"report"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	Result map[string]any `json:"result"`
}

func (e *backupEnv) status(t *testing.T, token, rtoken string) (int, stageBody) {
	t.Helper()
	r := doJSON(t, "GET", e.ts.URL, "/api/account/restore/"+rtoken, token, nil)
	var b stageBody
	if r.StatusCode == 200 {
		decodeJSON(t, r, &b)
	}
	return r.StatusCode, b
}

func (e *backupEnv) apply(t *testing.T, token, rtoken string, body map[string]any) (int, errBody) {
	t.Helper()
	r := doJSON(t, "POST", e.ts.URL, "/api/account/restore/"+rtoken, token, body)
	var eb errBody
	if r.StatusCode >= 400 {
		decodeJSON(t, r, &eb)
	}
	return r.StatusCode, eb
}

func (e *backupEnv) count(t *testing.T, q string, args ...any) int {
	var n int
	if err := e.db.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRestoreFlowStageApplyAndIsolation(t *testing.T) {
	e := newBackupEnv(t)
	alice := registerUser(t, e.ts.URL, "alice", "")
	bob := registerUser(t, e.ts.URL, "bobby", alice)
	aliceID, bobID := userID(t, e.db, "alice"), userID(t, e.db, "bobby")
	wsA := createWorkspace(t, e.ts.URL, alice, "zh", "")
	wsB := createWorkspace(t, e.ts.URL, bob, "zh", "")
	doRaw(t, "PUT", e.ts.URL, "/api/rows/milestone:keep?workspace="+itoa(wsA), alice, `{"id":"keep"}`)
	doRaw(t, "PUT", e.ts.URL, "/api/rows/vacation:V1", alice, `{"version":1,"id":"V1","scope":{"workspaces":[`+itoa(wsA)+`]}}`)
	doRaw(t, "PUT", e.ts.URL, "/api/rows/milestone:bobs?workspace="+itoa(wsB), bob, `{"id":"bobs"}`)
	archive := e.export(t, alice)
	// change alice's data afterwards, and a second device of hers
	doRaw(t, "PUT", e.ts.URL, "/api/rows/milestone:later?workspace="+itoa(wsA), alice, `{"id":"later"}`)
	other := login(t, e.ts.URL, "alice")

	code, rt, eb := e.upload(t, alice, archive)
	if code != 202 || rt == "" {
		t.Fatalf("upload = %d %+v", code, eb)
	}
	e.wait(t)
	// another user's token is invisible on every verb
	for _, m := range []string{"GET", "DELETE", "POST"} {
		if r := doJSON(t, m, e.ts.URL, "/api/account/restore/"+rt, bob, map[string]any{"confirm": "bobby", "password": "secret-pass-bobby"}); r.StatusCode != 404 {
			t.Errorf("%s of another user's stage = %d, want 404", m, r.StatusCode)
		}
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/account/restore/"+rt, "", nil); r.StatusCode != 401 {
		t.Errorf("anonymous status = %d", r.StatusCode)
	}
	st, view := e.status(t, alice, rt)
	if st != 200 || view.Status != "ready" || view.Report == nil || view.Report.Backup.Username != "alice" ||
		view.Report.Replaces["rows"] != 3 || view.Report.Restores["rows"] != 2 {
		t.Fatalf("status %d %+v %+v err %+v", st, view, view.Report, view.Error)
	}
	// destructive: password, username
	if c, eb := e.apply(t, alice, rt, map[string]any{"confirm": "nope", "password": "secret-pass-alice"}); c != 422 || eb.Error != "confirm_mismatch" {
		t.Errorf("confirm mismatch = %d %+v", c, eb)
	}
	if c, eb := e.apply(t, alice, rt, map[string]any{"confirm": "alice", "password": "wrong-password-x"}); c != 403 || eb.Error != "wrong_password" {
		t.Errorf("wrong password = %d %+v", c, eb)
	}
	if c, eb := e.apply(t, alice, rt, map[string]any{"confirm": "alice"}); c != 403 || eb.Error != "current_password_required" {
		t.Errorf("no password = %d %+v", c, eb)
	}
	if n := e.count(t, `SELECT COUNT(*) FROM keyed_rows WHERE user_id = ? AND key = 'milestone:later'`, aliceID); n != 1 {
		t.Fatal("data changed before the restore was confirmed")
	}
	if c, eb := e.apply(t, alice, rt, map[string]any{"confirm": "alice", "password": "secret-pass-alice", "surprise": 1}); c != 400 {
		t.Errorf("unknown body field = %d %+v", c, eb)
	}
	if c, eb := e.apply(t, alice, rt, map[string]any{"confirm": "alice", "password": "secret-pass-alice"}); c != 202 {
		t.Fatalf("apply = %d %+v", c, eb)
	}
	e.wait(t)
	_, view = e.status(t, alice, rt)
	if view.Status != "done" || view.Result == nil {
		t.Fatalf("after apply: %+v", view)
	}
	if n := e.count(t, `SELECT COUNT(*) FROM keyed_rows WHERE user_id = ? AND key = 'milestone:later'`, aliceID); n != 0 {
		t.Error("data after the backup survived the restore")
	}
	if n := e.count(t, `SELECT COUNT(*) FROM keyed_rows WHERE user_id = ? AND key IN ('milestone:keep','vacation:V1')`, aliceID); n != 2 {
		t.Errorf("restored rows: %d", n)
	}
	var vac string
	e.db.QueryRow(`SELECT data FROM keyed_rows WHERE user_id = ? AND key = 'vacation:V1'`, aliceID).Scan(&vac)
	var newWS int64
	e.db.QueryRow(`SELECT id FROM workspaces WHERE user_id = ?`, aliceID).Scan(&newWS)
	if !strings.Contains(vac, `"workspaces":[`+itoa(newWS)+`]`) || newWS == wsA {
		t.Errorf("vacation %s, workspace %d (old %d)", vac, newWS, wsA)
	}
	if n := e.count(t, `SELECT COUNT(*) FROM keyed_rows WHERE user_id = ? AND key = 'milestone:bobs'`, bobID); n != 1 {
		t.Error("bob's data was touched")
	}
	// sessions: the restoring one lives, the other device is signed out
	if r := doJSON(t, "GET", e.ts.URL, "/api/auth/me", alice, nil); r.StatusCode != 200 {
		t.Errorf("restoring session = %d", r.StatusCode)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/auth/me", other, nil); r.StatusCode != 401 {
		t.Errorf("other device = %d, want 401", r.StatusCode)
	}
	if r := doJSON(t, "GET", e.ts.URL, "/api/auth/me", bob, nil); r.StatusCode != 200 {
		t.Errorf("bob = %d", r.StatusCode)
	}
	// the safety export link: a ticket, single use, own data only
	var tk ticketReply
	r := doJSON(t, "POST", e.ts.URL, "/api/account/restore/safety-export", alice, nil)
	if r.StatusCode != 200 {
		t.Fatalf("safety ticket = %d", r.StatusCode)
	}
	decodeJSON(t, r, &tk)
	status, _, body := getRaw(t, e.ts.URL, tk.URL, "")
	if status != 200 || !strings.Contains(string(zipEntries(t, body)["workspaces.json"]), fmt.Sprintf(`%d`, wsA)) {
		t.Errorf("safety download = %d", status)
	}
	if status, _, _ := getRaw(t, e.ts.URL, tk.URL, ""); status != 404 {
		t.Errorf("safety ticket reused = %d", status)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/account/restore/safety-export", bob, nil); r.StatusCode != 404 {
		t.Errorf("bob has no safety export, got %d", r.StatusCode)
	}
	// an export ticket is not a safety-export ticket
	var ex ticketReply
	decodeJSON(t, doJSON(t, "POST", e.ts.URL, "/api/account/export", alice, nil), &ex)
	if status, _, _ := getRaw(t, e.ts.URL, "/api/account/restore/safety-export/"+ex.URL[strings.LastIndex(ex.URL, "/")+1:], ""); status != 404 {
		t.Errorf("an export ticket opened the safety export: %d", status)
	}
}

func TestRestoreUploadCapAndContentType(t *testing.T) {
	e := newBackupEnv(t, api.WithRestoreCap(2000))
	alice := registerUser(t, e.ts.URL, "alice", "")
	code, _, eb := e.upload(t, alice, bytes.Repeat([]byte("z"), 5000))
	if code != 413 || eb.Error != "backup_too_large" {
		t.Errorf("over the cap = %d %+v", code, eb)
	}
	if ents, _ := os.ReadDir(filepath.Join(e.data, "tmp", "restore")); len(ents) != 0 {
		t.Errorf("%d files left after a rejected upload", len(ents))
	}
	req, _ := http.NewRequest("POST", e.ts.URL+"/api/account/restore", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+alice)
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 415 {
		t.Errorf("JSON body = %d, want 415", resp.StatusCode)
	}
}

func TestRestoreInvalidArchivesAreMarkedInvalidAndChangeNothing(t *testing.T) {
	e := newBackupEnv(t)
	alice := registerUser(t, e.ts.URL, "alice", "")
	aliceID := userID(t, e.db, "alice")
	ws := createWorkspace(t, e.ts.URL, alice, "zh", "")
	_ = ws
	archive := e.export(t, alice)
	files := zipEntries(t, archive)
	build := func(mutate func(map[string][]byte)) []byte {
		var buf bytes.Buffer
		zw := newZipWriter(&buf)
		mutate(files)
		for n, b := range files {
			zw(n, b)
		}
		zw(":close", nil)
		return buf.Bytes()
	}
	cases := map[string]struct {
		body []byte
		code string
	}{
		"not a zip": {[]byte("hello"), "backup_invalid"},
		"zip slip":  {build(func(m map[string][]byte) { m["../../etc/passwd"] = []byte("x") }), "backup_invalid"},
		"version 1": {build(func(m map[string][]byte) {
			m["manifest.json"] = bytes.Replace(m["manifest.json"], []byte(`"formatVersion": 2`), []byte(`"formatVersion": 1`), 1)
			delete(m, "../../etc/passwd")
		}), "backup_version_unsupported"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			code, rt, _ := e.upload(t, alice, c.body)
			if code != 202 {
				t.Fatalf("upload = %d", code)
			}
			e.wait(t)
			_, view := e.status(t, alice, rt)
			if view.Status != "invalid" || view.Error == nil || view.Error.Code != c.code {
				t.Errorf("status %+v err %+v, want invalid %s", view.Status, view.Error, c.code)
			}
			if c, _ := e.apply(t, alice, rt, map[string]any{"confirm": "alice", "password": "secret-pass-alice"}); c != 409 {
				t.Errorf("apply of an invalid stage = %d, want 409", c)
			}
			if n := e.count(t, `SELECT COUNT(*) FROM workspaces WHERE user_id = ?`, aliceID); n != 1 {
				t.Errorf("workspaces %d", n)
			}
		})
	}
}

func TestRestoreUnresolvedNeedsTheAcknowledgement(t *testing.T) {
	e := newBackupEnv(t)
	alice := registerUser(t, e.ts.URL, "alice", "")
	aliceID := userID(t, e.db, "alice")
	ws := createWorkspace(t, e.ts.URL, alice, "zh", "")
	e.db.Exec(`INSERT INTO entries (language, kind, ext_key, updated_at) VALUES ('zh', 'word', 'k1', 't')`)
	var eid int64
	e.db.QueryRow(`SELECT id FROM entries WHERE ext_key = 'k1'`).Scan(&eid)
	e.db.Exec(`INSERT INTO forms (entry_id, text, ord, updated_at) VALUES (?, '水', 0, 't')`, eid)
	pushTyped(t, e, alice, map[string]any{"cards": []any{map[string]any{"workspaceId": ws, "id": fmt.Sprintf("c-vocab-%d", eid), "kind": "vocab",
		"entryId": eid, "written": nil, "entryKind": nil, "sentenceId": nil, "skipKinds": []string{}, "deckIds": []string{},
		"createdAt": "2026-11-10T08:00:00Z", "extra": map[string]any{}, "updatedAt": "2026-11-10T08:00:00Z"}}})
	archive := e.export(t, alice)
	e.db.Exec(`UPDATE entries SET deleted_at = 't' WHERE id = ?`, eid) // the word is gone from this server
	_, rt, _ := e.upload(t, alice, archive)
	e.wait(t)
	_, view := e.status(t, alice, rt)
	if view.Status != "ready" || view.Report.Unresolved.EntryCount != 1 {
		t.Fatalf("view %+v %+v", view.Status, view.Report)
	}
	if c, eb := e.apply(t, alice, rt, map[string]any{"confirm": "alice", "password": "secret-pass-alice"}); c != 409 || eb.Error != "unresolved_entries" {
		t.Errorf("without the acknowledgement = %d %+v", c, eb)
	}
	// cards are typed study rows (migration 038); a leftover plugin row would count too
	cards := `SELECT (SELECT COUNT(*) FROM study_cards WHERE user_id = ?1 AND deleted_at IS NULL) +
		(SELECT COUNT(*) FROM keyed_rows WHERE user_id = ?1 AND key LIKE 'card:%')`
	if n := e.count(t, cards, aliceID); n != 1 {
		t.Error("data changed")
	}
	if c, eb := e.apply(t, alice, rt, map[string]any{"confirm": "alice", "password": "secret-pass-alice", "unresolved": "drop"}); c != 202 {
		t.Fatalf("apply = %d %+v", c, eb)
	}
	e.wait(t)
	if n := e.count(t, cards, aliceID); n != 0 {
		t.Error("the card of the missing word was restored")
	}
}

func TestRestoreAppliesAreExclusiveAndExpire(t *testing.T) {
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	clk := &testClock{t: now}
	e := newBackupEnv(t, api.WithClock(clk.now))
	alice := registerUser(t, e.ts.URL, "alice", "")
	archive := e.export(t, alice)
	_, rt, _ := e.upload(t, alice, archive)
	e.wait(t)
	// a new upload discards the old stage
	_, rt2, _ := e.upload(t, alice, archive)
	e.wait(t)
	if st, _ := e.status(t, alice, rt); st != 404 {
		t.Errorf("the old stage = %d, want 404", st)
	}
	clk.advance(31 * time.Minute)
	if st, _ := e.status(t, alice, rt2); st != 404 {
		t.Errorf("an expired stage = %d, want 404", st)
	}
	if ents, _ := os.ReadDir(filepath.Join(e.data, "tmp", "restore")); len(ents) != 0 {
		t.Errorf("%d stage files left after expiry", len(ents))
	}
	// DELETE discards
	_, rt3, _ := e.upload(t, alice, archive)
	e.wait(t)
	if r := doJSON(t, "DELETE", e.ts.URL, "/api/account/restore/"+rt3, alice, nil); r.StatusCode != 204 {
		t.Errorf("discard = %d", r.StatusCode)
	}
	if st, _ := e.status(t, alice, rt3); st != 404 {
		t.Errorf("after discard = %d", st)
	}
}

func TestDeletingTheAccountDiscardsItsStage(t *testing.T) {
	e := newBackupEnv(t)
	owner := registerUser(t, e.ts.URL, "owner", "")
	bob := registerUser(t, e.ts.URL, "bobby", owner)
	archive := e.export(t, bob)
	_, _, _ = e.upload(t, bob, archive)
	e.wait(t)
	if ents, _ := os.ReadDir(filepath.Join(e.data, "tmp", "restore")); len(ents) != 1 {
		t.Fatalf("%d stage files", len(ents))
	}
	if r := doJSON(t, "DELETE", e.ts.URL, "/api/account", bob, map[string]string{"password": "secret-pass-bobby", "confirm": "bobby"}); r.StatusCode != 204 {
		t.Fatalf("delete = %d", r.StatusCode)
	}
	if ents, _ := os.ReadDir(filepath.Join(e.data, "tmp", "restore")); len(ents) != 0 {
		t.Errorf("%d stage files left after the account was deleted", len(ents))
	}
}

func TestRestoreUploadsAreRateLimited(t *testing.T) {
	e := newBackupEnv(t)
	alice := registerUser(t, e.ts.URL, "alice", "")
	for i := 0; i < 5; i++ {
		if code, _, _ := e.upload(t, alice, []byte("x")); code != 202 {
			t.Fatalf("upload %d = %d", i, code)
		}
		e.wait(t)
	}
	if code, _, eb := e.upload(t, alice, []byte("x")); code != 429 || eb.Error != "rate_limited" {
		t.Errorf("sixth upload = %d %+v", code, eb)
	}
}

func TestRestoreNeedsASecondFactorWhenTheUserHasOne(t *testing.T) {
	done := make(chan int64, 16)
	e := newMailEnv(t, mailOpts{configure: true, apiOpts: []api.Option{api.WithStageDone(done)}})
	bob := registerUser(t, e.ts.URL, "bobby", e.owner)
	secret, _ := e.enrolTOTP(t, bob, "secret-pass-bobby")
	be := &backupEnv{ts: e.ts, db: e.db, done: done}
	archive := be.export(t, bob)
	_, rt, _ := be.upload(t, bob, archive)
	be.wait(t)
	if c, eb := be.apply(t, bob, rt, map[string]any{"confirm": "bobby", "password": "secret-pass-bobby"}); c != 403 || eb.Error != "code_invalid" {
		t.Errorf("without a code = %d %+v", c, eb)
	}
	if c, eb := be.apply(t, bob, rt, map[string]any{"confirm": "bobby", "password": "secret-pass-bobby", "code": "000000"}); c != 403 || eb.Error != "code_invalid" {
		t.Errorf("wrong code = %d %+v", c, eb)
	}
	if st, v := be.status(t, bob, rt); st != 200 || v.Status != "ready" {
		t.Errorf("a refused apply changed the stage: %d %s", st, v.Status)
	}
	e.clk.advance(31 * time.Second) // the confirm code of the enrolment is spent for its step
	if c, eb := be.apply(t, bob, rt, map[string]any{"confirm": "bobby", "password": "secret-pass-bobby", "code": e.code(secret, 0)}); c != 202 {
		t.Fatalf("with the code = %d %+v", c, eb)
	}
	be.wait(t)
	// the TOTP secret survived the restore: the user still has an authenticator
	if n := be.count(t, `SELECT COUNT(*) FROM mfa_totp WHERE user_id = (SELECT id FROM users WHERE username = 'bobby')`); n != 1 {
		t.Errorf("mfa_totp rows %d after the restore", n)
	}
}

func TestExportRefusesAnArchiveTheServerCouldNotRestore(t *testing.T) {
	e := newBackupEnv(t, api.WithExportCap(300))
	alice := registerUser(t, e.ts.URL, "alice", "")
	var eb errBody
	r := doJSON(t, "POST", e.ts.URL, "/api/account/export", alice, nil)
	decodeJSON(t, r, &eb)
	if r.StatusCode != 422 || eb.Error != "backup_too_large_to_restore" || !strings.Contains(eb.Message, "administrator") {
		t.Errorf("over the cap = %d %+v", r.StatusCode, eb)
	}
	if n := e.count(t, `SELECT COUNT(*) FROM auth_audit WHERE action = 'data_exported'`); n != 0 {
		t.Errorf("audit rows %d", n)
	}
}

func TestExportTicketOfADisabledUserIsDead(t *testing.T) {
	e := newBackupEnv(t)
	owner := registerUser(t, e.ts.URL, "owner", "")
	bob := registerUser(t, e.ts.URL, "bobby", owner)
	var tk ticketReply
	decodeJSON(t, doJSON(t, "POST", e.ts.URL, "/api/account/export", bob, nil), &tk)
	e.db.Exec(`UPDATE users SET disabled_at = '2026-11-16T00:00:00Z' WHERE username = 'bobby'`)
	if status, _, _ := getRaw(t, e.ts.URL, tk.URL, ""); status != 404 {
		t.Errorf("ticket of a disabled user = %d, want 404", status)
	}
}

func TestTwoUploadsOfOneUserNeverBothSurvive(t *testing.T) {
	e := newBackupEnv(t)
	alice := registerUser(t, e.ts.URL, "alice", "")
	archive := e.export(t, alice)
	pr, pw := io.Pipe()
	req, _ := http.NewRequest("POST", e.ts.URL+"/api/account/restore", pr)
	req.Header.Set("Content-Type", "application/zip")
	req.Header.Set("Authorization", "Bearer "+alice)
	first := make(chan int, 1)
	go func() {
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			first <- -1
			return
		}
		resp.Body.Close()
		first <- resp.StatusCode
	}()
	pw.Write([]byte("PK")) // the first upload has taken its slot and holds its file open
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if ents, _ := os.ReadDir(filepath.Join(e.data, "tmp", "restore")); len(ents) == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	code, rt, _ := e.upload(t, alice, archive)
	if code != 202 {
		t.Fatalf("second upload = %d", code)
	}
	pw.Close()
	if st := <-first; st != 409 {
		t.Errorf("the replaced upload answered %d, want 409", st)
	}
	e.wait(t)
	if ents, _ := os.ReadDir(filepath.Join(e.data, "tmp", "restore")); len(ents) != 1 {
		t.Errorf("%d stage files, want exactly the second upload's", len(ents))
	}
	if st, v := e.status(t, alice, rt); st != 200 || v.Status != "ready" {
		t.Errorf("the surviving stage: %d %s", st, v.Status)
	}
}
