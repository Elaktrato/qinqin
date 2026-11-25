package mail

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"qinqin/internal/mail/mailtest"
)

func TestComposeListUnsubscribeHeaders(t *testing.T) {
	m := Message{To: "a@example.org", Subject: "s", Body: "b", ListUnsubscribe: "https://words.example.org/api/reminders/unsubscribe?t=v1.1.abc"}
	raw, err := Compose(Sender{Address: "q@example.org"}, m, t0(), strings.NewReader(strings.Repeat("x", 16)))
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	if !strings.Contains(s, "List-Unsubscribe: <https://words.example.org/api/reminders/unsubscribe?t=v1.1.abc>\r\n") ||
		!strings.Contains(s, "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n") {
		t.Fatalf("headers missing:\n%s", s)
	}
	for _, bad := range []string{"http://x.example/u", "https://x.example/u>\r\nBcc: z@example.org", "not a url", "https://x.example/ u"} {
		m.ListUnsubscribe = bad
		if _, err := Compose(Sender{Address: "q@example.org"}, m, t0(), strings.NewReader(strings.Repeat("x", 16))); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	m.ListUnsubscribe = ""
	raw, _ = Compose(Sender{Address: "q@example.org"}, m, t0(), strings.NewReader(strings.Repeat("x", 16)))
	if strings.Contains(string(raw), "List-Unsubscribe") {
		t.Fatal("a mail without the link must not carry the header")
	}
}

func TestRenderReminderCountsOnly(t *testing.T) {
	d := ReminderData{Site: "words.example.org", Link: "https://words.example.org/study", Unsubscribe: "https://words.example.org/api/reminders/unsubscribe?t=T",
		Items: []ReminderItem{{Kind: "due", Count: 12}, {Kind: "goal"}, {Kind: "streak", Count: 1}}}
	m, err := RenderReminder("en", d)
	if err != nil {
		t.Fatal(err)
	}
	if m.Subject != "Your qinqin study reminder" {
		t.Errorf("subject %q", m.Subject)
	}
	for _, want := range []string{"12 cards are due for review.", "Your daily goal is not met yet today.", "Your streak is at risk: 1 day.", d.Link, d.Unsubscribe, "Settings, Notifications"} {
		if !strings.Contains(m.Body, want) {
			t.Errorf("body lacks %q:\n%s", want, m.Body)
		}
	}
	d.Items = []ReminderItem{{Kind: "due", Count: 1}}
	m, _ = RenderReminder("en", d)
	if !strings.Contains(m.Body, "1 card is due for review.") || strings.Contains(m.Body, "goal") {
		t.Errorf("one item:\n%s", m.Body)
	}
	if _, err := RenderReminder("en", ReminderData{}); err == nil {
		t.Error("a reminder with nothing to say must not render")
	}
	if _, err := RenderReminder("xx", d); err != nil {
		t.Errorf("an unknown language falls back to en: %v", err)
	}
}

func TestSendReminderDeliversWithHeaders(t *testing.T) {
	fake, _ := mailtest.New(mailtest.Options{})
	defer fake.Close()
	sink := &logSink{}
	svc := svcFor(t, fake, sink)
	err := svc.SendReminder(context.Background(), 0, "ann@example.org", ReminderData{Items: []ReminderItem{{Kind: "due", Count: 3}}, Unsubscribe: "https://words.example.org/api/reminders/unsubscribe?t=T"})
	if err != nil {
		t.Fatal(err)
	}
	got := fake.Messages()
	if len(got) != 1 || got[0].To[0] != "ann@example.org" || !strings.Contains(got[0].Data, "List-Unsubscribe-Post: List-Unsubscribe=One-Click") {
		t.Fatalf("%+v", got)
	}
	if strings.Contains(sink.all(), "ann@example.org") {
		t.Fatalf("the address was logged: %s", sink.all())
	}
	svc.GlobalPerHour = 1
	if err := svc.SendReminder(context.Background(), 0, "ann@example.org", ReminderData{Items: []ReminderItem{{Kind: "due", Count: 3}}}); !errors.Is(err, ErrCapped) {
		t.Fatalf("second send over the cap: %v", err)
	}
	var none *Service
	if err := none.SendReminder(context.Background(), 0, "a@example.org", ReminderData{}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("nil service: %v", err)
	}
}

func t0() time.Time { return time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC) }
