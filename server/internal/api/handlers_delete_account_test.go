package api_test

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/library"
)

func TestAdminDeletesUserEverythingGoes(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB, dataDir := newServerWithDir(t)
	owner := registerUser(t, ts.URL, "owner", "")
	bob := registerUser(t, ts.URL, "bobby", owner)
	seedBuiltin(t, sqlDB, deleteTestPlugin)
	bobID := userID(t, sqlDB, "bobby")
	ws := createWorkspace(t, ts.URL, bob, "zh", "")
	store := library.Store{DB: sqlDB, Dir: filepath.Join(dataDir, "books")}
	populateWorkspace(t, ts.URL, bob, store, bobID, ws, 7)
	doRaw(t, "PUT", ts.URL, "/api/plugins/qinqin-flashcards/data/settings", bob, `{"a":1}`)

	var prev map[string]int
	decodeJSON(t, doJSON(t, "GET", ts.URL, "/api/admin/users/"+itoa(bobID)+"/deletion-preview", owner, nil), &prev)
	if prev["workspaces"] != 1 || prev["studyEvents"] != 1 || prev["books"] != 1 || prev["pluginData"] != 2 || prev["sessions"] != 1 {
		t.Errorf("preview = %v", prev)
	}
	path := "/api/admin/users/" + itoa(bobID)
	if r := doJSON(t, "DELETE", ts.URL, path, owner, map[string]string{"confirm": "bob"}); r.StatusCode != 422 {
		t.Errorf("confirm mismatch = %d, want 422", r.StatusCode)
	}
	var ownerID = userID(t, sqlDB, "owner")
	if r := doJSON(t, "DELETE", ts.URL, "/api/admin/users/"+itoa(ownerID), owner, map[string]string{"confirm": "owner"}); r.StatusCode != 409 {
		t.Errorf("admin deleting self via admin route = %d, want 409", r.StatusCode)
	}
	if r := doJSON(t, "DELETE", ts.URL, path, owner, map[string]string{"confirm": "bobby", "currentPassword": "secret-pass-owner"}); r.StatusCode != 204 {
		t.Fatalf("delete = %d", r.StatusCode)
	}
	if r := doJSON(t, "GET", ts.URL, "/api/auth/me", bob, nil); r.StatusCode != 401 {
		t.Errorf("deleted user's token = %d, want 401", r.StatusCode)
	}
	for _, q := range []string{
		`SELECT COUNT(*) FROM workspaces WHERE user_id = ?`, `SELECT COUNT(*) FROM study_events WHERE user_id = ?`,
		`SELECT COUNT(*) FROM plugin_data WHERE user_id = ?`, `SELECT COUNT(*) FROM library_books WHERE user_id = ?`,
		`SELECT COUNT(*) FROM library_bookmarks WHERE user_id = ?`, `SELECT COUNT(*) FROM users WHERE id = ?`,
	} {
		if n := countWhere(t, sqlDB, q, bobID); n != 0 {
			t.Errorf("%s = %d after deletion", q, n)
		}
	}
	if _, err := os.Stat(filepath.Join(dataDir, "books", strconv.FormatInt(bobID, 10))); !os.IsNotExist(err) {
		t.Errorf("books dir of the deleted user: %v", err)
	}
	if r := doJSON(t, "DELETE", ts.URL, path, owner, map[string]string{"confirm": "bobby"}); r.StatusCode != 404 {
		t.Errorf("delete again = %d, want 404", r.StatusCode)
	}
	if st, _ := loginRaw(t, ts.URL, "bobby", "secret-pass-bobby"); st != 401 {
		t.Errorf("login as the deleted user = %d", st)
	}
}

func TestSelfDeleteNeedsPasswordAndUsername(t *testing.T) {
	ts, sqlDB := newLooseServer(t)
	owner := registerUser(t, ts.URL, "owner", "")
	bob := registerUser(t, ts.URL, "bobby", owner)
	bobID := userID(t, sqlDB, "bobby")
	var prev map[string]int
	decodeJSON(t, doJSON(t, "GET", ts.URL, "/api/account/deletion-preview", bob, nil), &prev)
	if prev["sessions"] != 1 {
		t.Errorf("preview = %v", prev)
	}
	if r := doJSON(t, "DELETE", ts.URL, "/api/account", bob, map[string]string{"password": "secret-pass-bobby", "confirm": "nope"}); r.StatusCode != 422 {
		t.Errorf("confirm mismatch = %d", r.StatusCode)
	}
	r := doJSON(t, "DELETE", ts.URL, "/api/account", bob, map[string]string{"password": "wrong-password-x", "confirm": "bobby"})
	var e errBody
	decodeJSON(t, r, &e)
	if r.StatusCode != 403 || e.Error != "wrong_password" {
		t.Errorf("wrong password = %d %s, want 403 wrong_password", r.StatusCode, e.Error)
	}
	if r := doJSON(t, "GET", ts.URL, "/api/auth/me", bob, nil); r.StatusCode != 200 {
		t.Errorf("session lost after a wrong password: %d", r.StatusCode)
	}
	if r := doJSON(t, "DELETE", ts.URL, "/api/account", bob, map[string]string{"password": "secret-pass-bobby", "confirm": "bobby"}); r.StatusCode != 204 {
		t.Fatalf("self delete = %d", r.StatusCode)
	}
	if r := doJSON(t, "GET", ts.URL, "/api/auth/me", bob, nil); r.StatusCode != 401 {
		t.Errorf("token after self delete = %d, want 401", r.StatusCode)
	}
	if n := countWhere(t, sqlDB, `SELECT COUNT(*) FROM users WHERE id = ?`, bobID); n != 0 {
		t.Error("user row remains")
	}
	// the last administrator cannot delete themselves
	r = doJSON(t, "DELETE", ts.URL, "/api/account", owner, map[string]string{"password": "secret-pass-owner", "confirm": "owner"})
	decodeJSON(t, r, &e)
	if r.StatusCode != 409 || e.Error != "last_admin" {
		t.Errorf("last admin self delete = %d %s", r.StatusCode, e.Error)
	}
	if r := doJSON(t, "GET", ts.URL, "/api/auth/me", owner, nil); r.StatusCode != 200 {
		t.Errorf("owner lost the session: %d", r.StatusCode)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'account_deleted'`).Scan(&n)
	if n != 1 {
		t.Errorf("account_deleted rows = %d", n)
	}
	// non-admins cannot use the admin routes
	plain := registerUser(t, ts.URL, "carla", owner)
	if r := doJSON(t, "DELETE", ts.URL, "/api/admin/users/"+itoa(userID(t, sqlDB, "owner")), plain, map[string]string{"confirm": "owner"}); r.StatusCode != 403 {
		t.Errorf("non-admin delete = %d", r.StatusCode)
	}
}
