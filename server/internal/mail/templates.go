package mail

import (
	"bytes"
	"embed"
	"fmt"
	"text/template"
)

// Kind names a mail template.
type Kind string

const (
	KindReset       Kind = "reset"
	KindLoginCode   Kind = "login_code"
	KindMFACode     Kind = "mfa_code"
	KindVerifyEmail Kind = "verify_email"
	KindTest        Kind = "test"
)

//go:embed templates/*.txt
var templateFS embed.FS

// subjects are constants: a code or link never appears in a subject (lock
// screens and notification previews show it).
var subjects = map[Kind]string{
	KindReset:       "Reset your qinqin password",
	KindLoginCode:   "Your qinqin sign-in code",
	KindMFACode:     "Your qinqin two-step code",
	KindVerifyEmail: "Confirm your email address for qinqin",
	KindTest:        "qinqin test message",
}

var templates = template.Must(template.ParseFS(templateFS, "templates/*.txt"))

// TemplateData is what the templates may use.
type TemplateData struct {
	Site    string // host of the public URL
	Link    string // reset link
	Code    string // six-digit code
	Minutes int
	Hours   int
}

// Render fills the template of kind. The recipient is set by the caller.
func Render(kind Kind, d TemplateData) (Message, error) {
	subj, ok := subjects[kind]
	if !ok {
		return Message{}, fmt.Errorf("mail: unknown kind %q", kind)
	}
	var b bytes.Buffer
	if err := templates.ExecuteTemplate(&b, string(kind)+".txt", d); err != nil {
		return Message{}, fmt.Errorf("mail: template %s: %w", kind, err)
	}
	return Message{Subject: subj, Body: b.String()}, nil
}
