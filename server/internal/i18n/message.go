package i18n

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"unicode"

	"golang.org/x/text/feature/plural"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
	"golang.org/x/text/number"
)

// The catalogue message syntax (docs/contracts/i18n/README.md "Message
// syntax"): an ICU subset shared with the web (apps/web/src/lib/i18n/
// message.ts) and Android. `{name}` arguments, a plural as the whole message
// (CLDR categories from x/text, `#` the formatted count), `<tag>…</tag>`
// spans (plain-text output keeps their content), literal apostrophes.
// Fixtures: messages.json, invalid-messages.json, plural-categories.json.

// ErrorKind names why a message is refused (the fixtures' error kinds).
type ErrorKind string

const (
	ErrSelect            ErrorKind = "select"
	ErrArgType           ErrorKind = "argType"
	ErrExactMatch        ErrorKind = "exactMatch"
	ErrNestedPlural      ErrorKind = "nestedPlural"
	ErrPartialPlural     ErrorKind = "partialPlural"
	ErrMissingOther      ErrorKind = "missingOther"
	ErrUnknownCategory   ErrorKind = "unknownCategory"
	ErrDuplicateCategory ErrorKind = "duplicateCategory"
	ErrUnbalanced        ErrorKind = "unbalanced"
	ErrBadArgName        ErrorKind = "badArgName"
	ErrStrayHash         ErrorKind = "strayHash"
	ErrBadTag            ErrorKind = "badTag"
	ErrNestedTag         ErrorKind = "nestedTag"
	ErrTagInPlural       ErrorKind = "tagInPlural"
	ErrMissingArg        ErrorKind = "missingArg"
	ErrPluralNotNumber   ErrorKind = "pluralNotNumber"
)

// MessageError is a parse or format refusal.
type MessageError struct {
	Kind    ErrorKind
	Message string
	Detail  string
}

func (e *MessageError) Error() string {
	if e.Detail != "" {
		return fmt.Sprintf("%s (%s) in message %q", e.Kind, e.Detail, e.Message)
	}
	return fmt.Sprintf("%s in message %q", e.Kind, e.Message)
}

// Categories are the CLDR plural categories a message may use.
var Categories = []string{"zero", "one", "two", "few", "many", "other"}

func isCategory(s string) bool {
	for _, c := range Categories {
		if c == s {
			return true
		}
	}
	return false
}

type segKind int

const (
	segText segKind = iota
	segArg
	segCount
	segTag
)

type segment struct {
	kind     segKind
	value    string // text, argument or tag name
	children []segment
}

// Parsed is a parsed message.
type Parsed struct {
	src       string
	segments  []segment
	pluralArg string               // "" when the message is not a plural
	branches  map[string][]segment // category -> branch
	order     []string             // categories in message order
}

// IsPlural reports whether the whole message is a plural.
func (p *Parsed) IsPlural() bool { return p.pluralArg != "" }

// Categories lists the plural categories in message order (nil for a non-plural).
func (p *Parsed) Categories() []string { return append([]string(nil), p.order...) }

var nameRe = regexp.MustCompile(`^[a-z][a-zA-Z0-9]*$`)
var tagRe = regexp.MustCompile(`^<(/?)([a-z][a-zA-Z0-9]*)>`)

type parser struct {
	src []rune
	raw string
	i   int
}

type parseFail struct{ err *MessageError }

func (p *parser) fail(kind ErrorKind, detail string) {
	panic(parseFail{&MessageError{Kind: kind, Message: p.raw, Detail: detail}})
}

func isSpace(r rune) bool { return unicode.IsSpace(r) || r == '\ufeff' }

func (p *parser) skipSpace() {
	for p.i < len(p.src) && isSpace(p.src[p.i]) {
		p.i++
	}
}

// argHeader is at `{`: reads the name and an optional `, type`.
func (p *parser) argHeader() (name string, typ string, hasType bool) {
	p.i++
	start := p.i
	for p.i < len(p.src) && !strings.ContainsRune("{},", p.src[p.i]) {
		p.i++
	}
	if p.i >= len(p.src) || p.src[p.i] == '{' {
		p.fail(ErrUnbalanced, "unclosed argument")
	}
	raw := string(p.src[start:p.i])
	sep := p.src[p.i]
	p.i++
	if sep == '}' {
		if !nameRe.MatchString(raw) {
			p.fail(ErrBadArgName, raw)
		}
		return raw, "", false
	}
	name = strings.TrimSpace(raw)
	if !nameRe.MatchString(name) {
		p.fail(ErrBadArgName, raw)
	}
	p.skipSpace()
	ts := p.i
	for p.i < len(p.src) && ((p.src[p.i] >= 'a' && p.src[p.i] <= 'z') || (p.src[p.i] >= 'A' && p.src[p.i] <= 'Z')) {
		p.i++
	}
	return name, string(p.src[ts:p.i]), true
}

type tagInfo struct {
	name    string
	closing bool
	end     int
}

func (p *parser) tagAt() *tagInfo {
	m := tagRe.FindStringSubmatch(string(p.src[p.i:]))
	if m == nil {
		return nil
	}
	return &tagInfo{name: m[2], closing: m[1] == "/", end: p.i + len([]rune(m[0]))}
}

// sequence reads until the end (top), a `}` (branch) or the closing tag.
// plural is set when the whole message turned out to be a plural.
func (p *parser) sequence(branch bool, tag string, inTag bool) (out []segment, plural bool) {
	var text strings.Builder
	flush := func() {
		if text.Len() > 0 {
			out = append(out, segment{kind: segText, value: text.String()})
			text.Reset()
		}
	}
	for p.i < len(p.src) {
		c := p.src[p.i]
		switch c {
		case '{':
			at := p.i
			name, typ, hasType := p.argHeader()
			if !hasType {
				flush()
				out = append(out, segment{kind: segArg, value: name})
				continue
			}
			switch typ {
			case "plural":
				if branch {
					p.fail(ErrNestedPlural, "")
				}
				if at != 0 || inTag {
					p.fail(ErrPartialPlural, "")
				}
				p.i = at
				return nil, true
			case "select":
				p.fail(ErrSelect, "")
			}
			p.fail(ErrArgType, typ)
		case '}':
			if branch {
				flush()
				return out, false
			}
			p.fail(ErrUnbalanced, "stray }")
		case '#':
			if !branch {
				p.fail(ErrStrayHash, "")
			}
			flush()
			out = append(out, segment{kind: segCount})
			p.i++
			continue
		case '<':
			t := p.tagAt()
			if branch {
				if t != nil {
					p.fail(ErrTagInPlural, "")
				}
				p.fail(ErrBadTag, "")
			}
			if t == nil {
				p.fail(ErrBadTag, "")
			}
			if t.closing {
				if !inTag || t.name != tag {
					p.fail(ErrBadTag, "unexpected </"+t.name+">")
				}
				flush()
				p.i = t.end
				return out, false
			}
			if inTag {
				p.fail(ErrNestedTag, "")
			}
			flush()
			p.i = t.end
			children, _ := p.sequence(false, t.name, true)
			out = append(out, segment{kind: segTag, value: t.name, children: children})
			continue
		}
		text.WriteRune(c)
		p.i++
	}
	if branch {
		p.fail(ErrUnbalanced, "unclosed branch")
	}
	if inTag {
		p.fail(ErrBadTag, "unclosed <"+tag+">")
	}
	flush()
	return out, false
}

func isPluralSelectorEnd(r rune) bool { return isSpace(r) || r == '{' || r == '}' }

// plural reads the whole message as a plural (at i = 0, the `{`).
func (p *parser) plural(out *Parsed) {
	name, _, _ := p.argHeader()
	p.skipSpace()
	if p.i >= len(p.src) || p.src[p.i] != ',' {
		p.fail(ErrUnbalanced, "expected , after plural")
	}
	p.i++
	out.branches = map[string][]segment{}
	for {
		p.skipSpace()
		if p.i >= len(p.src) {
			p.fail(ErrUnbalanced, "unclosed plural")
		}
		if p.src[p.i] == '}' {
			p.i++
			break
		}
		start := p.i
		for p.i < len(p.src) && !isPluralSelectorEnd(p.src[p.i]) {
			p.i++
		}
		sel := string(p.src[start:p.i])
		if strings.HasPrefix(sel, "=") {
			p.fail(ErrExactMatch, sel)
		}
		if !isCategory(sel) {
			p.fail(ErrUnknownCategory, sel)
		}
		if _, dup := out.branches[sel]; dup {
			p.fail(ErrDuplicateCategory, sel)
		}
		p.skipSpace()
		if p.i >= len(p.src) || p.src[p.i] != '{' {
			p.fail(ErrUnbalanced, "expected { after "+sel)
		}
		p.i++
		b, _ := p.sequence(true, "", false)
		if b == nil {
			b = []segment{}
		}
		out.branches[sel] = b
		out.order = append(out.order, sel)
		p.i++ // the branch's }
	}
	if p.i != len(p.src) {
		p.fail(ErrPartialPlural, "")
	}
	if _, ok := out.branches["other"]; !ok {
		p.fail(ErrMissingOther, "")
	}
	out.pluralArg = name
}

var parsedCache sync.Map // string -> *Parsed

// Parse parses a message (cached); a *MessageError names the kind for
// anything outside the subset.
func Parse(msg string) (parsed *Parsed, err error) {
	if hit, ok := parsedCache.Load(msg); ok {
		return hit.(*Parsed), nil
	}
	defer func() {
		if r := recover(); r != nil {
			pf, ok := r.(parseFail)
			if !ok {
				panic(r)
			}
			parsed, err = nil, pf.err
		}
	}()
	p := &parser{src: []rune(msg), raw: msg}
	out := &Parsed{src: msg}
	segs, isPlural := p.sequence(false, "", false)
	if isPlural {
		p.plural(out)
	} else {
		out.segments = segs
	}
	parsedCache.Store(msg, out)
	return out, nil
}

func collectArgs(segs []segment, into map[string]bool) {
	for _, s := range segs {
		switch s.kind {
		case segArg:
			into[s.value] = true
		case segTag:
			collectArgs(s.children, into)
		}
	}
}

// Args lists every argument name the message uses (any branch).
func (p *Parsed) Args() map[string]bool {
	out := map[string]bool{}
	collectArgs(p.segments, out)
	if p.IsPlural() {
		out[p.pluralArg] = true
		for _, b := range p.branches {
			collectArgs(b, out)
		}
	}
	return out
}

// toFloat accepts the numeric argument kinds a caller may pass.
func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	case float64:
		return n, !math.IsNaN(n) && !math.IsInf(n, 0)
	case float32:
		f := float64(n)
		return f, !math.IsNaN(f) && !math.IsInf(f, 0)
	}
	return 0, false
}

func argString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(x), 'f', -1, 32)
	}
	return fmt.Sprint(v)
}

// tagFor parses a locale, falling back to en (as the web does for a locale
// Intl cannot resolve).
func tagFor(locale string) language.Tag {
	t, err := language.Parse(locale)
	if err != nil {
		return language.English
	}
	return t
}

// PluralCategory is the CLDR cardinal category of n in locale.
func PluralCategory(locale string, n float64) string {
	n = math.Abs(n)
	s := strconv.FormatFloat(n, 'f', -1, 64)
	intPart, frac, _ := strings.Cut(s, ".")
	i, err := strconv.Atoi(intPart)
	if err != nil {
		i = math.MaxInt32 // beyond int: every CLDR rule treats it as a large integer
	}
	f := 0
	if frac != "" {
		f, _ = strconv.Atoi(frac)
	}
	form := plural.Cardinal.MatchPlural(tagFor(locale), i, len(frac), len(frac), f, f)
	switch form {
	case plural.Zero:
		return "zero"
	case plural.One:
		return "one"
	case plural.Two:
		return "two"
	case plural.Few:
		return "few"
	case plural.Many:
		return "many"
	}
	return "other"
}

// formatCount is `#`: n in the locale's default decimal format (grouped,
// at most three fraction digits, as Intl.NumberFormat).
func formatCount(locale string, n float64) string {
	p := message.NewPrinter(tagFor(locale))
	if n == math.Trunc(n) && math.Abs(n) < 1e15 {
		return p.Sprint(number.Decimal(int64(n)))
	}
	return p.Sprint(number.Decimal(n, number.MaxFractionDigits(3)))
}

// Format renders msg in locale with args (strings or numbers) as plain
// text: a tag's content kept, the tag dropped. A missing argument is
// missingArg; a plural argument that is not a finite number is
// pluralNotNumber.
func Format(msg, locale string, args map[string]any) (string, error) {
	p, err := Parse(msg)
	if err != nil {
		return "", err
	}
	for name := range p.Args() {
		if _, ok := args[name]; !ok {
			return "", &MessageError{Kind: ErrMissingArg, Message: msg, Detail: name}
		}
	}
	segs := p.segments
	count := ""
	if p.IsPlural() {
		n, ok := toFloat(args[p.pluralArg])
		if !ok {
			return "", &MessageError{Kind: ErrPluralNotNumber, Message: msg, Detail: p.pluralArg}
		}
		b, found := p.branches[PluralCategory(locale, n)]
		if !found {
			b = p.branches["other"]
		}
		segs = b
		count = formatCount(locale, n)
	}
	var out strings.Builder
	var write func([]segment)
	write = func(ss []segment) {
		for _, s := range ss {
			switch s.kind {
			case segText:
				out.WriteString(s.value)
			case segCount:
				out.WriteString(count)
			case segArg:
				out.WriteString(argString(args[s.value]))
			case segTag:
				write(s.children)
			}
		}
	}
	write(segs)
	return out.String(), nil
}
