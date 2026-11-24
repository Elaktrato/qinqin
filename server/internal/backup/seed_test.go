package backup

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

func exec(t *testing.T, sqlDB sqlExecer, q string, args ...any) {
	t.Helper()
	if _, err := sqlDB.Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

type sqlExecer interface {
	Exec(string, ...any) (sql.Result, error)
}

func mkUser(t *testing.T, sqlDB *sql.DB, name string) int64 {
	t.Helper()
	res, err := sqlDB.Exec(`INSERT INTO users (username, hash, admin, updated_at, created_at, username_key) VALUES (?, 'HASH-'||?, 0, 't', 't', ?)`, name, name, name)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

// mkEntry inserts a live entry with one written form and returns its id.
func mkEntry(t *testing.T, sqlDB *sql.DB, lang, kind, ext, written string) int64 {
	t.Helper()
	res, err := sqlDB.Exec(`INSERT INTO entries (language, kind, ext_key, updated_at) VALUES (?, ?, ?, 't')`, lang, kind, ext)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	exec(t, sqlDB, `INSERT INTO forms (entry_id, text, ord, updated_at) VALUES (?, ?, 0, 't')`, id, written)
	return id
}

func mkLang(t *testing.T, sqlDB *sql.DB, codes ...string) {
	for _, c := range codes {
		exec(t, sqlDB, `INSERT OR IGNORE INTO languages (code, name, updated_at) VALUES (?, ?, 't')`, c, c)
	}
}

// seeded names what seedUserData created.
type seeded struct {
	UserID                  int64
	WS1, WS2                int64
	E1, E2                  int64 // entries
	Dict                    int64
	OwnSentence, PackSent   int64
	Book                    int64
	EventCount, PluginCount int
}

const (
	secretToken = "SECRET-SESSION-TOKEN-HASH"
	secretCT    = "SECRET-AI-CIPHERTEXT"
	secretTOTP  = "SECRET-TOTP-CIPHERTEXT"
	secretPhoto = "SECRET-PHOTO-ID"
)

// seedUserData gives user uid a row in every exported table and a secret in
// every skipped one. Entry ids come from e1/e2 (shared lexicon).
func seedUserData(t *testing.T, sqlDB *sql.DB, dataDir string, uid, e1, e2, dict int64) seeded {
	t.Helper()
	s := seeded{UserID: uid, E1: e1, E2: e2, Dict: dict}
	ins := func(q string, args ...any) int64 {
		res, err := sqlDB.Exec(q, args...)
		if err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	s.WS1 = ins(`INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, 'zh', '', ?, '2026-11-01T00:00:00Z')`,
		uid, fmt.Sprintf(`{"hiddenDictionaries":[%d]}`, dict))
	s.WS2 = ins(`INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, 'ja', 'JP', '{}', '2026-11-02T00:00:00Z')`, uid)
	s.OwnSentence = ins(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (?, '', ?, '你好吗', 'p', 't', 't')`, e1, uid)
	ins(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, deleted_at) VALUES (?, '', ?, 'GONE', 'p', 't', 't', 't')`, e1, uid)
	sqlDB.Exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at)
		SELECT ?, 'tatoeba', NULL, 'packsatz', 'p', 't', 't' WHERE NOT EXISTS (SELECT 1 FROM sentences WHERE source_pack = 'tatoeba' AND hanzi = 'packsatz')`, e2)
	sqlDB.QueryRow(`SELECT id FROM sentences WHERE source_pack = 'tatoeba' AND hanzi = 'packsatz'`).Scan(&s.PackSent)
	ev := func(id string, ws int64, ts, typ, payload string) {
		exec(t, sqlDB, `INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES (?, ?, ?, 'web', ?, ?, ?, ?)`, id, uid, ws, ts, typ, payload, ts)
		s.EventCount++
	}
	u := strconv.FormatInt(uid, 10)
	ev(evID(uid, "A"), s.WS1, "2026-11-10T09:00:00Z", "review", fmt.Sprintf(`{"cardId":"c-vocab-%d","mode":"vocab","grade":3}`, e1))
	ev(evID(uid, "B"), s.WS1, "2026-11-10T09:01:00Z", "review", fmt.Sprintf(`{"cardId":"c-reverse-%d","mode":"reverse","grade":2}`, e1))
	ev(evID(uid, "C"), s.WS1, "2026-11-11T09:00:00Z", "review", `{"cardId":"c-vocab-424242","mode":"vocab","grade":1}`)
	ev(evID(uid, "D"), s.WS2, "2026-11-12T09:00:00Z", "view", fmt.Sprintf(`{"entryId":%d}`, e2))
	pd := func(ws any, key, data string, modified any) {
		exec(t, sqlDB, `INSERT INTO keyed_rows (user_id, workspace_id, key, data, version, updated_at, modified_at) VALUES (?, ?, ?, ?, 2, '2026-11-10T08:00:00Z', COALESCE(?, '2026-11-10T08:00:00Z'))`, uid, ws, key, data, modified)
		s.PluginCount++
	}
	// Cards are typed study rows (migration 038); a backup carries them as
	// their legacy qinqin-flashcards rows.
	typed := func(ws int64, key, data string) {
		r, err := rows.FromLegacy(key, json.RawMessage(data))
		if err != nil {
			t.Fatalf("seed %s: %v", key, err)
		}
		r.M().WorkspaceID = ws
		if err := study.InsertStored(context.Background(), sqlDB, uid, r, 2, "2026-11-10T08:00:00Z", "2026-11-10T08:00:00Z", nil); err != nil {
			t.Fatal(err)
		}
		s.PluginCount++
	}
	typed(s.WS1, fmt.Sprintf("card:c-vocab-%d", e1), fmt.Sprintf(`{"id":"c-vocab-%d","kind":"vocab","entryId":%d,"deckIds":["general"],"createdAt":"2026-11-10T08:00:00Z"}`, e1, e1))
	typed(s.WS1, fmt.Sprintf("card:c-reverse-%d", e1), fmt.Sprintf(`{"id":"c-reverse-%d","kind":"reverse","entryId":%d,"deckIds":["general"],"createdAt":"2026-11-10T08:00:00Z","x-unknown":{"b":1,"a":2}}`, e1, e1))
	typed(s.WS2, "card:SENTCARD01", fmt.Sprintf(`{"id":"SENTCARD01","kind":"sentence","entryId":%d,"sentenceId":%d,"deckIds":[],"createdAt":"2026-11-10T08:00:00Z"}`, e2, s.PackSent))
	pd(nil, "vacation:01JD00000000000000000V001", fmt.Sprintf(`{"id":"01JD00000000000000000V001","from":"2026-12-20","to":"2026-12-27","scope":{"workspaces":[%d]}}`, s.WS1), "2026-11-13T00:00:00Z")
	pd(nil, "home-layout", `{"version":1,"widgets":["daily-goal"]}`, nil)
	// A typed tombstone is never exported.
	gone, _ := rows.FromLegacy("deck:GONE", json.RawMessage(`{"id":"GONE","name":"Gone","createdAt":"t"}`))
	gone.M().WorkspaceID = s.WS1
	deletedAt := "2026-11-10T09:00:00Z"
	if err := study.InsertStored(context.Background(), sqlDB, uid, gone, 3, deletedAt, deletedAt, &deletedAt); err != nil {
		t.Fatal(err)
	}
	exec(t, sqlDB, `INSERT INTO plugin_states (user_id, pack_id, enabled, ord, updated_at) VALUES (?, 'qinqin-flashcards', 1, 2, 't')`, uid)
	exec(t, sqlDB, `INSERT INTO user_edits (user_id, entry_id, written, readings, updated_at) VALUES (?, ?, 'edited', NULL, '2026-11-09T00:00:00Z')`, uid, e1)
	exec(t, sqlDB, `INSERT INTO user_time_zones (user_id, seq, zone, effective_from, created_at) VALUES (?, 0, 'Europe/Berlin', NULL, 't'), (?, 1, 'Asia/Tokyo', '2026-11-05T00:00:00Z', 't')`, uid, uid)
	s.Book = ins(`INSERT INTO library_books (user_id, workspace_id, language, title, source, source_id, chapter_count, position, created_at) VALUES (?, ?, 'zh', 'Book', 'upload', 's', 1, '0:0', 't')`, uid, s.WS1)
	exec(t, sqlDB, `INSERT INTO library_bookmarks (user_id, book_id, position, label, created_at) VALUES (?, ?, '0:0', 'mark', 't')`, uid, s.Book)
	exec(t, sqlDB, `INSERT INTO library_highlights (user_id, book_id, chapter, paragraph, start_cp, end_cp, text, created_at, updated_at) VALUES (?, ?, 0, 0, 0, 1, 'x', 't', 't')`, uid, s.Book)
	dir := filepath.Join(dataDir, "books", u)
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, strconv.FormatInt(s.Book, 10)+".json"), []byte(`[{"title":"One","paragraphs":[[{"text":"你好"}]]}]`), 0o644)
	// photo draft file + row (never exported)
	exec(t, sqlDB, `INSERT INTO journal_photos (id, user_id, workspace_id, created_at, last_seen_at) VALUES (?, ?, ?, 't', 't')`, secretPhoto+u, uid, s.WS1)
	jd := filepath.Join(dataDir, "journal", u)
	os.MkdirAll(jd, 0o755)
	os.WriteFile(filepath.Join(jd, secretPhoto+u), []byte("PHOTO"), 0o644)
	// security data: every one carries a recognisable secret
	exec(t, sqlDB, `INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, 't', 't')`, secretToken+u, uid)
	exec(t, sqlDB, `INSERT INTO ai_keys (user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at) VALUES (?, 'anthropic', ?, x'00', 'fp', 'h', 'm', 't')`, uid, []byte(secretCT))
	exec(t, sqlDB, `INSERT INTO mfa_totp (user_id, secret_ct, secret_nonce, secret_fp, confirmed_at, created_at) VALUES (?, ?, x'00', 'fp', 't', 't')`, uid, []byte(secretTOTP))
	exec(t, sqlDB, `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, 'SECRET-RECOVERY'||?)`, uid, u)
	return s
}

func newDict(t *testing.T, sqlDB *sql.DB, pack string) int64 {
	t.Helper()
	res, err := sqlDB.Exec(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at) VALUES (?, ?, '1', 'x', 'x', 't')`, pack, pack)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

// baseWorld is a fresh database with the languages, a dictionary, two
// entries and the two users of an isolation test.
type baseWorld struct {
	DB       *sql.DB
	Data     string
	E1, E2   int64
	Dict     int64
	Alice    seeded
	BobID    int64
	Bob      seeded
	AliceUID int64
}

func newWorld(t *testing.T) *baseWorld {
	t.Helper()
	w := &baseWorld{DB: dbtest.Open(t), Data: t.TempDir()}
	mkLang(t, w.DB, "zh", "ja")
	w.E1 = mkEntry(t, w.DB, "zh", "word", "cc-1", "你好")
	w.E2 = mkEntry(t, w.DB, "zh", "word", "cc-2", "世界")
	w.Dict = newDict(t, w.DB, "cc-cedict")
	w.AliceUID = mkUser(t, w.DB, "alice")
	w.BobID = mkUser(t, w.DB, "bobby")
	w.Alice = seedUserData(t, w.DB, w.Data, w.AliceUID, w.E1, w.E2, w.Dict)
	w.Bob = seedUserData(t, w.DB, w.Data, w.BobID, w.E1, w.E2, w.Dict)
	return w
}

// evID is a valid 26-character ULID-shaped event id unique per user and suffix.
func evID(uid int64, c string) string { return fmt.Sprintf("01JD000000000000000%06d%s", uid, c) }
