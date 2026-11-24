package pack

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// MaxNoticeBytes bounds a manifest notice.
const MaxNoticeBytes = 4000

// noticeLink matches one link of the notice mini-markup, [text](url):
// non-empty text without brackets or line breaks, a url without
// parentheses or whitespace.
var noticeLink = regexp.MustCompile(`\[([^\[\]\n]+)\]\(([^()\s]*)\)`)

// ValidateNotice reports whether s is a valid manifest notice: plain
// text of at most MaxNoticeBytes bytes of valid UTF-8, paragraphs
// separated by a blank line, with links written [text](https://...) and
// nothing else of markup, and no bidi embedding, override or isolate
// characters. Only absolute https:// links with a host are
// allowed: http:, javascript:, data:, relative and malformed links are
// rejected, so a renderer never has to decide what a link is. The empty
// notice is valid (the pack has none).
func ValidateNotice(s string) error {
	if len(s) > MaxNoticeBytes {
		return fmt.Errorf("notice is %d bytes, at most %d allowed", len(s), MaxNoticeBytes)
	}
	if !utf8.ValidString(s) {
		return errors.New("notice is not valid UTF-8")
	}
	for _, r := range s {
		if r != '\n' && r != '\t' && (r < 0x20 || r == 0x7f || (r >= 0x80 && r < 0xa0)) {
			return fmt.Errorf("notice contains the control character %U (only line breaks and tabs are allowed)", r)
		}
		if isBidiControl(r) {
			return fmt.Errorf("notice contains the bidirectional control character %U, which can reorder the displayed text", r)
		}
	}
	for _, m := range noticeLink.FindAllStringSubmatch(s, -1) {
		if err := validateNoticeURL(m[2]); err != nil {
			return fmt.Errorf("notice link [%s](%s): %w", m[1], m[2], err)
		}
	}
	// What is left once the well-formed links are cut out must hold no
	// link syntax: a broken link is an error, not silently plain text.
	if rest := noticeLink.ReplaceAllString(s, ""); strings.Contains(rest, "](") {
		i := strings.Index(rest, "](")
		return fmt.Errorf("notice has a malformed link near %q: write links as [text](https://...), with no brackets in the text and no parentheses or spaces in the URL", excerpt(rest, i))
	}
	return nil
}

// validateNoticeURL accepts an absolute https:// URL with a host.
func validateNoticeURL(raw string) error {
	if !strings.HasPrefix(raw, "https://") {
		return errors.New("only https:// links are allowed")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid URL: %v", err)
	}
	if u.Host == "" || u.Hostname() == "" {
		return errors.New("the URL has no host")
	}
	if u.User != nil {
		return errors.New("the URL must not carry user information")
	}
	// url.Parse checks only that a port is digits; a browser rejects one
	// above 65535, so such a link would never render.
	if p := u.Port(); p != "" {
		if n, err := strconv.Atoi(p); err != nil || n > 65535 {
			return fmt.Errorf("the URL port %s is out of range", p)
		}
	}
	return nil
}

// isBidiControl reports the embedding, override and isolate characters
// (U+202A–U+202E, U+2066–U+2069), which reorder the text around them.
// The marks U+200E and U+200F only set a direction and are allowed.
func isBidiControl(r rune) bool {
	return r >= 0x202a && r <= 0x202e || r >= 0x2066 && r <= 0x2069
}

// excerpt returns up to 20 bytes of s on either side of byte offset i,
// cut at rune boundaries.
func excerpt(s string, i int) string {
	start, end := max(0, i-20), min(len(s), i+20)
	for start > 0 && !utf8.RuneStart(s[start]) {
		start--
	}
	for end < len(s) && !utf8.RuneStart(s[end]) {
		end++
	}
	return s[start:end]
}
