// Package mail composes and sends the plain-text mails of the accounts
// features (reset links, sign-in and verification codes, the test mail) over
// SMTP with the standard library only.
package mail

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/quotedprintable"
	"net/mail"
	"net/url"
	"strings"
	"time"
	"unicode"
)

// ErrHeader is returned when a header value could break out of its header
// (CR, LF or NUL) or is otherwise unusable.
var ErrHeader = errors.New("mail: invalid header value")

// ErrAddress is returned for an address the mail path will not carry.
var ErrAddress = errors.New("mail: invalid address")

// Sender is the From identity.
type Sender struct{ Address, Name string }

// Message is one outgoing mail: one recipient, plain text.
type Message struct {
	To, Subject, Body string
	// ListUnsubscribe is an https URL; when set the mail carries the
	// List-Unsubscribe and List-Unsubscribe-Post (one-click, RFC 8058) headers.
	ListUnsubscribe string
}

const maxAddressBytes = 254

// ValidAddress (no trimming: callers trim) accepts exactly one bare ASCII address (no display name, no
// comments, no control characters, at most 254 bytes) and returns it.
// Internationalised domains must already be in punycode.
func ValidAddress(s string) (string, error) {
	if s == "" || len(s) > maxAddressBytes {
		return "", ErrAddress
	}
	for _, r := range s {
		if r > unicode.MaxASCII || unicode.IsControl(r) || unicode.IsSpace(r) || strings.ContainsRune(`<>,;:"\()[]`, r) {
			return "", ErrAddress
		}
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s || a.Name != "" {
		return "", ErrAddress
	}
	local, domain, ok := strings.Cut(s, "@")
	if !ok || local == "" || strings.Contains(domain, "@") || !strings.Contains(domain, ".") ||
		strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") || strings.Contains(domain, "..") {
		return "", ErrAddress
	}
	return s, nil
}

// headerSafe refuses a value that could start a second header.
func headerSafe(name, v string) error {
	if strings.ContainsAny(v, "\r\n\x00") {
		return fmt.Errorf("%w: %s", ErrHeader, name)
	}
	return nil
}

// Compose builds the RFC 5322 message. Every header is written here and
// nowhere else; every caller-controlled value (from name, addresses, subject)
// is refused when it holds CR, LF or NUL and is encoded (display name,
// subject) or validated (addresses) otherwise. rnd supplies the Message-ID
// (crypto/rand in production).
func Compose(from Sender, m Message, now time.Time, rnd io.Reader) ([]byte, error) {
	for name, v := range map[string]string{"from name": from.Name, "from": from.Address, "to": m.To, "subject": m.Subject, "list-unsubscribe": m.ListUnsubscribe} {
		if err := headerSafe(name, v); err != nil {
			return nil, err
		}
	}
	fromAddr, err := ValidAddress(from.Address)
	if err != nil {
		return nil, fmt.Errorf("from: %w", err)
	}
	toAddr, err := ValidAddress(m.To)
	if err != nil {
		return nil, fmt.Errorf("to: %w", err)
	}
	_, domain, _ := strings.Cut(fromAddr, "@")
	id := make([]byte, 16)
	if _, err := io.ReadFull(rnd, id); err != nil {
		return nil, fmt.Errorf("mail: message id: %w", err)
	}
	fromHdr := fromAddr
	if strings.TrimSpace(from.Name) != "" {
		fromHdr = (&mail.Address{Name: from.Name, Address: fromAddr}).String()
	}
	if m.ListUnsubscribe != "" {
		u, err := url.Parse(m.ListUnsubscribe)
		if err != nil || u.Scheme != "https" || u.Host == "" || strings.ContainsAny(m.ListUnsubscribe, " <>\t") {
			return nil, fmt.Errorf("%w: list-unsubscribe", ErrHeader)
		}
	}
	var body bytes.Buffer
	qp := quotedprintable.NewWriter(&body)
	if _, err := qp.Write([]byte(strings.ReplaceAll(strings.ReplaceAll(m.Body, "\r\n", "\n"), "\r", "\n"))); err != nil {
		return nil, err
	}
	if err := qp.Close(); err != nil {
		return nil, err
	}
	var b bytes.Buffer
	hdr := func(k, v string) { b.WriteString(k + ": " + v + "\r\n") }
	hdr("From", fromHdr)
	hdr("To", toAddr)
	hdr("Subject", mime.QEncoding.Encode("utf-8", m.Subject))
	hdr("Date", now.UTC().Format(time.RFC1123Z))
	hdr("Message-ID", "<"+hex.EncodeToString(id)+"@"+domain+">")
	hdr("MIME-Version", "1.0")
	hdr("Content-Type", "text/plain; charset=utf-8")
	hdr("Content-Transfer-Encoding", "quoted-printable")
	hdr("Auto-Submitted", "auto-generated")
	if m.ListUnsubscribe != "" {
		hdr("List-Unsubscribe", "<"+m.ListUnsubscribe+">")
		hdr("List-Unsubscribe-Post", "List-Unsubscribe=One-Click")
	}
	b.WriteString("\r\n")
	b.Write(body.Bytes())
	return b.Bytes(), nil
}
