package api_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/api"
	"qinqin/internal/lang"
	"qinqin/internal/model"
	"qinqin/internal/pack"
	"qinqin/internal/sentences"
)

// examplesSpy wraps the fake: it records the requests, can answer fixed
// sentences and can block one call.
type examplesSpy struct {
	ai.Fake
	mu       sync.Mutex
	requests []ai.ExamplesRequest
	answer   []ai.ExampleSentence
	started  chan struct{}
	release  chan struct{}
}

func (p *examplesSpy) Examples(ctx context.Context, c ai.Credentials, r ai.ExamplesRequest) (ai.ExamplesReply, error) {
	p.mu.Lock()
	p.requests = append(p.requests, r)
	answer := p.answer
	p.mu.Unlock()
	if p.release != nil {
		p.started <- struct{}{}
		<-p.release
	}
	if answer != nil {
		return ai.ExamplesReply{Sentences: answer, Model: c.Model}, nil
	}
	return p.Fake.Examples(ctx, c, r)
}

func (p *examplesSpy) calls() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.requests)
}

const examplesJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY v1 "Ichidan verb">
<!ENTITY vt "transitive verb">
<!ENTITY n "noun (common) (futsuumeishi)">
]>
<JMdict>
<entry>
<ent_seq>1358280</ent_seq>
<k_ele><keb>食べる</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>たべる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><pos>&vt;</pos><gloss>to eat</gloss></sense>
</entry>
<entry>
<ent_seq>1374550</ent_seq>
<k_ele><keb>林檎</keb></k_ele>
<r_ele><reb>りんご</reb></r_ele>
<sense><pos>&n;</pos><gloss>apple</gloss></sense>
</entry>
</JMdict>
`

// examplesEnv is a journal env (zh workspaces, the key stored) with a small
// CC-CEDICT and JMdict installed.
type examplesEnv struct {
	journalEnv
	xuexi, nihao, taberu int64
}

func newExamplesEnv(t *testing.T, p ai.Provider, withKey bool, opts ...api.Option) examplesEnv {
	t.Helper()
	lang.Register(lang.Ja{})
	lang.Register(lang.Zh{})
	e := examplesEnv{journalEnv: newJournalEnvOpts(t, p, withKey, opts...)}
	lookupImport(t, e.db, pack.Manifest{ID: "cedict-ex", Name: "CC-CEDICT test", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "CC-CEDICT", Format: "cedict"}, "dictionary.txt",
		"學習 学习 [xue2 xi2] /to learn/to study/\n你好 你好 [ni3 hao3] /hello/\n喜歡 喜欢 [xi3 huan5] /to like/\n")
	lookupImport(t, e.db, pack.Manifest{ID: "jmdict-ex", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict"}, "jmdict.xml", examplesJMdict)
	e.xuexi = entryIDOf(t, e.db, "zh", "学习")
	e.nihao = entryIDOf(t, e.db, "zh", "你好")
	e.taberu = entryIDOf(t, e.db, "ja", "食べる")
	return e
}

func entryIDOf(t *testing.T, sqlDB *sql.DB, language, written string) int64 {
	t.Helper()
	var id int64
	if err := sqlDB.QueryRow(`SELECT e.id FROM entries e JOIN forms f ON f.entry_id = e.id
		WHERE e.language = ? AND f.text = ? AND e.deleted_at IS NULL ORDER BY e.id LIMIT 1`, language, written).Scan(&id); err != nil {
		t.Fatalf("entry %s %s: %v", language, written, err)
	}
	return id
}

var exampleReq atomic.Int64

func examplesPath(entry int64, rest string) string {
	return "/api/entries/" + strconv.FormatInt(entry, 10) + "/examples" + rest
}

type generated struct {
	Drafts   []sentences.Draft `json:"drafts"`
	Dropped  int               `json:"dropped"`
	Provider string            `json:"provider"`
	Model    string            `json:"model"`
}

func (e examplesEnv) generateAs(t *testing.T, token string, entry int64, level, requestID string) (*http.Response, generated) {
	t.Helper()
	r := doJSON(t, http.MethodPost, e.url, examplesPath(entry, ""), token, map[string]any{"level": level, "requestId": requestID})
	var g generated
	if r.StatusCode == 200 {
		decodeJSON(t, r, &g)
	}
	return r, g
}

func (e examplesEnv) generate(t *testing.T, entry int64) generated {
	t.Helper()
	r, g := e.generateAs(t, e.token, entry, "elementary", fmt.Sprintf("req%d", exampleReq.Add(1)))
	if r.StatusCode != 200 {
		t.Fatalf("generate: %d %s", r.StatusCode, aiBodyOf(t, r))
	}
	return g
}

func (e examplesEnv) entrySentences(t *testing.T, token string, entry int64) []model.Sentence {
	t.Helper()
	r := doJSON(t, http.MethodGet, e.url, "/api/entries/"+strconv.FormatInt(entry, 10), token, nil)
	var body struct {
		Sentences []model.Sentence `json:"sentences"`
	}
	decodeJSON(t, r, &body)
	return body.Sentences
}

// #186: every route needs a user, refuses access tokens by having no token
// rule, and never reaches another user's drafts or examples.
func TestExampleRoutesAccess(t *testing.T) {
	e := newExamplesEnv(t, ai.Fake{}, true)
	g := e.generate(t, e.xuexi)
	draft := g.Drafts[0].ID
	kept := doJSON(t, http.MethodPost, e.url, examplesPath(e.xuexi, fmt.Sprintf("/%d/keep", draft)), e.token, nil)
	if kept.StatusCode != 201 {
		t.Fatalf("keep: %d %s", kept.StatusCode, aiBodyOf(t, kept))
	}
	var s model.Sentence
	decodeJSON(t, kept, &s)
	other := g.Drafts[1].ID
	sentencePath := fmt.Sprintf("/api/entries/%d/sentences/%d", e.xuexi, s.ID)
	routes := []struct{ method, path string }{
		{http.MethodGet, examplesPath(e.xuexi, "")},
		{http.MethodPost, examplesPath(e.xuexi, "")},
		{http.MethodPost, examplesPath(e.xuexi, fmt.Sprintf("/%d/keep", other))},
		{http.MethodDelete, examplesPath(e.xuexi, fmt.Sprintf("/%d", other))},
		{http.MethodDelete, sentencePath},
	}
	body := map[string]any{"level": "beginner", "requestId": "bob-1"}
	for _, rt := range routes {
		if r := doJSON(t, rt.method, e.url, rt.path, "", body); r.StatusCode != 401 {
			t.Errorf("%s %s without a token: %d", rt.method, rt.path, r.StatusCode)
		}
	}
	bob := registerUser(t, e.url, "bob", e.token)
	for _, rt := range routes[2:] {
		if r := doJSON(t, rt.method, e.url, rt.path, bob, body); r.StatusCode != 404 {
			t.Errorf("bob %s %s: %d, want 404", rt.method, rt.path, r.StatusCode)
		}
	}
	r := doJSON(t, http.MethodGet, e.url, examplesPath(e.xuexi, ""), bob, nil)
	var v sentences.ExamplesView
	decodeJSON(t, r, &v)
	if len(v.Drafts) != 0 {
		t.Errorf("bob sees drafts %+v", v.Drafts)
	}
	for _, s := range e.entrySentences(t, bob, e.xuexi) {
		if s.AI != nil {
			t.Errorf("bob sees alice's AI example %+v", s)
		}
	}
	if r := doJSON(t, http.MethodGet, e.url, "/api/entries/"+strconv.FormatInt(e.xuexi, 10), "", nil); r.StatusCode == 200 {
		var anon struct {
			Sentences []model.Sentence `json:"sentences"`
		}
		decodeJSON(t, r, &anon)
		if len(anon.Sentences) != 0 {
			t.Errorf("an anonymous caller sees %+v", anon.Sentences)
		}
	}
	// Alice's draft and example are untouched by bob.
	if r := doJSON(t, http.MethodGet, e.url, examplesPath(e.xuexi, ""), e.token, nil); r.StatusCode == 200 {
		decodeJSON(t, r, &v)
		if len(v.Drafts) != len(g.Drafts)-1 {
			t.Errorf("alice's drafts after bob: %+v", v.Drafts)
		}
	}
	marked := 0
	for _, s := range e.entrySentences(t, e.token, e.xuexi) {
		if s.AI != nil {
			marked++
		}
	}
	if marked != 1 {
		t.Errorf("alice's AI examples after bob: %d", marked)
	}
	// Unknown entries and malformed ids are 404, bad bodies 400.
	for _, p := range []string{"/api/entries/999999/examples", "/api/entries/x/examples"} {
		if r := doJSON(t, http.MethodPost, e.url, p, e.token, body); r.StatusCode != 404 {
			t.Errorf("POST %s: %d, want 404", p, r.StatusCode)
		}
	}
	for _, b := range []map[string]any{{"level": "expert", "requestId": "a"}, {"level": "beginner"}, {"level": "beginner", "requestId": "a b"}} {
		if r := doJSON(t, http.MethodPost, e.url, examplesPath(e.xuexi, ""), e.token, b); r.StatusCode != 400 {
			t.Errorf("body %v: %d, want 400", b, r.StatusCode)
		}
	}
	if r := doJSON(t, http.MethodDelete, e.url, examplesPath(e.xuexi, fmt.Sprintf("/%d?reason=spam", other)), e.token, nil); r.StatusCode != 400 {
		t.Errorf("an unknown reason: %d, want 400", r.StatusCode)
	}
}

func TestExampleFlow(t *testing.T) {
	spy := &examplesSpy{}
	e := newExamplesEnv(t, spy, true)
	g := e.generate(t, e.xuexi)
	// The fake writes five sentences, one without the word: four drafts.
	if len(g.Drafts) != 4 || g.Dropped != 1 || g.Provider != "anthropic" || g.Model == "" {
		t.Fatalf("generated = %+v", g)
	}
	for _, d := range g.Drafts {
		if !strings.Contains(d.Hanzi, "学习") || d.Level != "elementary" || d.Provider != "anthropic" {
			t.Errorf("draft %+v", d)
		}
	}
	req := spy.requests[0]
	if req.Language != "zh" || req.Word != "学习" || req.Reading != "xué xí" || req.ReadingSystem != "pinyin" || req.ExactForm ||
		len(req.Glosses) != 2 || req.Level != "elementary" {
		t.Errorf("request = %+v", req)
	}
	// Keep one: it is an own sentence of the entry, marked, after the others.
	r := doJSON(t, http.MethodPost, e.url, examplesPath(e.xuexi, fmt.Sprintf("/%d/keep", g.Drafts[0].ID)), e.token, nil)
	var kept model.Sentence
	decodeJSON(t, r, &kept)
	if r.StatusCode != 201 || kept.AI == nil || kept.AI.Provider != "anthropic" || kept.Hanzi != g.Drafts[0].Hanzi {
		t.Fatalf("kept: %d %+v", r.StatusCode, kept)
	}
	list := e.entrySentences(t, e.token, e.xuexi)
	if len(list) != 1 || list[0].ID != kept.ID || list[0].AI == nil {
		t.Fatalf("entry sentences = %+v", list)
	}
	// The next generation does not repeat it and is told about it.
	e.generate(t, e.xuexi)
	if got := spy.requests[1].Existing; len(got) != 1 || got[0] != kept.Hanzi {
		t.Errorf("existing sent = %v", got)
	}
	// Report a draft, delete the kept example with a reason.
	v := e.examples(t)
	if r := doJSON(t, http.MethodDelete, e.url, examplesPath(e.xuexi, fmt.Sprintf("/%d?reason=unnatural", v.Drafts[0].ID)), e.token, nil); r.StatusCode != 204 {
		t.Fatalf("report a draft: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, e.url, fmt.Sprintf("/api/entries/%d/sentences/%d?reason=wrong_translation", e.xuexi, kept.ID), e.token, nil); r.StatusCode != 204 {
		t.Fatalf("delete the example: %d", r.StatusCode)
	}
	if list := e.entrySentences(t, e.token, e.xuexi); len(list) != 0 {
		t.Errorf("after delete: %+v", list)
	}
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM example_reports`).Scan(&n)
	if n != 2 {
		t.Errorf("%d reports, want 2", n)
	}
	// The second generation dropped the fake's first sentence (the kept example's
	// text, a duplicate) and the word-less one; one of its three drafts was reported.
	if v := e.examples(t); len(v.Drafts) != 2 || v.DefaultLevel != "elementary" {
		t.Errorf("examples = %+v", v)
	}
}

func (e examplesEnv) examples(t *testing.T) sentences.ExamplesView {
	t.Helper()
	r := doJSON(t, http.MethodGet, e.url, examplesPath(e.xuexi, ""), e.token, nil)
	var v sentences.ExamplesView
	decodeJSON(t, r, &v)
	return v
}

// A retry with the same request id answers the stored drafts without a
// second provider call.
func TestExampleRequestIsIdempotent(t *testing.T) {
	spy := &examplesSpy{}
	e := newExamplesEnv(t, spy, true)
	r1, g1 := e.generateAs(t, e.token, e.xuexi, "beginner", "same-1")
	r2, g2 := e.generateAs(t, e.token, e.xuexi, "beginner", "same-1")
	if r1.StatusCode != 200 || r2.StatusCode != 200 || spy.calls() != 1 || len(g2.Drafts) != len(g1.Drafts) || g2.Drafts[0].ID != g1.Drafts[0].ID || g2.Dropped != g1.Dropped {
		t.Fatalf("retry: %d %d, %d calls, %+v", r1.StatusCode, r2.StatusCode, spy.calls(), g2)
	}
	// While a call runs, a retry of it waits for the slot and then answers its drafts.
	spy.started, spy.release = make(chan struct{}), make(chan struct{})
	done := make(chan generated)
	go func() { _, g := e.generateAs(t, e.token, e.xuexi, "beginner", "slow-1"); done <- g }()
	<-spy.started
	busy, _ := e.generateAs(t, e.token, e.xuexi, "beginner", "slow-1")
	var b aiErrBody
	decodeJSON(t, busy, &b)
	if busy.StatusCode != 409 || b.Error != "in_flight" {
		t.Errorf("a retry while the call runs: %d %q", busy.StatusCode, b.Error)
	}
	close(spy.release)
	first := <-done
	spy.started, spy.release = nil, nil
	_, again := e.generateAs(t, e.token, e.xuexi, "beginner", "slow-1")
	if spy.calls() != 2 || len(again.Drafts) != len(first.Drafts) || again.Drafts[0].ID != first.Drafts[0].ID {
		t.Errorf("after the call: %d calls, %+v", spy.calls(), again)
	}
}

// The server's checks drop what does not fit; an answer with nothing left is
// 200 with no drafts.
func TestExampleChecksDropSentences(t *testing.T) {
	spy := &examplesSpy{answer: []ai.ExampleSentence{
		{Text: "我喜欢学习。", Reading: "wǒ xǐhuan xuéxí", Translation: "I like studying."},
		{Text: "I like 学习 very much.", Translation: "wrong script"},
		{Text: "我喜欢你。", Translation: "no word"},
		{Text: "我喜欢学习。", Translation: "a duplicate"},
		{Text: "学习很好。", Reading: "学习 hěn hǎo", Translation: "Studying is good."},
		{Text: "学习学习。", Translation: "past the five? no: the fourth kept"},
	}}
	e := newExamplesEnv(t, spy, true)
	g := e.generate(t, e.xuexi)
	if len(g.Drafts) != 3 || g.Dropped != 3 || g.Drafts[1].Pinyin != "" || g.Drafts[0].Pinyin != "wǒ xǐhuan xuéxí" {
		t.Fatalf("generated = %+v", g)
	}
	spy.mu.Lock()
	spy.answer = []ai.ExampleSentence{{Text: "你好。", Translation: "Hello."}}
	spy.mu.Unlock()
	g = e.generate(t, e.xuexi)
	// Nothing kept: the earlier undecided drafts stay (fix wave).
	if len(g.Drafts) != 3 || g.Dropped != 1 {
		t.Fatalf("nothing kept = %+v", g)
	}
}

// Inflected Japanese: 食べた counts for 食べる through the server's
// segmenter and lemmatizer, a sentence without the verb does not.
func TestExampleJapaneseInflection(t *testing.T) {
	spy := &examplesSpy{answer: []ai.ExampleSentence{
		{Text: "りんごを食べた。", Reading: "りんごをたべた", Translation: "I ate an apple."},
		{Text: "毎日食べています。", Reading: "まいにちたべています", Translation: "I am eating every day."},
		{Text: "りんごが好きです。", Translation: "I like apples."},
	}}
	e := newExamplesEnv(t, spy, true)
	g := e.generate(t, e.taberu)
	if len(g.Drafts) != 2 || g.Dropped != 1 || g.Drafts[0].Hanzi != "りんごを食べた。" {
		t.Fatalf("generated = %+v", g)
	}
	if r := spy.requests[0]; r.ReadingSystem != "kana" || r.Reading != "たべる" || r.ExactForm {
		t.Errorf("request = %+v", r)
	}
}

func TestExamplesNeedAKeyAndStopAtTheCap(t *testing.T) {
	spy := &examplesSpy{}
	e := newExamplesEnv(t, spy, false)
	r, _ := e.generateAs(t, e.token, e.xuexi, "beginner", "nokey-1")
	var b aiErrBody
	decodeJSON(t, r, &b)
	if r.StatusCode != 409 || b.Error != "no_key" || spy.calls() != 0 {
		t.Fatalf("without a key: %d %q, %d calls", r.StatusCode, b.Error, spy.calls())
	}
	// At the cap of kept examples the route answers examples_full before any call.
	for i := 0; i < sentences.MaxKeptPerEntry; i++ {
		if _, err := e.db.Exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, ai_provider, ai_model)
			VALUES (?, '', (SELECT id FROM users WHERE username = 'root'), ?, '', 't', '2026-11-24T00:00:00Z', 'anthropic', 'm')`, e.xuexi, fmt.Sprintf("学习%d。", i)); err != nil {
			t.Fatal(err)
		}
	}
	r, _ = e.generateAs(t, e.token, e.xuexi, "beginner", "full-1")
	decodeJSON(t, r, &b)
	if r.StatusCode != 409 || b.Error != "examples_full" || spy.calls() != 0 {
		t.Errorf("at the cap: %d %q, %d calls", r.StatusCode, b.Error, spy.calls())
	}
}

func TestExamplesRateLimited(t *testing.T) {
	e := newExamplesEnv(t, ai.Fake{}, true) // the key check was call 1
	var last *http.Response
	for i := 0; i < 30; i++ {
		last, _ = e.generateAs(t, e.token, e.nihao, "beginner", fmt.Sprintf("rl%d", i))
		if i < 29 && last.StatusCode != 200 {
			t.Fatalf("call %d: %d", i, last.StatusCode)
		}
	}
	var b aiErrBody
	decodeJSON(t, last, &b)
	if last.StatusCode != 429 || b.Error != "rate_limited" || last.Header.Get("Retry-After") == "" {
		t.Errorf("past the hourly calls: %d %q", last.StatusCode, b.Error)
	}
}

// Fix wave: a generation where every sentence was dropped is answered from its
// marker on a retry, without a second provider call.
func TestAnEmptyGenerationRetryIsFree(t *testing.T) {
	spy := &examplesSpy{answer: []ai.ExampleSentence{{Text: "你好。", Translation: "Hello."}}}
	e := newExamplesEnv(t, spy, true)
	_, g1 := e.generateAs(t, e.token, e.xuexi, "beginner", "empty-1")
	_, g2 := e.generateAs(t, e.token, e.xuexi, "beginner", "empty-1")
	if spy.calls() != 1 || g1.Dropped != 1 || g2.Dropped != 1 || len(g2.Drafts) != 0 {
		t.Fatalf("g1 %+v, g2 %+v, %d calls", g1, g2, spy.calls())
	}
}

// slotHook is a hook the test fills in once the env exists.
type slotHook struct {
	mu sync.Mutex
	fn func(kind, phase string)
}

func (h *slotHook) option() api.Option {
	return api.WithAISlotHook(func(kind, phase string) {
		h.mu.Lock()
		fn := h.fn
		h.mu.Unlock()
		if fn != nil {
			fn(kind, phase)
		}
	})
}

func (h *slotHook) set(fn func(kind, phase string)) {
	h.mu.Lock()
	h.fn = fn
	h.mu.Unlock()
}

// The generation is checked and stored while the call still holds the user's
// AI slot, so a retry with the same id can never slip in before it is stored.
func TestExamplesAreStoredBeforeTheSlotIsReleased(t *testing.T) {
	hook := &slotHook{}
	e := newExamplesEnv(t, ai.Fake{}, true, hook.option())
	var stored atomic.Int64
	hook.set(func(kind, phase string) {
		if kind == "examples" && phase == "releasing" {
			var n int64
			e.db.QueryRow(`SELECT COUNT(*) FROM example_generations WHERE request_id = 'slot-1'`).Scan(&n)
			stored.Store(n + 10) // 10: the hook ran
		}
	})
	if r, _ := e.generateAs(t, e.token, e.xuexi, "beginner", "slot-1"); r.StatusCode != 200 {
		t.Fatalf("generate: %d", r.StatusCode)
	}
	if got := stored.Load(); got != 11 {
		t.Fatalf("at the slot's release the generation was stored: %v (want 11)", got)
	}
}

// What changed while the call waited for the slot decides the answer: the cap
// reached is examples_full, the same request stored meanwhile is its answer;
// neither pays a provider call.
func TestExamplesRecheckUnderTheSlot(t *testing.T) {
	hook := &slotHook{}
	spy := &examplesSpy{}
	e := newExamplesEnv(t, spy, true, hook.option())
	hook.set(func(kind, phase string) {
		if kind != "examples" || phase != "acquired" {
			return
		}
		for i := 0; i < sentences.MaxKeptPerEntry; i++ {
			e.db.Exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, ai_provider, ai_model)
				VALUES (?, '', (SELECT id FROM users WHERE username = 'root'), ?, '', 't', '2026-11-24T00:00:00Z', 'anthropic', 'm')`, e.xuexi, fmt.Sprintf("学习%d。", i))
		}
	})
	r, _ := e.generateAs(t, e.token, e.xuexi, "beginner", "cap-1")
	var b aiErrBody
	decodeJSON(t, r, &b)
	if r.StatusCode != 409 || b.Error != "examples_full" || spy.calls() != 0 {
		t.Fatalf("cap reached under the slot: %d %q, %d calls", r.StatusCode, b.Error, spy.calls())
	}
	hook.set(func(kind, phase string) {
		if kind == "examples" && phase == "acquired" {
			e.db.Exec(`INSERT INTO example_generations (user_id, entry_id, request_id, level, dropped, provider, model, created_at)
				VALUES ((SELECT id FROM users WHERE username = 'root'), ?, 'twin-1', 'beginner', 4, 'anthropic', 'm', '2099-01-01T00:00:00Z')`, e.nihao)
		}
	})
	r, g := e.generateAs(t, e.token, e.nihao, "beginner", "twin-1")
	if r.StatusCode != 200 || g.Dropped != 4 || spy.calls() != 0 {
		t.Fatalf("stored under the slot: %d %+v, %d calls", r.StatusCode, g, spy.calls())
	}
}

// #185, fix wave: a turn whose conversation is discarded while it waits for the
// AI slot answers 404 (it answered 500: errors.Unwrap of a two-%w error is
// nil), and a turn is stored before the slot is released.
func TestConversationTurnUnderTheSlot(t *testing.T) {
	hook := &slotHook{}
	e := newExamplesEnv(t, ai.Fake{}, true, hook.option())
	c := e.startConversation(t, "", "beginner")
	hook.set(func(kind, phase string) {
		if kind == "converse" && phase == "acquired" {
			e.db.Exec(`DELETE FROM journal_conversations WHERE id = ?`, c.ID)
		}
	})
	if r := e.turn(t, c.ID, ""); r.StatusCode != 404 {
		t.Fatalf("a conversation gone under the slot: %d %s", r.StatusCode, aiBodyOf(t, r))
	}
	c2 := e.startConversation(t, "", "beginner")
	var stored atomic.Int64
	hook.set(func(kind, phase string) {
		if kind == "converse" && phase == "releasing" {
			var n int64
			e.db.QueryRow(`SELECT COUNT(*) FROM journal_messages WHERE conversation_id = ?`, c2.ID).Scan(&n)
			stored.Store(n + 10)
		}
	})
	if r := e.turn(t, c2.ID, ""); r.StatusCode != 200 {
		t.Fatalf("turn: %d", r.StatusCode)
	}
	if got := stored.Load(); got != 11 {
		t.Fatalf("at the slot's release the turn was stored: %v (want 11)", got)
	}
}
