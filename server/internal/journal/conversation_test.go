package journal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/dbtest"
)

func partner(text string) Message {
	return Message{Role: "partner", Text: text, Model: "m", Provider: "p"}
}

func TestConversationStoreAndIsolation(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := dbtest.User(t, sqlDB, "alice"), dbtest.User(t, sqlDB, "bob")
	ws, ws2 := dbtest.Workspace(t, sqlDB, alice, "zh"), dbtest.Workspace(t, sqlDB, alice, "ja")
	bobWS := dbtest.Workspace(t, sqlDB, bob, "zh")

	c, err := CreateConversation(ctx, sqlDB, alice, ws, "c1", "周末", "elementary")
	if err != nil {
		t.Fatal(err)
	}
	if c.ID != "c1" || c.Topic != "周末" || c.Level != "elementary" || c.CreatedAt == "" || len(c.Messages) != 0 || c.Messages == nil {
		t.Fatalf("created %+v", c)
	}
	if _, err := CreateConversation(ctx, sqlDB, alice, ws, "c1", "", "beginner"); err == nil {
		t.Error("a second conversation with the same id")
	}
	if _, err := CreateConversation(ctx, sqlDB, alice, ws, "c2", "", "expert"); err == nil {
		t.Error("an unknown level was stored")
	}

	// The partner opens; then a learner turn appends two messages.
	got, err := AppendTurn(ctx, sqlDB, alice, ws, "c1", nil, partner("你好！"))
	if err != nil || len(got.Messages) != 1 || got.Messages[0].Seq != 1 || got.Messages[0].Role != "partner" || got.Messages[0].Annotations == nil {
		t.Fatalf("opening = %+v, %v", got, err)
	}
	learner := Message{Role: "learner", Text: "我是很好。", Annotations: []Annotation{{ID: "m2a1", Quote: "是很", Correction: "很", Kind: "mistake"}}}
	got, err = AppendTurn(ctx, sqlDB, alice, ws, "c1", &learner, partner("太好了。"))
	if err != nil || len(got.Messages) != 3 || got.Messages[1].Seq != 2 || got.Messages[1].Annotations[0].Quote != "是很" || got.Messages[2].Text != "太好了。" {
		t.Fatalf("turn = %+v, %v", got, err)
	}
	if got.UpdatedAt < c.UpdatedAt {
		t.Error("updatedAt went back")
	}

	list, err := ListConversations(ctx, sqlDB, alice, ws)
	if err != nil || len(list) != 1 || list[0].MessageCount != 3 || list[0].ID != "c1" {
		t.Fatalf("list = %+v, %v", list, err)
	}
	// Another workspace and another user see nothing of it.
	for _, scope := range [][2]int64{{alice, ws2}, {bob, bobWS}, {bob, ws}} {
		if l, _ := ListConversations(ctx, sqlDB, scope[0], scope[1]); len(l) != 0 {
			t.Errorf("%v lists %+v", scope, l)
		}
		if _, err := GetConversation(ctx, sqlDB, scope[0], scope[1], "c1"); !errors.Is(err, ErrNotFound) {
			t.Errorf("%v reads it: %v", scope, err)
		}
		if _, err := AppendTurn(ctx, sqlDB, scope[0], scope[1], "c1", nil, partner("x")); !errors.Is(err, ErrNotFound) {
			t.Errorf("%v appends: %v", scope, err)
		}
		if err := DeleteConversation(ctx, sqlDB, scope[0], scope[1], "c1"); !errors.Is(err, ErrNotFound) {
			t.Errorf("%v deletes: %v", scope, err)
		}
	}
	if err := DeleteConversation(ctx, sqlDB, alice, ws, "c1"); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := sqlDB.QueryRow(`SELECT (SELECT COUNT(*) FROM journal_conversations) + (SELECT COUNT(*) FROM journal_messages)`).Scan(&left); err != nil || left != 0 {
		t.Errorf("after delete %d rows, %v", left, err)
	}
	if _, err := AppendTurn(ctx, sqlDB, alice, ws, "c1", nil, partner("late")); !errors.Is(err, ErrNotFound) {
		t.Errorf("a late reply for a discarded conversation: %v", err)
	}
}

func TestConversationCaps(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice := dbtest.User(t, sqlDB, "alice")
	ws := dbtest.Workspace(t, sqlDB, alice, "zh")
	for i := 0; i < MaxConversations; i++ {
		if _, err := CreateConversation(ctx, sqlDB, alice, ws, fmt.Sprintf("c%d", i), "", "beginner"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := CreateConversation(ctx, sqlDB, alice, ws, "over", "", "beginner"); !errors.Is(err, ErrConversationLimit) {
		t.Fatalf("conversation %d: %v", MaxConversations+1, err)
	}
	if _, err := AppendTurn(ctx, sqlDB, alice, ws, "c0", nil, partner("开")); err != nil {
		t.Fatal(err)
	}
	learner := Message{Role: "learner", Text: "好"}
	for n := 1; n+2 <= MaxMessages; n += 2 {
		if _, err := AppendTurn(ctx, sqlDB, alice, ws, "c0", &learner, partner("好")); err != nil {
			t.Fatalf("at %d messages: %v", n, err)
		}
	}
	c, _ := GetConversation(ctx, sqlDB, alice, ws, "c0")
	if len(c.Messages) != MaxMessages-1 {
		t.Fatalf("messages = %d", len(c.Messages))
	}
	if !ConversationFull(c) {
		t.Error("a conversation without room for one more turn is full")
	}
	if _, err := AppendTurn(ctx, sqlDB, alice, ws, "c0", &learner, partner("好")); !errors.Is(err, ErrConversationFull) {
		t.Errorf("over the cap: %v", err)
	}
}

func TestPartnerReplyAndTurnAnnotations(t *testing.T) {
	if r, ok := PartnerReply("zh", "  你好！\u0007 "); !ok || r != "你好！" {
		t.Errorf("reply = %q %v", r, ok)
	}
	if _, ok := PartnerReply("zh", "Hello there."); ok {
		t.Error("an English reply in a Chinese workspace")
	}
	if _, ok := PartnerReply("zh", "   "); ok {
		t.Error("an empty reply")
	}
	if r, ok := PartnerReply("zh", strings.Repeat("好", 900)); !ok || len([]rune(r)) != MaxReplyRunes {
		t.Errorf("a long reply is cut: %d", len([]rune(r)))
	}
	anns := TurnAnnotations("我是很好。", "zh", 4, []ai.RawAnnotation{
		{Quote: "是很", Correction: "很", Kind: "mistake"}, {Quote: "不在", Correction: "在"}, {Quote: "好", Correction: "abc"},
	})
	if len(anns) != 1 || anns[0].ID != "m4a1" || anns[0].Prefix != "我" {
		t.Errorf("annotations = %+v", anns)
	}
}

func TestSaveConversationAsEntry(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := dbtest.User(t, sqlDB, "alice"), dbtest.User(t, sqlDB, "bob")
	ws := dbtest.Workspace(t, sqlDB, alice, "zh")
	if _, err := CreateConversation(ctx, sqlDB, alice, ws, "c1", "周末", "beginner"); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveConversation(ctx, sqlDB, alice, ws, "c1", "E1", "2026-11-24"); !errors.Is(err, ErrNothingToSave) {
		t.Errorf("an empty conversation saved: %v", err)
	}
	learner := Message{Role: "learner", Text: "我很好。"}
	if _, err := AppendTurn(ctx, sqlDB, alice, ws, "c1", nil, partner("你好！")); err != nil {
		t.Fatal(err)
	}
	if _, err := AppendTurn(ctx, sqlDB, alice, ws, "c1", &learner, partner("太好了。")); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveConversation(ctx, sqlDB, bob, ws, "c1", "E1", "2026-11-24"); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user saves it: %v", err)
	}
	if _, err := SaveConversation(ctx, sqlDB, alice, ws, "c1", "bad id!", "2026-11-24"); err == nil {
		t.Error("a bad entry id")
	}
	e, err := SaveConversation(ctx, sqlDB, alice, ws, "c1", "E1", "2026-11-24")
	if err != nil {
		t.Fatal(err)
	}
	if e.ID != "E1" || e.Title != "周末" || e.Source != "typed" || e.Text != "> 你好！\n\n我很好。\n\n> 太好了。" || e.Date != "2026-11-24" {
		t.Errorf("entry = %+v", e)
	}
	if _, err := GetConversation(ctx, sqlDB, alice, ws, "c1"); !errors.Is(err, ErrNotFound) {
		t.Error("the conversation is still there after its save")
	}
	if got, _ := GetEntry(ctx, sqlDB, alice, ws, "E1"); got.Text != e.Text {
		t.Error("the entry was not stored")
	}
}

// The longest conversation the caps allow still fits in an entry.
func TestLongestTranscriptFitsAnEntry(t *testing.T) {
	c := Conversation{}
	for i := 1; i <= MaxMessages; i++ {
		role, n := "learner", MaxMessageRunes
		if i%2 == 1 {
			role, n = "partner", MaxReplyRunes
		}
		c.Messages = append(c.Messages, Message{Seq: i, Role: role, Text: strings.Repeat("字", n)})
	}
	if got := len([]rune(Transcript(c))); got > MaxTextRunes {
		t.Errorf("transcript of %d code points over the entry's %d", got, MaxTextRunes)
	}
}

func TestConversationKeyedRoundTrip(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice := dbtest.User(t, sqlDB, "alice")
	ws := dbtest.Workspace(t, sqlDB, alice, "zh")
	if _, err := CreateConversation(ctx, sqlDB, alice, ws, "c1", "周末", "advanced"); err != nil {
		t.Fatal(err)
	}
	learner := Message{Role: "learner", Text: "我是很好。", Annotations: []Annotation{{ID: "m2a1", Quote: "是很", Correction: "很", Kind: "mistake"}}}
	if _, err := AppendTurn(ctx, sqlDB, alice, ws, "c1", nil, partner("你好！")); err != nil {
		t.Fatal(err)
	}
	if _, err := AppendTurn(ctx, sqlDB, alice, ws, "c1", &learner, partner("好。")); err != nil {
		t.Fatal(err)
	}
	before, _ := GetConversation(ctx, sqlDB, alice, ws, "c1")
	var docs []KeyedDoc
	if err := EachKeyed(ctx, sqlDB, alice, func(d KeyedDoc) error { docs = append(docs, d); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(docs) != 1 || docs[0].Key != "journal:conversation:c1" {
		t.Fatalf("keyed = %+v", docs)
	}
	other := dbtest.Open(t)
	bob := dbtest.User(t, other, "bob")
	ws2 := dbtest.Workspace(t, other, bob, "zh")
	if ok, err := RestoreKeyed(ctx, other, bob, ws2, docs[0].Key, docs[0].Data); !ok || err != nil {
		t.Fatalf("restore = %v, %v", ok, err)
	}
	after, err := GetConversation(ctx, other, bob, ws2, "c1")
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(before)
	b, _ := json.Marshal(after)
	if string(a) != string(b) {
		t.Errorf("round trip:\n%s\n%s", a, b)
	}
	// What the restore refuses is dropped, not an error.
	for _, bad := range []string{`{"id":"c2","level":"expert","messages":[]}`, `{"id":"other","level":"beginner","messages":[]}`,
		`{"id":"c2","level":"beginner","messages":[{"seq":1,"role":"narrator","text":"x","annotations":[]}]}`, `not json`} {
		if ok, err := RestoreKeyed(ctx, other, bob, ws2, "journal:conversation:c2", json.RawMessage(bad)); ok || err != nil {
			t.Errorf("restore of %s = %v, %v", bad, ok, err)
		}
	}
}
