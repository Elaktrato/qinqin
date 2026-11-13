package api_test

import (
	"context"
	"net/http"
	"strconv"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/lang"
	"qinqin/internal/model"
	"qinqin/internal/sentences"
)

// sentencesFixture is the shared sentences pack fixture, relative to
// this package's test working directory.
const sentencesFixture = "../sentences/testdata/zh-mini"

func TestSentenceRoutes(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	ctx := context.Background()
	importSchemeCedict(t, sqlDB)
	nihao := lexID(t, sqlDB, "zh", "word", "你好")
	ni := lexID(t, sqlDB, "zh", "character", "你")

	// The admin layer dispatches sentence packs by manifest type; the
	// fixture imports through the library like the seed CLI does.
	pack, err := dict.LoadPack(sentencesFixture)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	if _, err := sentences.ImportPack(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import fixture pack: %v", err)
	}

	// Word GET carries the pack's sentences in pack order, labeled
	// with the source pack.
	body := getEntryBody(t, ts.URL, nihao)
	if len(body.Sentences) != 2 {
		t.Fatalf("sentences of 你好 = %+v, want the fixture's two", body.Sentences)
	}
	for i, want := range []model.Sentence{
		{EntryID: nihao, SourcePack: "zh-mini", Hanzi: "你好，世界。", Pinyin: "nǐ hǎo, shì jiè.", Translation: "Hello, world."},
		{EntryID: nihao, SourcePack: "zh-mini", Hanzi: "你好吗？", Pinyin: "nǐ hǎo ma?", Translation: "How are you?"},
	} {
		got := body.Sentences[i]
		if got.ID == 0 || got.EntryID != want.EntryID || got.SourcePack != want.SourcePack || got.UserID != nil ||
			got.Hanzi != want.Hanzi || got.Pinyin != want.Pinyin || got.Translation != want.Translation {
			t.Errorf("sentence %d of 你好 = %+v, want %+v", i, got, want)
		}
	}

	// An entry without sentences serves an empty array.
	if body := getEntryBody(t, ts.URL, ni); body.Sentences == nil || len(body.Sentences) != 0 {
		t.Errorf("sentences of 你 = %+v, want an empty array", body.Sentences)
	}

	// The admin is the first user; bob is a plain user.
	admin := registerUser(t, ts.URL, "admin", "")
	bob := registerUser(t, ts.URL, "bob", admin)
	var bobID int64
	if err := sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'bob'`).Scan(&bobID); err != nil {
		t.Fatalf("find bob: %v", err)
	}

	path := "/api/entries/" + strconv.FormatInt(nihao, 10)

	// Adding a sentence requires authentication.
	if resp := doJSON(t, http.MethodPost, ts.URL, path+"/sentences", "", map[string]string{
		"hanzi": "大家好。", "pinyin": "dà jiā hǎo.", "translation": "Hello, everyone.",
	}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("POST sentence without token: status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}

	// POST stores the caller's sentence, owned by them; the response
	// is the stored row.
	resp := doJSON(t, http.MethodPost, ts.URL, path+"/sentences", bob, map[string]string{
		"hanzi": "大家好。", "pinyin": "dà jiā hǎo.", "translation": "Hello, everyone.",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST sentence: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	var stored model.Sentence
	decodeJSON(t, resp, &stored)
	if stored.ID == 0 || stored.EntryID != nihao || stored.SourcePack != "" ||
		stored.UserID == nil || *stored.UserID != bobID || stored.Hanzi != "大家好。" ||
		stored.Pinyin != "dà jiā hǎo." || stored.Translation != "Hello, everyone." {
		t.Errorf("stored sentence = %+v, want bob's sentence on 你好", stored)
	}

	// Word GET carries pack and user rows alike; the user's row is
	// marked with its owner.
	body = getEntryBody(t, ts.URL, nihao)
	if len(body.Sentences) != 3 {
		t.Fatalf("sentences of 你好 after bob's post = %+v, want three", body.Sentences)
	}
	var bobs *model.Sentence
	for i := range body.Sentences {
		if body.Sentences[i].ID == stored.ID {
			bobs = &body.Sentences[i]
		}
	}
	if bobs == nil || bobs.UserID == nil || *bobs.UserID != bobID || bobs.SourcePack != "" {
		t.Errorf("bob's served sentence = %+v, want his row marked user-owned", bobs)
	}

	// The PUT response shares the entry body, sentences included.
	put := doJSON(t, http.MethodPut, ts.URL, path, bob, map[string]any{})
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT /api/entries/%d: status = %d, want %d", nihao, put.StatusCode, http.StatusOK)
	}
	var putBody entryBody
	decodeJSON(t, put, &putBody)
	if len(putBody.Sentences) != 3 {
		t.Errorf("PUT response sentences = %+v, want three", putBody.Sentences)
	}

	// Unknown and malformed entry ids are 404; malformed bodies and
	// missing sentence fields are 400.
	for _, bad := range []string{"/api/entries/999999/sentences", "/api/entries/NaN/sentences"} {
		if resp := doJSON(t, http.MethodPost, ts.URL, bad, bob, map[string]string{
			"hanzi": "你好。", "pinyin": "nǐ hǎo.", "translation": "Hello.",
		}); resp.StatusCode != http.StatusNotFound {
			t.Errorf("POST %s: status = %d, want %d", bad, resp.StatusCode, http.StatusNotFound)
		}
	}
	for name, req := range map[string]any{
		"malformed body":   "not-an-object",
		"empty hanzi":      map[string]any{"hanzi": "", "pinyin": "nǐ hǎo.", "translation": "Hello."},
		"whitespace hanzi": map[string]any{"hanzi": " 　\n"},
	} {
		if resp := doJSON(t, http.MethodPost, ts.URL, path+"/sentences", bob, req); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("POST %s: status = %d, want %d", name, resp.StatusCode, http.StatusBadRequest)
		}
	}

	// Reading and translation are optional: the reader saves the book
	// sentence a word was found in with its text only. Those rows are
	// removed again below so the counts after uninstall stay as before.
	for name, req := range map[string]map[string]string{
		"text only":      {"hanzi": "我们学习。"},
		"no translation": {"hanzi": "你好。", "pinyin": "nǐ hǎo."},
	} {
		resp := doJSON(t, http.MethodPost, ts.URL, path+"/sentences", bob, req)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("POST %s: status = %d, want %d", name, resp.StatusCode, http.StatusCreated)
		}
		var got model.Sentence
		decodeJSON(t, resp, &got)
		if got.ID == 0 || got.Hanzi != req["hanzi"] || got.Pinyin != req["pinyin"] || got.Translation != "" {
			t.Errorf("POST %s: stored = %+v, want the text with empty optional fields", name, got)
		}
		if _, err := sqlDB.Exec(`DELETE FROM sentences WHERE id = ?`, got.ID); err != nil {
			t.Fatalf("remove %s sentence: %v", name, err)
		}
	}

	// Uninstalling a pack's sentences is admin-only: anonymous and
	// non-admin calls are 403.
	packPath := "/api/admin/sentences/zh-mini"
	if resp := doJSON(t, http.MethodDelete, ts.URL, packPath, "", nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("DELETE sentences without token: status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}
	if resp := doJSON(t, http.MethodDelete, ts.URL, packPath, bob, nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("DELETE sentences as non-admin: status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}
	// Unknown packs are 404.
	if resp := doJSON(t, http.MethodDelete, ts.URL, "/api/admin/sentences/nope", admin, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("DELETE unknown pack: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}

	// Uninstall soft-deletes the pack's sentences; bob's survive.
	if resp := doJSON(t, http.MethodDelete, ts.URL, packPath, admin, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE sentences: status = %d, want %d", resp.StatusCode, http.StatusNoContent)
	}
	body = getEntryBody(t, ts.URL, nihao)
	if len(body.Sentences) != 1 || body.Sentences[0].ID != stored.ID ||
		body.Sentences[0].UserID == nil || *body.Sentences[0].UserID != bobID {
		t.Errorf("sentences of 你好 after uninstall = %+v, want only bob's", body.Sentences)
	}
	// The already-uninstalled pack is 404.
	if resp := doJSON(t, http.MethodDelete, ts.URL, packPath, admin, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("DELETE uninstalled pack: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}
