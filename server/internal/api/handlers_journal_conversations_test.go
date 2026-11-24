package api_test

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/journal"
)

// converseSpy wraps the fake: it records the turn requests and can block one.
type converseSpy struct {
	ai.Fake
	mu      sync.Mutex
	turns   []ai.ConverseRequest
	started chan struct{}
	release chan struct{}
}

func (p *converseSpy) Converse(ctx context.Context, c ai.Credentials, r ai.ConverseRequest) (ai.ConverseReply, error) {
	p.mu.Lock()
	p.turns = append(p.turns, r)
	p.mu.Unlock()
	if p.release != nil {
		p.started <- struct{}{}
		<-p.release
	}
	return p.Fake.Converse(ctx, c, r)
}

func wsQ(ws int64) string { return "?workspace=" + strconv.FormatInt(ws, 10) }

func (e journalEnv) startConversation(t *testing.T, topic, level string) journal.Conversation {
	t.Helper()
	r := doJSON(t, http.MethodPost, e.url, "/api/journal/conversations"+wsQ(e.ws), e.token, map[string]any{"topic": topic, "level": level})
	if r.StatusCode != 201 {
		t.Fatalf("start: %d %s", r.StatusCode, aiBodyOf(t, r))
	}
	var c journal.Conversation
	decodeJSON(t, r, &c)
	return c
}

func (e journalEnv) turn(t *testing.T, id, text string) *http.Response {
	t.Helper()
	return doJSON(t, http.MethodPost, e.url, "/api/journal/conversations/"+id+"/turn"+wsQ(e.ws), e.token, map[string]any{"text": text})
}

func (e journalEnv) getConversation(t *testing.T, id string) (journal.Conversation, int) {
	t.Helper()
	r := doJSON(t, http.MethodGet, e.url, "/api/journal/conversations/"+id+wsQ(e.ws), e.token, nil)
	var c journal.Conversation
	if r.StatusCode == 200 {
		decodeJSON(t, r, &c)
	}
	return c, r.StatusCode
}

// #185: every conversation route needs a user, is scoped to one of the
// caller's workspaces and never reaches another user's conversation.
func TestConversationRoutesAccess(t *testing.T) {
	e := newJournalEnv(t, ai.Fake{}, true)
	c := e.startConversation(t, "", "beginner")
	bob := registerUser(t, e.url, "bob", e.token)
	bobWS := createWorkspace(t, e.url, bob, "zh", "")
	routes := []struct{ method, path string }{
		{http.MethodGet, "/api/journal/conversations"},
		{http.MethodPost, "/api/journal/conversations"},
		{http.MethodGet, "/api/journal/conversations/" + c.ID},
		{http.MethodDelete, "/api/journal/conversations/" + c.ID},
		{http.MethodPost, "/api/journal/conversations/" + c.ID + "/turn"},
		{http.MethodPost, "/api/journal/conversations/" + c.ID + "/save"},
	}
	for _, rt := range routes {
		if r := doJSON(t, rt.method, e.url, rt.path+wsQ(e.ws), "", map[string]any{}); r.StatusCode != 401 {
			t.Errorf("%s %s without a token: %d", rt.method, rt.path, r.StatusCode)
		}
		if r := doJSON(t, rt.method, e.url, rt.path+wsQ(e.ws), bob, map[string]any{"topic": "", "level": "beginner", "text": "x"}); r.StatusCode != 404 {
			t.Errorf("%s %s in another user's workspace: %d, want 404", rt.method, rt.path, r.StatusCode)
		}
		if r := doJSON(t, rt.method, e.url, rt.path, e.token, map[string]any{}); r.StatusCode != 400 {
			t.Errorf("%s %s without a workspace: %d, want 400", rt.method, rt.path, r.StatusCode)
		}
	}
	// Bob in his own workspace, with Alice's conversation id: not found, and nothing of it changes.
	for _, rt := range routes[2:] {
		r := doJSON(t, rt.method, e.url, rt.path+wsQ(bobWS), bob, map[string]any{"text": "我很好。", "entryId": "E1", "date": "2026-11-24"})
		if r.StatusCode != 404 {
			t.Errorf("bob %s %s: %d, want 404", rt.method, rt.path, r.StatusCode)
		}
	}
	r := doJSON(t, http.MethodGet, e.url, "/api/journal/conversations"+wsQ(bobWS), bob, nil)
	var list []journal.ConversationSummary
	decodeJSON(t, r, &list)
	if len(list) != 0 {
		t.Errorf("bob lists %+v", list)
	}
	if got, st := e.getConversation(t, c.ID); st != 200 || len(got.Messages) != 0 {
		t.Errorf("alice's conversation after bob: %d %+v", st, got)
	}
}

func TestConversationFlow(t *testing.T) {
	spy := &converseSpy{}
	e := newJournalEnv(t, spy, true)
	doJSON(t, http.MethodPut, e.url, "/api/journal/settings"+wsQ(e.ws), e.token, map[string]any{"guidance": "be kind", "explanationLanguage": "de"})
	c := e.startConversation(t, " 周末 ", "elementary")
	if c.Topic != "周末" || c.Level != "elementary" || c.ID == "" || len(c.Messages) != 0 {
		t.Fatalf("started %+v", c)
	}

	// The partner opens.
	r := e.turn(t, c.ID, "")
	if r.StatusCode != 200 {
		t.Fatalf("opening: %d %s", r.StatusCode, aiBodyOf(t, r))
	}
	var got journal.Conversation
	decodeJSON(t, r, &got)
	if len(got.Messages) != 1 || got.Messages[0].Role != "partner" || got.Messages[0].Provider != "anthropic" || got.Messages[0].Model == "" {
		t.Fatalf("after the opening %+v", got)
	}
	// The learner answers: the message carries the journal's corrections, ids unique in the conversation.
	r = e.turn(t, c.ID, "我是很好。我去了公园。")
	decodeJSON(t, r, &got)
	if r.StatusCode != 200 || len(got.Messages) != 3 {
		t.Fatalf("turn: %d %+v", r.StatusCode, got)
	}
	learner := got.Messages[1]
	if learner.Role != "learner" || len(learner.Annotations) != 2 || learner.Annotations[0].ID != "m2a1" || learner.Annotations[0].Quote != "我是" ||
		learner.Annotations[0].Explanation != "Fake explanation in de" || learner.Annotations[1].Kind != "suggestion" {
		t.Errorf("learner message %+v", learner)
	}
	req := spy.turns[1]
	if req.Language != "zh" || req.Level != "elementary" || req.Topic != "周末" || req.ExplanationLanguage != "de" || req.Guidance != "be kind" ||
		req.Text != "我是很好。我去了公园。" || len(req.History) != 1 || req.History[0].Role != "partner" {
		t.Errorf("request %+v", req)
	}
	if len(req.Words) > ai.MaxConverseWords {
		t.Errorf("sent %d words", len(req.Words))
	}

	var list []journal.ConversationSummary
	decodeJSON(t, doJSON(t, http.MethodGet, e.url, "/api/journal/conversations"+wsQ(e.ws), e.token, nil), &list)
	if len(list) != 1 || list[0].MessageCount != 3 {
		t.Errorf("list %+v", list)
	}

	// Saved as an entry; the conversation is gone.
	r = doJSON(t, http.MethodPost, e.url, "/api/journal/conversations/"+c.ID+"/save"+wsQ(e.ws), e.token, map[string]any{"entryId": "E1", "date": "2026-11-24"})
	var entry journal.Entry
	decodeJSON(t, r, &entry)
	if r.StatusCode != 200 || entry.ID != "E1" || entry.Title != "周末" || !strings.HasPrefix(entry.Text, "> ") || !strings.Contains(entry.Text, "\n\n我是很好。") {
		t.Fatalf("save: %d %+v", r.StatusCode, entry)
	}
	if _, st := e.getConversation(t, c.ID); st != 404 {
		t.Errorf("after save: %d", st)
	}
	if r := doJSON(t, http.MethodGet, e.url, "/api/journal/entries/E1"+wsQ(e.ws), e.token, nil); r.StatusCode != 200 {
		t.Errorf("the entry: %d", r.StatusCode)
	}

	// Discard.
	d := e.startConversation(t, "", "advanced")
	if r := doJSON(t, http.MethodDelete, e.url, "/api/journal/conversations/"+d.ID+wsQ(e.ws), e.token, nil); r.StatusCode != 204 {
		t.Errorf("discard: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, e.url, "/api/journal/conversations/"+d.ID+wsQ(e.ws), e.token, nil); r.StatusCode != 404 {
		t.Errorf("discard twice: %d", r.StatusCode)
	}
}

func TestConversationRefusals(t *testing.T) {
	e := newJournalEnv(t, ai.Fake{}, true)
	code := func(r *http.Response) string {
		var b aiErrBody
		decodeJSON(t, r, &b)
		return strconv.Itoa(r.StatusCode) + " " + b.Error
	}
	post := func(body any) *http.Response {
		return doJSON(t, http.MethodPost, e.url, "/api/journal/conversations"+wsQ(e.ws), e.token, body)
	}
	if got := code(post(map[string]any{"topic": "", "level": "expert"})); got != "400 bad_request" {
		t.Errorf("unknown level: %s", got)
	}
	if got := code(post(map[string]any{"topic": strings.Repeat("字", 201), "level": "beginner"})); got != "400 bad_request" {
		t.Errorf("long topic: %s", got)
	}
	if got := code(post("x")); got != "400 bad_request" {
		t.Errorf("not json: %s", got)
	}
	c := e.startConversation(t, "", "beginner")
	if got := code(e.turn(t, c.ID, strings.Repeat("字", journal.MaxMessageRunes+1))); got != "413 too_long" {
		t.Errorf("long message: %s", got)
	}
	e.turn(t, c.ID, "")
	if got := code(e.turn(t, c.ID, "  ")); got != "422 empty" {
		t.Errorf("blank after the opening: %s", got)
	}
	if got := code(doJSON(t, http.MethodPost, e.url, "/api/journal/conversations/"+c.ID+"/save"+wsQ(e.ws), e.token, map[string]any{"entryId": "bad id!", "date": "2026-11-24"})); got != "400 bad_request" {
		t.Errorf("bad entry id: %s", got)
	}
	empty := e.startConversation(t, "", "beginner")
	if got := code(doJSON(t, http.MethodPost, e.url, "/api/journal/conversations/"+empty.ID+"/save"+wsQ(e.ws), e.token, map[string]any{"entryId": "E9", "date": "2026-11-24"})); got != "422 empty" {
		t.Errorf("save without messages: %s", got)
	}
	// A reply in another script is refused and nothing is stored.
	before, _ := e.getConversation(t, c.ID)
	if got := code(e.turn(t, c.ID, "[[fake:wrongscript]]你好")); got != "422 bad_reply" {
		t.Errorf("an English reply: %s", got)
	}
	if after, _ := e.getConversation(t, c.ID); len(after.Messages) != len(before.Messages) {
		t.Errorf("a refused reply stored %d messages", len(after.Messages)-len(before.Messages))
	}
	// A provider failure stores nothing either.
	if got := code(e.turn(t, c.ID, "[[fake:refusal]]")); got != "422 refused" {
		t.Errorf("refusal: %s", got)
	}
	if after, _ := e.getConversation(t, c.ID); len(after.Messages) != len(before.Messages) {
		t.Error("a failed turn stored the learner's message")
	}
	// Full: two more messages would pass the cap.
	uid := userID(t, e.db, "root")
	for seq := 2; seq < journal.MaxMessages; seq++ {
		if _, err := e.db.Exec(`INSERT INTO journal_messages (user_id, workspace_id, conversation_id, seq, role, text, annotations, created_at) VALUES (?, ?, ?, ?, 'learner', 'x', '[]', 't')`, uid, e.ws, c.ID, seq); err != nil {
			t.Fatal(err)
		}
	}
	if got := code(e.turn(t, c.ID, "好")); got != "409 conversation_full" {
		t.Errorf("full: %s", got)
	}
	// The open-conversation cap.
	for i := 0; i < journal.MaxConversations; i++ {
		post(map[string]any{"topic": "", "level": "beginner"})
	}
	if got := code(post(map[string]any{"topic": "", "level": "beginner"})); got != "409 conversation_limit" {
		t.Errorf("limit: %s", got)
	}
}

func TestConversationNeedsTheLearnersKey(t *testing.T) {
	spy := &converseSpy{}
	e := newJournalEnv(t, spy, false)
	c := e.startConversation(t, "", "beginner")
	var b aiErrBody
	r := e.turn(t, c.ID, "")
	decodeJSON(t, r, &b)
	if r.StatusCode != 409 || b.Error != "no_key" || len(spy.turns) != 0 {
		t.Errorf("without a key: %d %q, %d provider calls", r.StatusCode, b.Error, len(spy.turns))
	}
	if got, _ := e.getConversation(t, c.ID); len(got.Messages) != 0 {
		t.Errorf("stored %+v", got.Messages)
	}
}

func TestConversationRateLimited(t *testing.T) {
	e := newJournalEnv(t, ai.Fake{}, true) // the key check was call 1
	var last *http.Response
	for i := 0; i < 30; i++ {
		c := e.startConversation(t, "", "beginner")
		last = e.turn(t, c.ID, "")
		if i < 29 && last.StatusCode != 200 {
			t.Fatalf("opening %d: %d", i, last.StatusCode)
		}
		doJSON(t, http.MethodDelete, e.url, "/api/journal/conversations/"+c.ID+wsQ(e.ws), e.token, nil)
	}
	var b aiErrBody
	decodeJSON(t, last, &b)
	if last.StatusCode != 429 || b.Error != "rate_limited" || last.Header.Get("Retry-After") == "" {
		t.Errorf("past the hourly calls: %d %q", last.StatusCode, b.Error)
	}
}

// A conversation discarded while the partner was answering keeps nothing.
func TestConversationDiscardedDuringTheTurn(t *testing.T) {
	spy := &converseSpy{started: make(chan struct{}), release: make(chan struct{})}
	e := newJournalEnv(t, spy, true)
	c := e.startConversation(t, "", "beginner")
	done := make(chan *http.Response)
	go func() { done <- e.turn(t, c.ID, "") }()
	<-spy.started
	if r := doJSON(t, http.MethodDelete, e.url, "/api/journal/conversations/"+c.ID+wsQ(e.ws), e.token, nil); r.StatusCode != 204 {
		t.Fatalf("discard: %d", r.StatusCode)
	}
	close(spy.release)
	if r := <-done; r.StatusCode != 404 {
		t.Errorf("the late turn: %d, want 404", r.StatusCode)
	}
	var n int
	e.db.QueryRow(`SELECT COUNT(*) FROM journal_messages`).Scan(&n)
	if n != 0 {
		t.Errorf("%d messages left", n)
	}
}
