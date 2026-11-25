package mail

import (
	"embed"
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strings"

	"qinqin/internal/i18n"
)

// Kind names a mail.
type Kind string

const (
	KindReset        Kind = "reset"
	KindLoginCode    Kind = "login_code"
	KindMFACode      Kind = "mfa_code"
	KindVerifyEmail  Kind = "verify_email"
	KindTest         Kind = "test"
	KindEmailChanged Kind = "email_changed"
	KindReminder     Kind = "reminder"
)

// The mail catalogue (docs/contracts/i18n/): one flat JSON file per
// language under messages/, keys mail.<kind>.subject and mail.<kind>.body
// (the kind in lower camelCase), values in the shared message syntax. A
// subject never names the code or the link (lock screens and notification
// previews show it; the catalogue test pins that). A key missing in a
// language falls back to en.
//
//go:embed messages/*.json
var messageFS embed.FS

// catalogues maps a language to its messages; tests may add one.
var catalogues = loadCatalogues()

func loadCatalogues() map[string]map[string]string {
	entries, err := messageFS.ReadDir("messages")
	if err != nil {
		panic(err)
	}
	out := map[string]map[string]string{}
	for _, e := range entries {
		raw, err := messageFS.ReadFile(path.Join("messages", e.Name()))
		if err != nil {
			panic(err)
		}
		var cat map[string]string
		if err := json.Unmarshal(raw, &cat); err != nil {
			panic(fmt.Sprintf("mail: catalogue %s: %v", e.Name(), err))
		}
		out[strings.TrimSuffix(e.Name(), ".json")] = cat
	}
	if out["en"] == nil {
		panic("mail: no en catalogue")
	}
	return out
}

// Languages lists the languages with a mail catalogue, sorted.
func Languages() []string {
	out := make([]string, 0, len(catalogues))
	for l := range catalogues {
		out = append(out, l)
	}
	sort.Strings(out)
	return out
}

// Language picks a mail's language: the stored interface language when
// set, else the triggering request's Accept-Language, negotiated against
// Languages(); en when nothing matches.
func Language(setting, acceptLanguage string) string {
	return i18n.Pick(setting, acceptLanguage, Languages())
}

// catalogueKey is the key of a kind's subject or body.
func catalogueKey(k Kind, part string) string {
	words := strings.Split(string(k), "_")
	for i := 1; i < len(words); i++ {
		if words[i] != "" {
			words[i] = strings.ToUpper(words[i][:1]) + words[i][1:]
		}
	}
	return "mail." + strings.Join(words, "") + "." + part
}

// TemplateData is what the messages may use.
type TemplateData struct {
	Site    string // host of the public URL
	Link    string // reset link
	Code    string // six-digit code
	Minutes int
	Hours   int

	// The reminder mail (#138): the lines (one per kind, counts only), the study
	// link and the one-click unsubscribe link.
	Lines       string
	Unsubscribe string
}

func (d TemplateData) args() map[string]any {
	return map[string]any{"site": d.Site, "link": d.Link, "code": d.Code, "minutes": d.Minutes, "hours": d.Hours, "lines": d.Lines, "unsubscribe": d.Unsubscribe}
}

func lookup(lang, key string) (string, bool) {
	if m, ok := catalogues[lang][key]; ok {
		return m, true
	}
	m, ok := catalogues["en"][key]
	return m, ok
}

// Render formats the mail of kind in lang (an unknown language, or a key
// the language lacks, falls back to en). The recipient is set by the caller.
func Render(kind Kind, lang string, d TemplateData) (Message, error) {
	if _, ok := catalogues[lang]; !ok {
		lang = "en"
	}
	var parts [2]string
	for i, part := range []string{"subject", "body"} {
		msg, ok := lookup(lang, catalogueKey(kind, part))
		if !ok {
			return Message{}, fmt.Errorf("mail: unknown kind %q", kind)
		}
		s, err := i18n.Format(msg, lang, d.args())
		if err != nil {
			return Message{}, fmt.Errorf("mail: %s %s: %w", kind, part, err)
		}
		parts[i] = s
	}
	return Message{Subject: parts[0], Body: parts[1]}, nil
}
