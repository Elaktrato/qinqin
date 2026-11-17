package mail

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"qinqin/internal/i18n"
	"qinqin/internal/mail/mailtest"
)

var allKinds = []Kind{KindReset, KindLoginCode, KindMFACode, KindVerifyEmail, KindTest, KindEmailChanged}

// The English mails are byte-identical to the text/template versions they
// replaced, except the reset mail's hour, which is now a real plural.
func TestEnglishMailsKeepTheirText(t *testing.T) {
	d := TemplateData{Site: "words.example.org", Link: "https://words.example.org/reset#t=abc", Code: "123456", Minutes: 10, Hours: 1}
	want := map[Kind][2]string{
		KindReset:        {"Reset your qinqin password", "Someone asked to reset the password of your words.example.org account.\n\nOpen this link within 1 hour to choose a new password:\n\nhttps://words.example.org/reset#t=abc\n\nIf this was not you, ignore this message: nothing changes until the link is used.\n"},
		KindLoginCode:    {"Your qinqin sign-in code", "Your sign-in code for words.example.org is:\n\n123456\n\nIt is valid for 10 minutes and works once.\n\nIf this was not you, ignore this message and do not share the code with anyone.\n"},
		KindMFACode:      {"Your qinqin two-step code", "Your two-step check code for words.example.org is:\n\n123456\n\nIt is valid for 10 minutes and works once.\n\nIf this was not you, someone knows your password: change it and ignore this code.\n"},
		KindVerifyEmail:  {"Confirm your email address for qinqin", "Confirm this email address for your words.example.org account with this code:\n\n123456\n\nIt is valid for 10 minutes.\n\nIf this was not you, ignore this message: the address stays unconfirmed.\n"},
		KindTest:         {"qinqin test message", "This is a test message from words.example.org. Email delivery works.\n\nIf this was not you, ignore this message: it was sent by an administrator of the site.\n"},
		KindEmailChanged: {"Your qinqin email address was changed", "The email address of your words.example.org account was changed.\n\nFrom now on, password reset links and sign-in codes go to the new address. Reset links that were still open were cancelled.\n\nIf this was not you, someone with access to your session changed it: sign in, review Settings, Account, and ask your administrator for help if you cannot.\n"},
	}
	for _, k := range allKinds {
		m, err := Render(k, "en", d)
		if err != nil {
			t.Fatalf("%s: %v", k, err)
		}
		if m.Subject != want[k][0] || m.Body != want[k][1] {
			t.Errorf("%s:\nsubject %q\nbody %q\nwant %q\n%q", k, m.Subject, m.Body, want[k][0], want[k][1])
		}
	}
	d.Hours = 2
	m, _ := Render(KindReset, "en", d)
	if !strings.Contains(m.Body, "within 2 hours to choose") {
		t.Errorf("reset plural: %q", m.Body)
	}
}

// The catalogue: one file per language under messages/, every key
// mail.<kind>.subject|body, every kind present in en, every message in the
// shared syntax, only the documented arguments, never a code or a link in a
// subject (lock screens show it); other languages a subset of en with the
// same arguments.
func TestMailCatalogue(t *testing.T) {
	files, err := filepath.Glob("messages/*.json")
	if err != nil || len(files) == 0 {
		t.Fatalf("no catalogue files (%v)", err)
	}
	allowed := map[string]bool{"site": true, "link": true, "code": true, "minutes": true, "hours": true}
	var en map[string]string
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var cat map[string]string
		if err := json.Unmarshal(raw, &cat); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		lang := strings.TrimSuffix(filepath.Base(f), ".json")
		if !i18n.IsLanguageSetting(lang) || lang == "" {
			t.Errorf("%s: not a language tag", f)
		}
		keys := make([]string, 0, len(cat))
		for k := range cat {
			keys = append(keys, k)
		}
		if !sort.StringsAreSorted(keysInFileOrder(t, raw)) {
			t.Errorf("%s: keys not sorted", f)
		}
		for _, k := range keys {
			parts := strings.Split(k, ".")
			if len(parts) != 3 || parts[0] != "mail" || (parts[2] != "subject" && parts[2] != "body") || kindOfKey(parts[1]) == "" {
				t.Errorf("%s: key %q is not mail.<kind>.subject|body", f, k)
				continue
			}
			p, err := i18n.Parse(cat[k])
			if err != nil {
				t.Errorf("%s %s: %v", f, k, err)
				continue
			}
			for a := range p.Args() {
				if !allowed[a] {
					t.Errorf("%s %s: argument %q", f, k, a)
				}
				if parts[2] == "subject" && (a == "code" || a == "link") {
					t.Errorf("%s %s: %s in a subject", f, k, a)
				}
			}
		}
		if lang == "en" {
			en = cat
		}
	}
	if en == nil {
		t.Fatal("no en catalogue")
	}
	for _, k := range allKinds {
		for _, part := range []string{"subject", "body"} {
			if _, ok := en[catalogueKey(k, part)]; !ok {
				t.Errorf("en lacks %s", catalogueKey(k, part))
			}
		}
	}
	for lang, cat := range catalogues {
		for k, v := range cat {
			ev, ok := en[k]
			if !ok {
				t.Errorf("%s: %s is not in en", lang, k)
				continue
			}
			pv, _ := i18n.Parse(v)
			pe, _ := i18n.Parse(ev)
			if pv != nil && pe != nil && !reflect.DeepEqual(pv.Args(), pe.Args()) {
				t.Errorf("%s %s: arguments %v, en has %v", lang, k, pv.Args(), pe.Args())
			}
		}
	}
	if got := Languages(); !reflect.DeepEqual(got, langsOf(files)) {
		t.Errorf("Languages() = %v, files %v", got, files)
	}
}

func keysInFileOrder(t *testing.T, raw []byte) []string {
	t.Helper()
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.Token()
	var out []string
	for dec.More() {
		k, _ := dec.Token()
		out = append(out, k.(string))
		var v string
		dec.Decode(&v)
	}
	return out
}

func kindOfKey(seg string) Kind {
	for _, k := range allKinds {
		if catalogueKey(k, "x") == "mail."+seg+".x" {
			return k
		}
	}
	return ""
}

func langsOf(files []string) []string {
	var out []string
	for _, f := range files {
		out = append(out, strings.TrimSuffix(filepath.Base(f), ".json"))
	}
	sort.Strings(out)
	return out
}

// withCatalogue installs a test-only language for the duration of the test.
func withCatalogue(t *testing.T, lang string, cat map[string]string) {
	t.Helper()
	catalogues[lang] = cat
	t.Cleanup(func() { delete(catalogues, lang) })
}

func TestLanguageChoice(t *testing.T) {
	withCatalogue(t, "de", map[string]string{"mail.test.subject": "qinqin Testnachricht"})
	for _, c := range []struct{ setting, header, want string }{
		{"", "", "en"},
		{"", "de-AT,en;q=0.5", "de"},
		{"en", "de", "en"},
		{"de", "", "de"},
		{"fr", "de", "en"}, // a stored language without a catalogue: en, not the header
		{"", "fr, ja;q=0.5", "en"},
	} {
		if got := Language(c.setting, c.header); got != c.want {
			t.Errorf("Language(%q, %q) = %q, want %q", c.setting, c.header, got, c.want)
		}
	}
	d := TemplateData{Site: "s.example"}
	m, err := Render(KindTest, "de", d)
	if err != nil || m.Subject != "qinqin Testnachricht" {
		t.Errorf("de subject %q (%v)", m.Subject, err)
	}
	if !strings.HasPrefix(m.Body, "This is a test message") {
		t.Errorf("a key missing in de falls back to en: %q", m.Body)
	}
	if m, err := Render(KindTest, "xx", d); err != nil || m.Subject != "qinqin test message" {
		t.Errorf("unknown language: %q %v", m.Subject, err)
	}
	if _, err := Render("nope", "en", d); err == nil {
		t.Error("unknown kind rendered")
	}
}

// The worker picks the language when it sends: the recipient's stored
// setting, else the Accept-Language the triggering request carried, else en.
func TestQueuedMailUsesTheStoredSettingThenTheHeader(t *testing.T) {
	withCatalogue(t, "de", map[string]string{"mail.loginCode.subject": "Dein qinqin Anmeldecode"})
	fake, err := mailtest.New(mailtest.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer fake.Close()
	sink := &logSink{}
	s := svcFor(t, fake, sink)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx)
	db := s.Store.DB
	if _, err := db.Exec(`INSERT INTO users (id, username, hash, updated_at, interface_language) VALUES (1, 'a', 'h', 't', 'de'), (2, 'b', 'h', 't', 'en'), (3, 'c', 'h', 't', '')`); err != nil {
		t.Fatal(err)
	}
	send := func(uid int64, header string) string {
		t.Helper()
		n := len(fake.Messages())
		s.Enqueue(Job{Kind: KindLoginCode, UserID: uid, To: "bob@example.com", AcceptLanguage: header, Data: TemplateData{Code: "123456"}})
		wait(t, func() bool { return len(fake.Messages()) == n+1 })
		return fake.Messages()[n].Data
	}
	for _, c := range []struct {
		uid    int64
		header string
		german bool
	}{
		{1, "", true},      // stored de
		{2, "de", false},   // stored en wins over the header
		{3, "de-CH", true}, // browser default: the header
		{3, "fr", false},   // nothing matches: en
		{99, "de", true},   // no such user: the header
		{99, "", false},
	} {
		data := send(c.uid, c.header)
		if got := strings.Contains(data, "Anmeldecode"); got != c.german {
			t.Errorf("user %d header %q: german %v, want %v", c.uid, c.header, got, c.german)
		}
	}
}
