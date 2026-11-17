package mail

import (
	"bytes"
	"errors"
	"io"
	"net/mail"
	"strings"
	"testing"
	"time"
)

var (
	fixedNow = time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	fixedRnd = func() io.Reader { return bytes.NewReader(bytes.Repeat([]byte{0xab}, 16)) }
)

func TestComposeGolden(t *testing.T) {
	raw, err := Compose(Sender{Address: "qinqin@example.org", Name: "qinqin"},
		Message{To: "bob@example.com", Subject: "Hello", Body: "line one\nline two\n"}, fixedNow, fixedRnd())
	if err != nil {
		t.Fatal(err)
	}
	want := "From: \"qinqin\" <qinqin@example.org>\r\n" +
		"To: bob@example.com\r\n" +
		"Subject: Hello\r\n" +
		"Date: Sun, 15 Nov 2026 10:00:00 +0000\r\n" +
		"Message-ID: <abababababababababababababababab@example.org>\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n" +
		"Content-Transfer-Encoding: quoted-printable\r\n" +
		"Auto-Submitted: auto-generated\r\n" +
		"\r\n" +
		"line one\r\nline two\r\n"
	if string(raw) != want {
		t.Fatalf("got:\n%q\nwant:\n%q", raw, want)
	}
}

func TestComposeRefusesLineBreaksInEveryField(t *testing.T) {
	for _, bad := range []string{"a\r\nBcc: x@y.z", "a\nBcc: x@y.z", "a\rBcc: x@y.z", "a\x00b"} {
		cases := map[string]struct {
			s Sender
			m Message
		}{
			"from name": {Sender{Address: "q@example.org", Name: bad}, Message{To: "b@example.com", Subject: "s"}},
			"from":      {Sender{Address: "q@example.org" + bad}, Message{To: "b@example.com", Subject: "s"}},
			"to":        {Sender{Address: "q@example.org"}, Message{To: "b@example.com" + bad, Subject: "s"}},
			"subject":   {Sender{Address: "q@example.org"}, Message{To: "b@example.com", Subject: "s" + bad}},
		}
		for name, c := range cases {
			raw, err := Compose(c.s, c.m, fixedNow, fixedRnd())
			if err == nil {
				t.Errorf("%s with %q: no error, got %q", name, bad, raw)
			}
			if raw != nil && bytes.Contains(raw, []byte("Bcc:")) {
				t.Errorf("%s: a Bcc header appeared", name)
			}
		}
	}
}

func TestComposeEncodesNonASCIIName(t *testing.T) {
	raw, err := Compose(Sender{Address: "q@example.org", Name: "Lernkärtchen 学"}, Message{To: "b@example.com", Subject: "Grüße"}, fixedNow, fixedRnd())
	if err != nil {
		t.Fatal(err)
	}
	head := string(raw[:bytes.Index(raw, []byte("\r\n\r\n"))])
	if strings.ContainsAny(head, "äü学ß") {
		t.Errorf("non-ASCII in the header block: %q", head)
	}
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if got := msg.Header.Get("From"); !strings.Contains(got, "=?utf-8?") {
		t.Errorf("From not Q-encoded: %q", got)
	}
}

func TestComposeBodyQuotedPrintable(t *testing.T) {
	long := strings.Repeat("x", 200) + " a=b ü"
	raw, err := Compose(Sender{Address: "q@example.org"}, Message{To: "b@example.com", Subject: "s", Body: long + "\r\nsecond\rthird\n"}, fixedNow, fixedRnd())
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw[bytes.Index(raw, []byte("\r\n\r\n"))+4:])
	for _, l := range strings.Split(body, "\r\n") {
		if len(l) > 76 {
			t.Errorf("line of %d bytes", len(l))
		}
	}
	if !strings.Contains(body, "a=3Db") || !strings.Contains(body, "=C3=BC") {
		t.Errorf("= and ü not encoded: %q", body)
	}
	if strings.Contains(strings.ReplaceAll(body, "\r\n", ""), "\n") || strings.Contains(strings.ReplaceAll(body, "\r\n", ""), "\r") {
		t.Errorf("bare CR or LF in the body: %q", body)
	}
}

func TestTemplatesNameTheSiteAndTheNotYouSentence(t *testing.T) {
	d := TemplateData{Site: "words.example.org", Link: "https://words.example.org/reset#t=abc", Code: "123456", Minutes: 10, Hours: 1}
	for _, k := range []Kind{KindReset, KindLoginCode, KindMFACode, KindVerifyEmail, KindTest} {
		m, err := Render(k, "en", d)
		if err != nil {
			t.Fatalf("%s: %v", k, err)
		}
		if !strings.Contains(m.Body, "words.example.org") {
			t.Errorf("%s does not name the site", k)
		}
		if !strings.Contains(m.Body, "If this was not you") {
			t.Errorf("%s lacks the not-you sentence", k)
		}
		if strings.Contains(m.Subject, "123456") || strings.Contains(m.Subject, "reset#t") {
			t.Errorf("%s: code or link in the subject: %q", k, m.Subject)
		}
	}
	m, _ := Render(KindReset, "en", d)
	if !strings.Contains(m.Body, d.Link) {
		t.Error("reset mail lacks the link")
	}
	m, _ = Render(KindLoginCode, "en", d)
	if !strings.Contains(m.Body, "123456") {
		t.Error("login code mail lacks the code")
	}
	if _, err := Render("nope", "en", d); err == nil {
		t.Error("unknown kind rendered")
	}
}

func TestValidAddress(t *testing.T) {
	ok := []string{"a@example.org", "first.last+tag@mail.example.co", "x@xn--bcher-kva.de"}
	for _, s := range ok {
		if got, err := ValidAddress(s); err != nil || got != s {
			t.Errorf("%q: %q %v", s, got, err)
		}
	}
	bad := []string{
		"", "Bob <a@example.org>", "\"Bob\" a@example.org", "a@example.org, b@example.org", "a@example.org;b@example.org",
		"a@bücher.de", "bö@example.org", "a@example", "a b@example.org", "a@example.org\r\n", "a\x01@example.org",
		"a@@example.org", "@example.org", "a@.example.org", "a@example..org", "a@example.org (comment)",
		"<a@example.org>", strings.Repeat("a", 250) + "@e.org",
	}
	for _, s := range bad {
		if _, err := ValidAddress(s); !errors.Is(err, ErrAddress) {
			t.Errorf("%q accepted (%v)", s, err)
		}
	}
	// exactly 254 bytes is the limit
	at254 := strings.Repeat("a", 254-len("@e.org")) + "@e.org"
	if _, err := ValidAddress(at254); err != nil {
		t.Errorf("254 bytes refused: %v", err)
	}
	if _, err := ValidAddress("a" + at254); err == nil {
		t.Error("255 bytes accepted")
	}
}
