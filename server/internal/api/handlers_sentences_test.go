package api_test

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/model"
	"qinqin/internal/pack"
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
	pk, err := pack.LoadPack(sentencesFixture)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	if _, err := sentences.ImportPack(ctx, sqlDB, pk); err != nil {
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

	// Bob's GET carries the pack rows and his own row, marked with its
	// owner. Anonymous callers and other users (the admin) see the pack
	// rows only: user sentences are private to their owner.
	if anon := getEntryBody(t, ts.URL, nihao); len(anon.Sentences) != 2 {
		t.Errorf("anonymous sentences of 你好 = %+v, want the pack's two only", anon.Sentences)
	}
	if other := getEntryBodyAs(t, ts.URL, nihao, admin); len(other.Sentences) != 2 {
		t.Errorf("admin's sentences of 你好 = %+v, want the pack's two only", other.Sentences)
	}
	body = getEntryBodyAs(t, ts.URL, nihao, bob)
	if len(body.Sentences) != 3 {
		t.Fatalf("bob's sentences of 你好 after his post = %+v, want three", body.Sentences)
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

	// Over-long fields are 422 (2000 runes each; CJK counts by rune, not
	// byte), and a body over 16 KiB is 413.
	long := strings.Repeat("字", 2001)
	for name, req := range map[string]map[string]string{
		"long hanzi":       {"hanzi": long},
		"long pinyin":      {"hanzi": "你好。", "pinyin": strings.Repeat("a", 2001)},
		"long translation": {"hanzi": "你好。", "translation": strings.Repeat("a", 2001)},
	} {
		if resp := doJSON(t, http.MethodPost, ts.URL, path+"/sentences", bob, req); resp.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("POST %s: status = %d, want %d", name, resp.StatusCode, http.StatusUnprocessableEntity)
		}
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, path+"/sentences", bob, map[string]string{
		"hanzi": "你好。", "translation": strings.Repeat("a", 17*1024),
	}); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("POST oversized body: status = %d, want %d", resp.StatusCode, http.StatusRequestEntityTooLarge)
	}
	// Exactly 2000 runes of CJK (6000 bytes) is fine.
	{
		resp := doJSON(t, http.MethodPost, ts.URL, path+"/sentences", bob, map[string]string{"hanzi": strings.Repeat("字", 2000)})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("POST 2000-rune sentence: status = %d, want %d", resp.StatusCode, http.StatusCreated)
		}
		var got model.Sentence
		decodeJSON(t, resp, &got)
		if _, err := sqlDB.Exec(`DELETE FROM sentences WHERE id = ?`, got.ID); err != nil {
			t.Fatalf("remove 2000-rune sentence: %v", err)
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
	body = getEntryBodyAs(t, ts.URL, nihao, bob)
	if len(body.Sentences) != 1 || body.Sentences[0].ID != stored.ID ||
		body.Sentences[0].UserID == nil || *body.Sentences[0].UserID != bobID {
		t.Errorf("sentences of 你好 after uninstall = %+v, want only bob's", body.Sentences)
	}
	// The already-uninstalled pack is 404.
	if resp := doJSON(t, http.MethodDelete, ts.URL, packPath, admin, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("DELETE uninstalled pack: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

// getEntryBodyAs is getEntryBody with the caller's bearer token.
func getEntryBodyAs(t *testing.T, tsURL string, id int64, token string) entryBody {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, "/api/entries/"+strconv.FormatInt(id, 10), token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/entries/%d: status = %d, want %d", id, resp.StatusCode, http.StatusOK)
	}
	var body entryBody
	decodeJSON(t, resp, &body)
	return body
}

// Saved sentences (#279): a POST of a text the caller already sees on the
// entry answers that sentence (200) instead of a second row; DELETE removes
// any own sentence, never a pack one or another user's; a reason is only
// for AI examples.
func TestSavedSentenceRoutes(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	ctx := context.Background()
	importSchemeCedict(t, sqlDB)
	nihao := lexID(t, sqlDB, "zh", "word", "你好")
	pk, err := pack.LoadPack(sentencesFixture)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sentences.ImportPack(ctx, sqlDB, pk); err != nil {
		t.Fatal(err)
	}
	admin := registerUser(t, ts.URL, "admin", "")
	bob := registerUser(t, ts.URL, "bob", admin)
	path := "/api/entries/" + strconv.FormatInt(nihao, 10) + "/sentences"

	post := func(token, hanzi string) (int, model.Sentence) {
		t.Helper()
		resp := doJSON(t, http.MethodPost, ts.URL, path, token, map[string]string{"hanzi": hanzi})
		var got model.Sentence
		decodeJSON(t, resp, &got)
		return resp.StatusCode, got
	}
	code, first := post(bob, "他说你好。")
	if code != http.StatusCreated {
		t.Fatalf("first POST = %d", code)
	}
	if code, again := post(bob, " 他说你好。　"); code != http.StatusOK || again.ID != first.ID {
		t.Fatalf("the same text again = %d %+v, want 200 with sentence %d", code, again, first.ID)
	}
	// A pack sentence with the same text is the one answered.
	if code, packed := post(bob, "你好吗？"); code != http.StatusOK || packed.SourcePack != "zh-mini" {
		t.Fatalf("a pack sentence's text = %d %+v, want 200 with the pack sentence", code, packed)
	}
	// Another user's sentence is private: the admin gets a row of their own.
	if code, theirs := post(admin, "他说你好。"); code != http.StatusCreated || theirs.ID == first.ID {
		t.Fatalf("another user's text = %d %+v, want their own row", code, theirs)
	}
	if n := len(getEntryBodyAs(t, ts.URL, nihao, bob).Sentences); n != 3 {
		t.Fatalf("bob sees %d sentences, want the pack's two and his one", n)
	}

	one := path + "/" + strconv.FormatInt(first.ID, 10)
	if r := doJSON(t, http.MethodDelete, ts.URL, one, "", nil); r.StatusCode != http.StatusUnauthorized {
		t.Errorf("DELETE without a session = %d, want 401", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, ts.URL, one, admin, nil); r.StatusCode != http.StatusNotFound {
		t.Errorf("DELETE another user's sentence = %d, want 404", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, ts.URL, one+"?reason=unnatural", bob, nil); r.StatusCode != http.StatusBadRequest {
		t.Errorf("a report of a saved sentence = %d, want 400", r.StatusCode)
	}
	var packID int64
	if err := sqlDB.QueryRow(`SELECT id FROM sentences WHERE source_pack = 'zh-mini' LIMIT 1`).Scan(&packID); err != nil {
		t.Fatal(err)
	}
	if r := doJSON(t, http.MethodDelete, ts.URL, path+"/"+strconv.FormatInt(packID, 10), bob, nil); r.StatusCode != http.StatusNotFound {
		t.Errorf("DELETE a pack sentence = %d, want 404", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, ts.URL, one, bob, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE own sentence = %d, want 204", r.StatusCode)
	}
	if n := len(getEntryBodyAs(t, ts.URL, nihao, bob).Sentences); n != 2 {
		t.Fatalf("bob sees %d sentences after the delete, want 2", n)
	}
	// Saved again after a removal, it is a new row.
	if code, back := post(bob, "他说你好。"); code != http.StatusCreated || back.ID == first.ID {
		t.Fatalf("saved again = %d %+v", code, back)
	}
}
