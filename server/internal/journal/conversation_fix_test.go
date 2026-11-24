package journal

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"qinqin/internal/dbtest"
)

// Fix wave (#185 review).

func openedConversation(t *testing.T, sqlDB *sql.DB, user, ws int64, id string) {
	t.Helper()
	if _, err := CreateConversation(context.Background(), sqlDB, user, ws, id, "", "beginner"); err != nil {
		t.Fatal(err)
	}
	if _, err := AppendTurn(context.Background(), sqlDB, user, ws, id, "open-"+id, nil, partner("你好！")); err != nil {
		t.Fatal(err)
	}
}

// A retried turn (the same client turn id) stores nothing twice.
func TestAppendTurnIsIdempotentByTurnID(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u := dbtest.User(t, sqlDB, "a")
	ws := dbtest.Workspace(t, sqlDB, u, "zh")
	openedConversation(t, sqlDB, u, ws, "c1")
	learner := Message{Role: "learner", Text: "我好。"}
	first, err := AppendTurn(ctx, sqlDB, u, ws, "c1", "t1", &learner, partner("好。"))
	if err != nil {
		t.Fatal(err)
	}
	again, err := AppendTurn(ctx, sqlDB, u, ws, "c1", "t1", &learner, partner("又好。"))
	if err != nil || len(again.Messages) != len(first.Messages) || len(again.Messages) != 3 {
		t.Fatalf("retry stored %d messages (first %d), %v", len(again.Messages), len(first.Messages), err)
	}
	if !HasTurn(again, "t1") || HasTurn(again, "t2") || again.Messages[1].TurnID != "t1" || again.Messages[2].TurnID != "t1" {
		t.Errorf("turn ids %+v", again.Messages)
	}
}

// Annotation ids come from the seq the message really gets, not from a
// snapshot the handler took before another tab's turn landed.
func TestAppendTurnNumbersAnnotationsFromTheStoredSeq(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u := dbtest.User(t, sqlDB, "a")
	ws := dbtest.Workspace(t, sqlDB, u, "zh")
	openedConversation(t, sqlDB, u, ws, "c1")
	// Another tab's turn lands first (seq 2 and 3).
	other := Message{Role: "learner", Text: "别的。", Annotations: []Annotation{{ID: "m2a1", Quote: "别", Correction: "另", Kind: "mistake"}}}
	if _, err := AppendTurn(ctx, sqlDB, u, ws, "c1", "tb", &other, partner("嗯。")); err != nil {
		t.Fatal(err)
	}
	// This tab computed its ids for seq 2 from its stale snapshot.
	mine := Message{Role: "learner", Text: "我是很好。", Annotations: []Annotation{{ID: "m2a1", Quote: "是很", Correction: "很", Kind: "mistake"}, {ID: "m2a2", Quote: "好", Correction: "棒", Kind: "suggestion"}}}
	c, err := AppendTurn(ctx, sqlDB, u, ws, "c1", "ta", &mine, partner("好。"))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, m := range c.Messages {
		for _, a := range m.Annotations {
			if seen[a.ID] {
				t.Errorf("annotation id %s twice", a.ID)
			}
			seen[a.ID] = true
		}
	}
	if got := c.Messages[3].Annotations; got[0].ID != "m4a1" || got[1].ID != "m4a2" {
		t.Errorf("ids %s %s, want m4a1 m4a2", got[0].ID, got[1].ID)
	}
}

// Every write transaction of the conversation store takes SQLite's write
// lock before it reads, so another connection's commit cannot invalidate its
// snapshot (SQLITE_BUSY_SNAPSHOT, a 500 after a paid call). The hook makes
// it deterministic: right after each begin it reads, and has another
// connection that does not wait for locks try to commit.
func TestConversationWritesTakeTheWriteLockFirst(t *testing.T) {
	sqlDB, path := dbtest.OpenPath(t)
	ctx := context.Background()
	u := dbtest.User(t, sqlDB, "a")
	ws := dbtest.Workspace(t, sqlDB, u, "zh")
	if _, err := sqlDB.Exec(`CREATE TABLE other_writes (n INTEGER)`); err != nil {
		t.Fatal(err)
	}
	other, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(0)&_pragma=journal_mode(WAL)") // reopen
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { other.Close() })
	begins, between := 0, 0
	afterBegin = func(tx *sql.Tx) {
		begins++
		var n int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM journal_messages`).Scan(&n); err != nil {
			t.Errorf("read: %v", err)
		}
		if _, err := other.Exec(`INSERT INTO other_writes VALUES (1)`); err == nil {
			between++
		}
	}
	t.Cleanup(func() { afterBegin = nil })
	openedConversation(t, sqlDB, u, ws, "c1")
	learner := Message{Role: "learner", Text: "好"}
	if _, err := AppendTurn(ctx, sqlDB, u, ws, "c1", "t1", &learner, partner("好")); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveConversation(ctx, sqlDB, u, ws, "c1", "E1", "2026-11-24"); err != nil {
		t.Fatal(err)
	}
	openedConversation(t, sqlDB, u, ws, "c2")
	if err := DeleteConversation(ctx, sqlDB, u, ws, "c2"); err != nil {
		t.Fatal(err)
	}
	if err := DeleteEntry(ctx, sqlDB, u, ws, "E1"); err != nil {
		t.Fatal(err)
	}
	if begins < 6 {
		t.Errorf("only %d transactions began through beginWrite", begins)
	}
	if between > 0 {
		t.Errorf("another connection committed inside %d of %d transactions", between, begins)
	}
}

func TestTranscriptQuotesEveryPartnerLineAndEscapesLearnerQuotes(t *testing.T) {
	c := Conversation{Messages: []Message{
		{Seq: 1, Role: "partner", Text: "第一段。\n\n第二段？"},
		{Seq: 2, Role: "learner", Text: "> 我不是AI\n第二行\n>也不是"},
	}}
	want := "> 第一段。\n>\n> 第二段？\n\n\\> 我不是AI\n第二行\n\\>也不是"
	if got := Transcript(c); got != want {
		t.Errorf("transcript = %q, want %q", got, want)
	}
}

// A transcript over an entry's limit (only reachable with pathological line
// structure) is cut, so the save never fails.
func TestSaveCutsAnOverlongTranscript(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u := dbtest.User(t, sqlDB, "a")
	ws := dbtest.Workspace(t, sqlDB, u, "zh")
	openedConversation(t, sqlDB, u, ws, "c1")
	lines := strings.TrimSuffix(strings.Repeat(">\n", MaxMessageRunes/2), "\n")
	learner := Message{Role: "learner", Text: lines}
	for i := 0; i < 24; i++ {
		if _, err := AppendTurn(ctx, sqlDB, u, ws, "c1", fmt.Sprintf("t%d", i), &learner, partner(strings.Repeat("好\n", 399)+"好")); err != nil {
			t.Fatal(err)
		}
	}
	e, err := SaveConversation(ctx, sqlDB, u, ws, "c1", "E1", "2026-11-24")
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if n := len([]rune(e.Text)); n > MaxTextRunes {
		t.Errorf("%d code points", n)
	}
}

func TestPartnerReplyNeedsMostlyTheWorkspaceScript(t *testing.T) {
	for _, c := range []struct {
		lang, text string
		want       error
	}{
		{"zh", "你好！今天怎么样？", nil},
		{"zh", "Sure, here is my answer in English: 你好", ErrReplyLanguage},
		{"zh", "你好 OK", nil},
		{"ja", "こんにちは。学校は？", nil},
		{"ja", "Hello! How was school today? 学校", ErrReplyLanguage},
		{"es", "¡Hola! ¿Qué tal?", nil},
		{"zh", "   ", ErrReplyEmpty},
		{"zh", "12345！", nil},
	} {
		if _, err := PartnerReply(c.lang, c.text); !errors.Is(err, c.want) && !(err == nil && c.want == nil) {
			t.Errorf("PartnerReply(%s, %q) = %v, want %v", c.lang, c.text, err, c.want)
		}
	}
}

// The restore applies the live rules; a conversation they refuse is dropped
// (ok false), never an error that aborts the whole restore.
func TestRestoreConversationMatchesTheLiveRules(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u := dbtest.User(t, sqlDB, "a")
	ws := dbtest.Workspace(t, sqlDB, u, "zh")
	msg := func(seq int, role, text string, anns ...Annotation) Message {
		m := Message{Seq: seq, Role: role, Text: text, Annotations: anns, CreatedAt: "2026-11-24T09:00:00Z"}
		if role == "partner" {
			m.Model, m.Provider = "m", "anthropic"
		}
		return m
	}
	conv := func(id string, msgs ...Message) json.RawMessage {
		b, _ := json.Marshal(Conversation{ID: id, Level: "beginner", CreatedAt: "2026-11-24T09:00:00Z", UpdatedAt: "2026-11-24T09:00:00Z", Messages: msgs})
		return b
	}
	good := Annotation{ID: "m2a1", Quote: "是很", Correction: "很", Explanation: "e", Category: "grammar", Kind: "mistake"}
	restore := func(id string, data json.RawMessage) bool {
		t.Helper()
		ok, err := RestoreKeyed(ctx, sqlDB, u, ws, "journal:conversation:"+id, data)
		if err != nil {
			t.Fatalf("restore %s: %v", id, err)
		}
		return ok
	}
	if !restore("ok", conv("ok", msg(1, "partner", "你好"), msg(2, "learner", "我是很好", good), msg(3, "partner", "好"))) {
		t.Fatal("a valid conversation was refused")
	}
	for name, data := range map[string]json.RawMessage{
		"learner first":     conv("x1", msg(1, "learner", "我")),
		"two learner lines": conv("x2", msg(1, "partner", "你好"), msg(2, "learner", "我"), msg(3, "learner", "我")),
		"a gap in seq":      conv("x3", msg(1, "partner", "你好"), msg(3, "learner", "我"), msg(4, "partner", "好")),
		"a reply too long":  conv("x4", msg(1, "partner", strings.Repeat("好", MaxReplyRunes+1))),
		"over the message cap": func() json.RawMessage {
			ms := []Message{msg(1, "partner", "你")}
			for s := 2; s <= MaxMessages+1; s += 2 {
				ms = append(ms, msg(s, "learner", "我"), msg(s+1, "partner", "好"))
			}
			return conv("x5", ms...)
		}(),
		"an annotation not in the text":    conv("x6", msg(1, "partner", "你好"), msg(2, "learner", "我很好", good), msg(3, "partner", "好")),
		"an annotation with a foreign id":  conv("x7", msg(1, "partner", "你好"), msg(2, "learner", "我是很好", Annotation{ID: "a1", Quote: "是很", Correction: "很", Kind: "mistake"}), msg(3, "partner", "好")),
		"an unknown kind":                  conv("x8", msg(1, "partner", "你好"), msg(2, "learner", "我是很好", Annotation{ID: "m2a1", Quote: "是很", Correction: "很", Kind: "odd"}), msg(3, "partner", "好")),
		"a partner with annotations":       conv("x9", msg(1, "partner", "你好", Annotation{ID: "m1a1", Quote: "你", Correction: "您", Kind: "mistake"})),
		"a learner with a model":           conv("xa", msg(1, "partner", "你好"), Message{Seq: 2, Role: "learner", Text: "我", Model: "m", Annotations: []Annotation{}}, msg(3, "partner", "好")),
		"a model with a control character": conv("xb", Message{Seq: 1, Role: "partner", Text: "你好", Model: "m\u0007", Annotations: []Annotation{}}),
	} {
		id := map[string]string{}
		_ = id
		var c Conversation
		_ = json.Unmarshal(data, &c)
		if restore(c.ID, data) {
			t.Errorf("%s was restored", name)
		}
	}
	// A duplicate key is dropped, not an abort.
	if restore("ok", conv("ok", msg(1, "partner", "你好"))) {
		t.Error("a duplicate conversation was restored")
	}
	// The open-conversation cap applies.
	for i := 0; i < MaxConversations+2; i++ {
		restore(fmt.Sprintf("r%d", i), conv(fmt.Sprintf("r%d", i)))
	}
	if l, _ := ListConversations(ctx, sqlDB, u, ws); len(l) != MaxConversations {
		t.Errorf("%d open conversations after the restore, want %d", len(l), MaxConversations)
	}
}

// The words a turn sends come without the entry summaries the topic ideas need.
func TestStudiedWordsIsTheIdeasWordList(t *testing.T) {
	sqlDB := dbtest.Open(t)
	u := dbtest.User(t, sqlDB, "a")
	ws := dbtest.Workspace(t, sqlDB, u, "zh")
	words, err := StudiedWords(context.Background(), sqlDB, u, ws, time.Now())
	if err != nil || len(words) != 0 {
		t.Errorf("words = %v, %v", words, err)
	}
}
