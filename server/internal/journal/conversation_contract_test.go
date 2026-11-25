package journal

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/ai"
)

// fxString is a fixture string: a plain string or {"repeat": s, "times": n}.
type fxString string

func (s *fxString) UnmarshalJSON(b []byte) error {
	var plain string
	if json.Unmarshal(b, &plain) == nil {
		*s = fxString(plain)
		return nil
	}
	var rep struct {
		Repeat string `json:"repeat"`
		Times  int    `json:"times"`
	}
	if err := json.Unmarshal(b, &rep); err != nil {
		return err
	}
	*s = fxString(strings.Repeat(rep.Repeat, rep.Times))
	return nil
}

// docs/contracts/journal/conversations.json: the levels, the limits, what a
// start and a turn accept, and the transcript of a saved conversation.
func TestConversationsContract(t *testing.T) {
	raw0, err := os.ReadFile("../../../docs/contracts/journal/conversations.json")
	if err != nil {
		t.Fatal(err)
	}
	raw := raw0
	var fx struct {
		Levels []string `json:"levels"`
		Limits struct {
			Topic, Message, Reply, Messages, Conversations, Context, Words int
		} `json:"-"`
		RawLimits map[string]int `json:"limits"`
		Start     struct {
			Accept []struct {
				Topic fxString `json:"topic"`
				Level string   `json:"level"`
			} `json:"accept"`
			Refuse []struct {
				Topic fxString `json:"topic"`
				Level string   `json:"level"`
				Why   string   `json:"why"`
			} `json:"refuse"`
		} `json:"start"`
		Turn []struct {
			Text        fxString `json:"text"`
			HasMessages bool     `json:"hasMessages"`
			Code        string   `json:"code"`
			Why         string   `json:"why"`
		} `json:"turn"`
		Conversation    Conversation    `json:"conversation"`
		RawConversation json.RawMessage `json:"-"`
		Transcripts     []struct {
			Why          string       `json:"why"`
			Conversation Conversation `json:"conversation"`
			Text         string       `json:"text"`
		} `json:"transcripts"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(fx.Levels, ai.Levels) {
		t.Errorf("levels = %v, server %v", fx.Levels, ai.Levels)
	}
	want := map[string]int{"topicRunes": MaxTopicRunes, "messageRunes": MaxMessageRunes, "replyRunes": MaxReplyRunes,
		"messages": MaxMessages, "conversations": MaxConversations, "contextMessages": ai.MaxConverseHistory, "wordSample": ai.MaxConverseWords}
	for k, v := range want {
		if fx.RawLimits[k] != v {
			t.Errorf("limit %s = %d, server %d", k, fx.RawLimits[k], v)
		}
	}
	if len(fx.RawLimits) != len(want) {
		t.Errorf("limits = %v", fx.RawLimits)
	}
	for _, c := range fx.Start.Accept {
		if err := ValidateStart(string(c.Topic), c.Level); err != nil {
			t.Errorf("start %q/%q refused: %v", c.Topic, c.Level, err)
		}
	}
	for _, c := range fx.Start.Refuse {
		var inv *InvalidError
		if err := ValidateStart(string(c.Topic), c.Level); !errors.As(err, &inv) {
			t.Errorf("start (%s) = %v, want a refusal", c.Why, err)
		}
	}
	for _, c := range fx.Turn {
		if got := TurnTextCode(CheckTurnText(string(c.Text), c.HasMessages)); got != c.Code {
			t.Errorf("turn %q (hasMessages %v, %s) = %q, want %q", cut(string(c.Text)), c.HasMessages, c.Why, got, c.Code)
		}
	}
	if len(fx.Transcripts) < 2 {
		t.Fatalf("%d transcript cases", len(fx.Transcripts))
	}
	for _, c := range fx.Transcripts {
		if got := Transcript(c.Conversation); got != c.Text {
			t.Errorf("transcript (%s) = %q, want %q", c.Why, got, c.Text)
		}
	}
	// The server answers the conversation exactly as the fixture writes it.
	var doc struct {
		Conversation json.RawMessage `json:"conversation"`
	}
	if err := json.Unmarshal(raw0, &doc); err != nil {
		t.Fatal(err)
	}
	got, err := json.Marshal(fx.Conversation)
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	_ = json.Unmarshal(got, &a)
	_ = json.Unmarshal(doc.Conversation, &b)
	if a == nil || b == nil || !reflect.DeepEqual(a, b) {
		t.Errorf("marshalled conversation\n%s\ndiffers from the fixture\n%s", got, doc.Conversation)
	}
}

func cut(s string) string { return cutRunes(s, 12) }
