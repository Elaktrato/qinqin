package auth_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/dbtest"
)

var tokenShape = regexp.MustCompile(`^qq_pat_[0-9a-f]{64}$`)

// tokenDB is a fresh database with two users (ids returned) and a
// workspace for each.
func tokenDB(t *testing.T) (sqlDB *sql.DB, path string, u1, u2, ws1, ws2 int64) {
	t.Helper()
	sqlDB, path = dbtest.OpenPath(t)
	ins := func(q string, args ...any) int64 {
		t.Helper()
		res, err := sqlDB.Exec(q, args...)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	u1 = ins(`INSERT INTO users (username, hash, updated_at, created_at) VALUES ('tok-one', 'x', 't', 't')`)
	u2 = ins(`INSERT INTO users (username, hash, updated_at, created_at) VALUES ('tok-two', 'x', 't', 't')`)
	ws1 = ins(`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (?, 'zh', 'w1', 't')`, u1)
	ws2 = ins(`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (?, 'zh', 'w2', 't')`, u2)
	return sqlDB, path, u1, u2, ws1, ws2
}

func req(name, scope string, days int, ws *int64) auth.TokenRequest {
	return auth.TokenRequest{Name: name, Scope: scope, ExpiresInDays: days, WorkspaceID: ws}
}

// The format fixture shared with the web client.
func TestTokenFormatFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/auth/tokens-format.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Prefix  string   `json:"prefix"`
		Regex   string   `json:"regex"`
		Valid   []string `json:"valid"`
		Invalid []string `json:"invalid"`
		Hint    []struct{ Token, Hint string }
		SHA256  struct{ Token, Hash string } `json:"sha256"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Prefix != auth.TokenPrefix || fx.Regex != tokenShape.String() {
		t.Errorf("prefix/regex %q %q", fx.Prefix, fx.Regex)
	}
	for _, s := range fx.Valid {
		if !auth.IsTokenShaped(s) {
			t.Errorf("valid %q refused", s)
		}
	}
	for _, s := range fx.Invalid {
		if auth.IsTokenShaped(s) {
			t.Errorf("invalid %q accepted", s)
		}
	}
	for _, h := range fx.Hint {
		if got := auth.TokenHintForTest(h.Token); got != h.Hint {
			t.Errorf("hint(%s) = %q, want %q", h.Token, got, h.Hint)
		}
	}
	if got := auth.HashTokenForTest(fx.SHA256.Token); got != fx.SHA256.Hash {
		t.Errorf("hash = %s, fixture %s", got, fx.SHA256.Hash)
	}
}

func TestCreateTokenFormatAndEntropy(t *testing.T) {
	sqlDB, _, u1, _, _, _ := tokenDB(t)
	ctx := context.Background()
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		tok, info, err := auth.CreateTokenUnlimitedForTest(ctx, sqlDB, u1, req("n", "read", 1, nil))
		if err != nil {
			t.Fatal(err)
		}
		if !tokenShape.MatchString(tok) || seen[tok] {
			t.Fatalf("token %d malformed or repeated", i)
		}
		seen[tok] = true
		if info.Hint != tok[7:13] {
			t.Fatalf("hint %q is not the 6 characters after the prefix", info.Hint)
		}
	}
}

// Matrix 1: only the SHA-256 and the hint are stored; the plaintext is
// nowhere in the database file.
func TestCreateTokenStoresOnlyTheHash(t *testing.T) {
	sqlDB, path, u1, _, _, _ := tokenDB(t)
	tok, info, err := auth.CreateToken(context.Background(), sqlDB, u1, req("cron", "write", 90, nil))
	if err != nil {
		t.Fatal(err)
	}
	var hash, hint string
	if err := sqlDB.QueryRow(`SELECT token_hash, hint FROM access_tokens WHERE id = ?`, info.ID).Scan(&hash, &hint); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(tok))
	if hash != hex.EncodeToString(sum[:]) || hint != tok[7:13] {
		t.Errorf("stored %q %q", hash, hint)
	}
	if _, err := sqlDB.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{path, path + "-wal", path + "-shm"} {
		b, err := os.ReadFile(f)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(b, []byte(tok)) || bytes.Contains(b, []byte(tok[7:])) {
			t.Errorf("%s holds the plaintext token", filepath.Base(f))
		}
	}
	// The audit row names no secret.
	var detail string
	if err := sqlDB.QueryRow(`SELECT detail FROM auth_audit WHERE action = 'token_created'`).Scan(&detail); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(detail, tok[7:13]) || strings.Contains(detail, "cron") {
		t.Errorf("audit detail %s carries the hint or the name", detail)
	}
	var d map[string]any
	json.Unmarshal([]byte(detail), &d)
	if d["tokenId"] != float64(info.ID) || d["scope"] != "write" || d["days"] != float64(90) || d["limited"] != false {
		t.Errorf("audit detail %v", d)
	}
}

func TestCreateTokenValidates(t *testing.T) {
	sqlDB, _, u1, _, ws1, ws2 := tokenDB(t)
	ctx := context.Background()
	long := strings.Repeat("字", 65)
	for _, c := range []struct {
		r     auth.TokenRequest
		field string
	}{
		{req("", "read", 30, nil), "name"},
		{req(" \t ", "read", 30, nil), "name"},
		{req("\x00\x01", "read", 30, nil), "name"},
		{req(long, "read", 30, nil), "name"},
		{req("n", "admin", 30, nil), "scope"},
		{req("n", "", 30, nil), "scope"},
		{req("n", "read", 0, nil), "expiresInDays"},
		{req("n", "read", 366, nil), "expiresInDays"},
		{req("n", "read", -1, nil), "expiresInDays"},
	} {
		_, _, err := auth.CreateToken(ctx, sqlDB, u1, c.r)
		var re *auth.TokenRequestError
		if !errors.As(err, &re) || !errors.Is(err, auth.ErrTokenRequest) || re.Field != c.field {
			t.Errorf("%+v: err %v, want field %s", c.r, err, c.field)
		}
	}
	// 64 runes after trimming, control characters dropped, is fine.
	_, info, err := auth.CreateToken(ctx, sqlDB, u1, req("  "+strings.Repeat("字", 64)+"\x07 ", "read", 365, &ws1))
	if err != nil || info.Name != strings.Repeat("字", 64) || info.WorkspaceID == nil || *info.WorkspaceID != ws1 {
		t.Errorf("64 runes: %+v %v", info, err)
	}
	if _, _, err := auth.CreateToken(ctx, sqlDB, u1, req("n", "read", 1, &ws2)); !errors.Is(err, auth.ErrWorkspaceNotFound) {
		t.Errorf("foreign workspace: %v", err)
	}
	missing := ws2 + 100
	if _, _, err := auth.CreateToken(ctx, sqlDB, u1, req("n", "read", 1, &missing)); !errors.Is(err, auth.ErrWorkspaceNotFound) {
		t.Errorf("unknown workspace: %v", err)
	}
}

// Matrix 20: the 21st live token is refused; an expired one does not count.
func TestCreateTokenLimit(t *testing.T) {
	sqlDB, _, u1, u2, _, _ := tokenDB(t)
	ctx := context.Background()
	for i := 0; i < auth.MaxTokens; i++ {
		if _, _, err := auth.CreateToken(ctx, sqlDB, u1, req("n", "read", 1, nil)); err != nil {
			t.Fatal(i, err)
		}
	}
	if _, _, err := auth.CreateToken(ctx, sqlDB, u1, req("n", "read", 1, nil)); !errors.Is(err, auth.ErrTokenLimit) {
		t.Fatalf("21st: %v", err)
	}
	if _, _, err := auth.CreateToken(ctx, sqlDB, u2, req("n", "read", 1, nil)); err != nil {
		t.Errorf("another user's first token: %v", err)
	}
	restore := auth.SetClockForTest(func() time.Time { return time.Now().Add(36 * time.Hour) })
	defer restore()
	if _, _, err := auth.CreateToken(ctx, sqlDB, u1, req("n", "read", 1, nil)); err != nil {
		t.Errorf("after expiry: %v", err)
	}
}

func TestListTokens(t *testing.T) {
	sqlDB, _, u1, u2, ws1, _ := tokenDB(t)
	ctx := context.Background()
	start := time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)
	cur := start
	restore := auth.SetClockForTest(func() time.Time { return cur })
	defer restore()
	_, a, _ := auth.CreateToken(ctx, sqlDB, u1, req("old", "read", 1, nil))
	cur = start.Add(time.Minute)
	tokB, b, _ := auth.CreateToken(ctx, sqlDB, u1, req("new", "write", 30, &ws1))
	auth.CreateToken(ctx, sqlDB, u2, req("theirs", "read", 30, nil))
	cur = start.Add(48 * time.Hour)
	list, err := auth.ListTokens(ctx, sqlDB, u1)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != b.ID || list[1].ID != a.ID {
		t.Fatalf("list %+v, want newest first, own only", list)
	}
	if list[1].Expired != true || list[0].Expired != false {
		t.Errorf("expired flags %v %v", list[0].Expired, list[1].Expired)
	}
	if list[0].ExpiresAt != "2026-12-16T12:01:00Z" || list[0].CreatedAt != "2026-11-16T12:01:00Z" || list[0].LastUsedAt != nil {
		t.Errorf("row %+v", list[0])
	}
	body, _ := json.Marshal(list)
	if strings.Contains(string(body), tokB) || strings.Contains(string(body), tokB[7:]) || strings.Contains(string(body), "hash") {
		t.Errorf("list leaks a secret: %s", body)
	}
	var keys []map[string]any
	json.Unmarshal(body, &keys)
	if len(keys[0]) != 9 {
		t.Errorf("row keys %v", keys[0])
	}
}

func TestRevokeTokens(t *testing.T) {
	sqlDB, _, u1, u2, _, _ := tokenDB(t)
	ctx := context.Background()
	_, a, _ := auth.CreateToken(ctx, sqlDB, u1, req("a", "read", 1, nil))
	auth.CreateToken(ctx, sqlDB, u1, req("b", "read", 1, nil))
	auth.CreateToken(ctx, sqlDB, u1, req("c", "read", 1, nil))
	_, theirs, _ := auth.CreateToken(ctx, sqlDB, u2, req("t", "read", 1, nil))
	if err := auth.RevokeToken(ctx, sqlDB, u1, theirs.ID); !errors.Is(err, auth.ErrTokenNotFound) {
		t.Errorf("foreign revoke: %v", err)
	}
	if err := auth.RevokeToken(ctx, sqlDB, u1, 99999); !errors.Is(err, auth.ErrTokenNotFound) {
		t.Errorf("unknown revoke: %v", err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM access_tokens WHERE id = ?`, theirs.ID).Scan(&n)
	if n != 1 {
		t.Error("the foreign token did not survive")
	}
	if err := auth.RevokeToken(ctx, sqlDB, u1, a.ID); err != nil {
		t.Fatal(err)
	}
	got, err := auth.RevokeAllTokens(ctx, sqlDB, u1)
	if err != nil || got != 2 {
		t.Errorf("revoke all = %d, %v", got, err)
	}
	sqlDB.QueryRow(`SELECT COUNT(*) FROM access_tokens`).Scan(&n)
	if n != 1 {
		t.Errorf("%d tokens left, want the other user's one", n)
	}
	rows, _ := sqlDB.Query(`SELECT detail FROM auth_audit WHERE action = 'token_revoked' ORDER BY id`)
	defer rows.Close()
	var details []string
	for rows.Next() {
		var d string
		rows.Scan(&d)
		details = append(details, d)
	}
	if len(details) != 2 || !strings.Contains(details[0], `"scope":"one"`) || !strings.Contains(details[0], `"tokenId":`+strconv.FormatInt(a.ID, 10)) || !strings.Contains(details[1], `"scope":"all"`) || !strings.Contains(details[1], `"count":2`) {
		t.Errorf("audit %v", details)
	}
}
