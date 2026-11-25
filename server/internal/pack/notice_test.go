package pack_test

import (
	"strings"
	"testing"

	"qinqin/internal/pack"
)

func TestValidateNotice(t *testing.T) {
	for _, tc := range []struct {
		name   string
		notice string
		want   string // "" = valid; else a substring of the error
	}{
		{"empty", "", ""},
		{"plain text", "Approximate levels.", ""},
		{"paragraphs and CJK", "第一段 《HSK 考试大纲》.\n\nSecond paragraph, jōyō kanji 分.", ""},
		{"https link", "From [kanjiapi.dev](https://github.com/onlyskin/kanjiapi.dev) (MIT).", ""},
		{"two links and a path", "[A](https://a.example/x?y=1#z) and [B](https://b.example).", ""},
		{"brackets without a link", "A note [sic] and (an aside).", ""},
		{"exactly the limit", strings.Repeat("a", pack.MaxNoticeBytes), ""},
		{"tab", "a\tb", ""},

		{"too long", strings.Repeat("a", pack.MaxNoticeBytes+1), "at most 4000"},
		{"too long in runes", strings.Repeat("汉", pack.MaxNoticeBytes/3+1), "at most 4000"},
		{"invalid utf-8", "bad \xff byte", "UTF-8"},
		{"control character", "bell\x07", "control character"},
		{"carriage return", "a\r\nb", "control character"},
		{"http link", "[site](http://example.com)", "only https://"},
		{"javascript link", "[x](javascript:alert(1))", "malformed link"},
		{"javascript link without parens", "[x](javascript:alert)", "only https://"},
		{"data link", "[x](data:text/html,hi)", "only https://"},
		{"relative link", "[x](/ARPHICPL.TXT)", "only https://"},
		{"protocol-relative link", "[x](//example.com)", "only https://"},
		{"uppercase scheme", "[x](HTTPS://example.com)", "only https://"},
		{"no host", "[x](https://)", "no host"},
		{"no host with path", "[x](https:///path)", "no host"},
		{"user info", "[x](https://user@example.com)", "user information"},
		{"empty link text", "[](https://example.com)", "malformed link"},
		{"space in url", "[x](https://example.com/a b)", "malformed link"},
		{"unclosed link", "see [x](https://example.com", "malformed link"},
		{"parens in url", "[x](https://en.wikipedia.org/wiki/A_(b))", "malformed link"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := pack.ValidateNotice(tc.notice)
			switch {
			case tc.want == "" && err != nil:
				t.Errorf("ValidateNotice = %v, want nil", err)
			case tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)):
				t.Errorf("ValidateNotice = %v, want an error containing %q", err, tc.want)
			}
		})
	}
}

// Manifest.Validate applies the notice rules; a manifest without a
// notice stays valid.
func TestManifestValidatesNotice(t *testing.T) {
	m := fixtureManifest
	if err := m.Validate(); err != nil {
		t.Fatalf("no notice: Validate = %v, want nil", err)
	}
	m.Notice = "See [the list](https://example.com/list)."
	if err := m.Validate(); err != nil {
		t.Errorf("valid notice: Validate = %v, want nil", err)
	}
	m.Notice = "See [the list](http://example.com/list)."
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "manifest: notice link") {
		t.Errorf("http notice: Validate = %v, want a manifest notice error", err)
	}
}
