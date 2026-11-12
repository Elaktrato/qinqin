// Package sentences_test exercises the sentence store end to end: pack
// imports over a real SQLite database, user additions over real HTTP.
package sentences_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/auth"
	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/model"
	"qinqin/internal/sentences"
)

// zhMini is the shared sentences pack fixture, relative to this
// package's test working directory.
const zhMini = "testdata/zh-mini"

// newDB opens a fresh migrated database.
func newDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// mustEntry upserts one zh entry and returns its id.
func mustEntry(t *testing.T, st entries.Store, kind, written, pinyin string) int64 {
	t.Helper()
	id, err := st.Upsert(context.Background(), &model.Entry{
		Language: "zh",
		Kind:     kind,
		Written:  written,
		Readings: []model.Reading{{Type: "pinyin", Value: pinyin}},
	})
	if err != nil {
		t.Fatalf("upsert %s (%s): %v", written, kind, err)
	}
	return id
}

// sentencesManifest is the manifest of a test sentences pack.
func sentencesManifest(id, format string) string {
	return `{"id":"` + id + `","name":"Test sentences","version":"1.0","type":"sentences",` +
		`"language":"zh","license":"CC BY-SA 4.0","attribution":"Qinqin test fixtures",` +
		`"format":"` + format + `"}`
}

// buildPackFormat writes a manifest.json of the given format and a
// sentences.json into a fresh temp directory and loads the pack from
// there. An empty sentencesJSON writes no data file.
func buildPackFormat(t *testing.T, id, format, sentencesJSON string) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(sentencesManifest(id, format)), 0o644); err != nil {
		t.Fatalf("write manifest.json: %v", err)
	}
	if sentencesJSON != "" {
		if err := os.WriteFile(filepath.Join(dir, "sentences.json"), []byte(sentencesJSON), 0o644); err != nil {
			t.Fatalf("write sentences.json: %v", err)
		}
	}
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("load pack %s: %v", id, err)
	}
	return pack
}

// buildPack writes a manifest.json (format json) and sentences.json
// into a fresh temp directory and loads the pack from there.
func buildPack(t *testing.T, id, sentencesJSON string) dict.Pack {
	t.Helper()
	return buildPackFormat(t, id, "json", sentencesJSON)
}

// newServer opens a fresh migrated database and serves the API on it.
func newServer(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	sqlDB := newDB(t)
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
	t.Cleanup(ts.Close)
	return ts, sqlDB
}

// registerFirstUser creates the first user — the instance admin —
// through the API and returns its id and bearer token.
func registerFirstUser(t *testing.T, tsURL, username string) (int64, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": "pw-" + username})
	resp, err := http.Post(tsURL+"/api/auth/register", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("register %s: %v", username, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register %s: status = %d, want %d", username, resp.StatusCode, http.StatusCreated)
	}
	var u model.User
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode register response: %v", err)
	}

	login, err := http.Post(tsURL+"/api/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("login %s: %v", username, err)
	}
	defer login.Body.Close()
	if login.StatusCode != http.StatusOK {
		t.Fatalf("login %s: status = %d, want %d", username, login.StatusCode, http.StatusOK)
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(login.Body).Decode(&out); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	return u.ID, out.Token
}

// postJSON posts body to path with the given bearer token ("" for
// none) and returns the undecoded response.
func postJSON(t *testing.T, tsURL, path, token string, body any) *http.Response {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request body: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, tsURL+path, bytes.NewReader(b))
	if err != nil {
		t.Fatalf("build POST %s: %v", path, err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestSentencePackImport(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	st := entries.Store{DB: sqlDB}
	nihao := mustEntry(t, st, "word", "你好", "nǐ hǎo")
	xiexie := mustEntry(t, st, "word", "谢谢", "xiè xie")
	// 你 is a character entry only: a pack sentence for the word 你
	// must not match it.
	mustEntry(t, st, "character", "你", "nǐ")

	pack, err := dict.LoadPack(zhMini)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	res, err := sentences.ImportPack(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("import fixture pack: %v", err)
	}
	if res.Sentences != 3 || !slices.Equal(res.Skipped, []string{}) {
		t.Errorf("import result = %+v, want 3 sentences, nothing skipped", res)
	}

	// The sentences link to their word entries, labeled with the pack,
	// in pack order.
	for _, tc := range []struct {
		entry int64
		want  []model.Sentence
	}{
		{nihao, []model.Sentence{
			{EntryID: nihao, SourcePack: "zh-mini", Hanzi: "你好，世界。", Pinyin: "nǐ hǎo, shì jiè.", Translation: "Hello, world."},
			{EntryID: nihao, SourcePack: "zh-mini", Hanzi: "你好吗？", Pinyin: "nǐ hǎo ma?", Translation: "How are you?"},
		}},
		{xiexie, []model.Sentence{
			{EntryID: xiexie, SourcePack: "zh-mini", Hanzi: "谢谢你。", Pinyin: "xiè xie nǐ.", Translation: "Thank you."},
		}},
	} {
		got, err := sentences.ForEntry(ctx, sqlDB, tc.entry)
		if err != nil {
			t.Fatalf("sentences of entry %d: %v", tc.entry, err)
		}
		if len(got) != len(tc.want) {
			t.Fatalf("sentences of entry %d = %+v, want %d", tc.entry, got, len(tc.want))
		}
		for i, want := range tc.want {
			s := got[i]
			if s.ID == 0 || s.EntryID != want.EntryID || s.SourcePack != want.SourcePack ||
				s.UserID != nil || s.Hanzi != want.Hanzi || s.Pinyin != want.Pinyin ||
				s.Translation != want.Translation || s.UpdatedAt.IsZero() || s.DeletedAt != nil {
				t.Errorf("sentence %d of entry %d = %+v, want %+v", i, tc.entry, s, want)
			}
		}
	}

	// Words no word entry matches are skipped and reported — 电脑 has
	// no entry at all, and 你 exists only as a character — and nothing
	// is written for them.
	for name, tc := range map[string]struct {
		sentencesJSON string
		skipped       []string
	}{
		"unknown word":   {`{"entries":[{"word":"电脑","sentences":[{"hanzi":"我有电脑。","pinyin":"wǒ yǒu diàn nǎo.","translation":"I have a computer."}]}]}`, []string{"电脑"}},
		"character only": {`{"entries":[{"word":"你","sentences":[{"hanzi":"你好！","pinyin":"nǐ hǎo!","translation":"Hi!"}]}]}`, []string{"你"}},
	} {
		res, err := sentences.ImportPack(ctx, sqlDB, buildPack(t, "skip-"+name, tc.sentencesJSON))
		if err != nil {
			t.Fatalf("import %s: %v", name, err)
		}
		if res.Sentences != 0 || !slices.Equal(res.Skipped, tc.skipped) {
			t.Errorf("import %s result = %+v, want 0 sentences, %v skipped", name, res, tc.skipped)
		}
	}
	var active int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sentences WHERE deleted_at IS NULL`).Scan(&active); err != nil {
		t.Fatalf("count active sentences: %v", err)
	}
	if active != 3 {
		t.Errorf("active sentences = %d, want the fixture's 3 — nothing written for skipped words", active)
	}
	var entryCount int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entries`).Scan(&entryCount); err != nil {
		t.Fatalf("count entries: %v", err)
	}
	if entryCount != 3 {
		t.Errorf("entries = %d, want the 3 seeded rows, no new ones", entryCount)
	}
}

func TestUserSentenceAdded(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	ctx := context.Background()
	nihao := mustEntry(t, entries.Store{DB: sqlDB}, "word", "你好", "nǐ hǎo")

	uid, token := registerFirstUser(t, ts.URL, "alice")
	resp := postJSON(t, ts.URL, "/api/entries/"+strconv.FormatInt(nihao, 10)+"/sentences", token, map[string]string{
		"hanzi": "大家好。", "pinyin": "dà jiā hǎo.", "translation": "Hello, everyone.",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST sentence: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	var stored model.Sentence
	if err := json.NewDecoder(resp.Body).Decode(&stored); err != nil {
		t.Fatalf("decode stored sentence: %v", err)
	}
	if stored.ID == 0 || stored.EntryID != nihao || stored.SourcePack != "" ||
		stored.UserID == nil || *stored.UserID != uid || stored.Hanzi != "大家好。" ||
		stored.Pinyin != "dà jiā hǎo." || stored.Translation != "Hello, everyone." {
		t.Errorf("stored sentence = %+v, want alice's sentence on 你好", stored)
	}

	// The sentence appears in ForEntry, marked user-owned: it carries
	// its owner and no source pack.
	got, err := sentences.ForEntry(ctx, sqlDB, nihao)
	if err != nil {
		t.Fatalf("sentences of 你好: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("sentences of 你好 = %+v, want alice's one", got)
	}
	s := got[0]
	if s.ID != stored.ID || s.EntryID != nihao || s.SourcePack != "" ||
		s.UserID == nil || *s.UserID != uid ||
		s.Hanzi != "大家好。" || s.Pinyin != "dà jiā hǎo." || s.Translation != "Hello, everyone." ||
		s.UpdatedAt.IsZero() || s.DeletedAt != nil {
		t.Errorf("sentence of 你好 = %+v, want alice's user-owned row", s)
	}
}

func TestReimportKeepsUserSentences(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	st := entries.Store{DB: sqlDB}
	nihao := mustEntry(t, st, "word", "你好", "nǐ hǎo")

	pack, err := dict.LoadPack(zhMini)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	if _, err := sentences.ImportPack(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import fixture pack: %v", err)
	}
	alice, err := auth.CreateUser(ctx, sqlDB, "alice", "pw-alice", false)
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}
	userSentenceID, err := sentences.AddUser(ctx, sqlDB, alice.ID, nihao, model.Sentence{
		Hanzi: "大家好。", Pinyin: "dà jiā hǎo.", Translation: "Hello, everyone.",
	})
	if err != nil {
		t.Fatalf("add alice's sentence: %v", err)
	}

	// Re-importing the pack — here a revision carrying one different
	// sentence under the same manifest id — replaces that pack's rows
	// only; alice's row survives untouched.
	revision := buildPack(t, "zh-mini", `{"entries":[{"word":"你好","sentences":[
		{"hanzi":"你好，朋友。","pinyin":"nǐ hǎo, péng yǒu.","translation":"Hello, friend."}]}]}`)
	res, err := sentences.ImportPack(ctx, sqlDB, revision)
	if err != nil {
		t.Fatalf("re-import pack: %v", err)
	}
	if res.Sentences != 1 || len(res.Skipped) != 0 {
		t.Errorf("re-import result = %+v, want 1 sentence, nothing skipped", res)
	}

	got, err := sentences.ForEntry(ctx, sqlDB, nihao)
	if err != nil {
		t.Fatalf("sentences of 你好: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("sentences of 你好 after re-import = %+v, want the pack's replacement plus alice's", got)
	}
	var userRow, packRow *model.Sentence
	for i := range got {
		if got[i].UserID != nil {
			userRow = &got[i]
		} else {
			packRow = &got[i]
		}
	}
	if userRow == nil || packRow == nil {
		t.Fatalf("sentences of 你好 after re-import = %+v, want one user row and one pack row", got)
	}
	if userRow.ID != userSentenceID || userRow.Hanzi != "大家好。" || *userRow.UserID != alice.ID ||
		userRow.SourcePack != "" || userRow.DeletedAt != nil {
		t.Errorf("alice's sentence after re-import = %+v, want her original row untouched", userRow)
	}
	if packRow.SourcePack != "zh-mini" || packRow.Hanzi != "你好，朋友。" || packRow.UserID != nil {
		t.Errorf("pack sentence after re-import = %+v, want the revision's 你好，朋友。", packRow)
	}

	// The superseded pack rows are tombstoned, not deleted; only the
	// pack's rows were swept. (The fixture's 谢谢 group was skipped —
	// no entry was seeded for it — so the first import wrote 2 rows.)
	var (
		active     int
		tombstoned int
	)
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sentences WHERE deleted_at IS NULL`).Scan(&active); err != nil {
		t.Fatalf("count active sentences: %v", err)
	}
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM sentences WHERE source_pack = 'zh-mini' AND deleted_at IS NOT NULL`).Scan(&tombstoned); err != nil {
		t.Fatalf("count tombstoned pack sentences: %v", err)
	}
	if active != 2 || tombstoned != 2 {
		t.Errorf("sentences after re-import = %d active, %d tombstoned pack rows, want 2 active, 2 tombstoned",
			active, tombstoned)
	}
}

func TestImportRejectsInvalidPacks(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()

	// A dictionary pack is not a sentences pack.
	dictPack, err := dict.LoadPack("../dict/testdata/mkgloss")
	if err != nil {
		t.Fatalf("load dictionary fixture: %v", err)
	}
	if _, err := sentences.ImportPack(ctx, sqlDB, dictPack); !errors.Is(err, sentences.ErrNotSentences) {
		t.Errorf("import dictionary pack err = %v, want ErrNotSentences", err)
	}

	for name, sentencesJSON := range map[string]string{
		"no entries":     `{"entries":[]}`,
		"blank word":     `{"entries":[{"word":"  ","sentences":[{"hanzi":"你好！","pinyin":"nǐ hǎo!","translation":"Hi!"}]}]}`,
		"blank hanzi":    `{"entries":[{"word":"你好","sentences":[{"hanzi":" ","pinyin":"nǐ hǎo!","translation":"Hi!"}]}]}`,
		"no pinyin":      `{"entries":[{"word":"你好","sentences":[{"hanzi":"你好！","translation":"Hi!"}]}]}`,
		"no translation": `{"entries":[{"word":"你好","sentences":[{"hanzi":"你好！","pinyin":"nǐ hǎo!"}]}]}`,
		"malformed json": `{"entries":`,
	} {
		if _, err := sentences.ImportPack(ctx, sqlDB, buildPack(t, "invalid-"+name, sentencesJSON)); !errors.Is(err, dict.ErrInvalidPack) {
			t.Errorf("import %s err = %v, want ErrInvalidPack", name, err)
		}
	}

	// A missing sentences.json and a non-json format are invalid too.
	if _, err := sentences.ImportPack(ctx, sqlDB, buildPack(t, "no-data", "")); !errors.Is(err, dict.ErrInvalidPack) {
		t.Errorf("import pack without sentences.json err = %v, want ErrInvalidPack", err)
	}
	if _, err := sentences.ImportPack(ctx, sqlDB, buildPackFormat(t, "cedict-format", "cedict", `{"entries":[]}`)); !errors.Is(err, dict.ErrInvalidPack) {
		t.Errorf("import cedict-format sentences pack err = %v, want ErrInvalidPack", err)
	}
}
