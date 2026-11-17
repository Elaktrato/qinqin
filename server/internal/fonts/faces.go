// Package fonts is the font pack store (docs/contracts/fonts/): it
// validates a font pack's faces.json and slice files, keeps installed font
// packs (font_packs, font_slices) with their WOFF2 slices under
// <data>/fonts, and lists the installed faces for GET /api/fonts.
package fonts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Limits of a font pack (pinned by faces-invalid.json and the README).
const (
	MaxFacesBytes = 4 << 20
	MaxFaces      = 16
	MaxSlices     = 1500
	MaxSliceBytes = 2 << 20
	maxOriginal   = 128
)

// Faces, scripts and styles, in the order GET /api/fonts lists them.
var (
	FaceOrder   = []string{"sans", "serif", "kai"}
	ScriptOrder = []string{"Hans", "Hant", "Jpan"}
	StyleOrder  = []string{"normal", "italic"}
)

// Slice is one WOFF2 file of a face: its pack path, its sha256 (the hex of
// the file name) and the code points it carries as a CSS unicode-range.
type Slice struct {
	File         string
	Sha          string
	UnicodeRange string
}

// Face is one validated face of a faces.json. Weight is the CSS weight
// as written ("400" or "200 900"); WeightLo/WeightHi are its bounds.
type Face struct {
	Face, Script, Original, Weight, Style string
	WeightLo, WeightHi                    int
	Slices                                []Slice
}

// overlaps reports whether f and g are the same face key with
// overlapping weights: two such faces may not coexist (README, "One pack
// per face").
func (f Face) overlaps(g Face) bool {
	return f.Face == g.Face && f.Script == g.Script && f.Style == g.Style &&
		f.WeightLo <= g.WeightHi && g.WeightLo <= f.WeightHi
}

// Key names the face for messages: "sans/Hans 400 normal".
func (f Face) Key() string { return f.Face + "/" + f.Script + " " + f.Weight + " " + f.Style }

// FileError is the first problem of a faces.json: a stable code and the
// JSON path of the value it is about (faces-invalid.json).
type FileError struct{ Code, Path string }

func (e *FileError) Error() string { return e.Code + " at " + e.Path }

func fail(code, path string) error { return &FileError{Code: code, Path: path} }

var (
	filePattern   = regexp.MustCompile(`^slices/([0-9a-f]{64})\.woff2$`)
	weightPattern = regexp.MustCompile(`^([1-9][0-9]{0,3})(?: ([1-9][0-9]{0,3}))?$`)
	rangePattern  = regexp.MustCompile(`^U\+(0|[1-9A-F][0-9A-F]{0,5})(?:-(0|[1-9A-F][0-9A-F]{0,5}))?$`)
)

var (
	topMembers   = []string{"version", "faces"}
	faceMembers  = []string{"face", "script", "original", "weight", "style", "slices"}
	sliceMembers = []string{"file", "unicodeRange"}
)

// ParseFaces validates a faces.json and returns its faces in file order.
// Errors are *FileError; the first problem in the contract's order wins.
func ParseFaces(data []byte) ([]Face, error) {
	if len(data) > MaxFacesBytes {
		return nil, fail("too-large", "$")
	}
	if !json.Valid(data) {
		return nil, fail("bad-json", "$")
	}
	top, err := strictObject(data, "$", topMembers)
	if err != nil {
		return nil, err
	}
	if v := bytes.TrimSpace(top["version"]); string(v) != "1" {
		return nil, fail("bad-version", "$.version")
	}
	var items []json.RawMessage
	if raw := bytes.TrimSpace(top["faces"]); len(raw) == 0 || raw[0] != '[' || json.Unmarshal(raw, &items) != nil || len(items) == 0 {
		return nil, fail("no-faces", "$.faces")
	}
	if len(items) > MaxFaces {
		return nil, fail("too-many-faces", "$.faces")
	}
	out := make([]Face, 0, len(items))
	files := map[string]bool{}
	total := 0
	for i, raw := range items {
		path := fmt.Sprintf("$.faces[%d]", i)
		f, err := parseFace(raw, path, out, files, &total)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, nil
}

func parseFace(raw json.RawMessage, path string, earlier []Face, files map[string]bool, total *int) (Face, error) {
	m, err := strictObject(raw, path, faceMembers)
	if err != nil {
		return Face{}, err
	}
	var f Face
	var ok bool
	if f.Face, ok = jsonString(m["face"]); !ok || !oneOf(f.Face, FaceOrder) {
		return Face{}, fail("bad-face", path+".face")
	}
	if f.Script, ok = jsonString(m["script"]); !ok || !oneOf(f.Script, ScriptOrder) {
		return Face{}, fail("bad-script", path+".script")
	}
	if f.Original, ok = jsonString(m["original"]); !ok || !validName(f.Original) {
		return Face{}, fail("bad-original", path+".original")
	}
	if f.Weight, ok = jsonString(m["weight"]); !ok {
		return Face{}, fail("bad-weight", path+".weight")
	}
	if f.WeightLo, f.WeightHi, ok = ParseWeight(f.Weight); !ok {
		return Face{}, fail("bad-weight", path+".weight")
	}
	if f.Style, ok = jsonString(m["style"]); !ok || !oneOf(f.Style, StyleOrder) {
		return Face{}, fail("bad-style", path+".style")
	}
	for _, g := range earlier {
		if f.overlaps(g) {
			return Face{}, fail("duplicate-face", path)
		}
	}
	var items []json.RawMessage
	if raw := bytes.TrimSpace(m["slices"]); len(raw) == 0 || raw[0] != '[' || json.Unmarshal(raw, &items) != nil || len(items) == 0 {
		return Face{}, fail("no-slices", path+".slices")
	}
	var cover spans
	for j, raw := range items {
		sp := fmt.Sprintf("%s.slices[%d]", path, j)
		if *total++; *total > MaxSlices {
			return Face{}, fail("too-many-slices", sp)
		}
		sm, err := strictObject(raw, sp, sliceMembers)
		if err != nil {
			return Face{}, err
		}
		var s Slice
		s.File, ok = jsonString(sm["file"])
		match := filePattern.FindStringSubmatch(s.File)
		if !ok || match == nil {
			return Face{}, fail("bad-file", sp+".file")
		}
		if files[s.File] {
			return Face{}, fail("duplicate-file", sp+".file")
		}
		files[s.File] = true
		s.Sha = match[1]
		if s.UnicodeRange, ok = jsonString(sm["unicodeRange"]); !ok {
			return Face{}, fail("bad-range", sp+".unicodeRange")
		}
		list, ok := ParseUnicodeRange(s.UnicodeRange)
		if !ok {
			return Face{}, fail("bad-range", sp+".unicodeRange")
		}
		for _, r := range list {
			if !cover.add(r) {
				return Face{}, fail("overlapping-range", sp+".unicodeRange")
			}
		}
		f.Slices = append(f.Slices, s)
	}
	return f, nil
}

// ParseWeight parses a CSS weight "N" or range "N M" (1 <= N <= M <= 1000,
// no leading zero).
func ParseWeight(s string) (lo, hi int, ok bool) {
	m := weightPattern.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, false
	}
	lo, _ = strconv.Atoi(m[1])
	hi = lo
	if m[2] != "" {
		hi, _ = strconv.Atoi(m[2])
	}
	if hi > 1000 || lo > hi {
		return 0, 0, false
	}
	return lo, hi, true
}

// Span is an inclusive code point range.
type Span struct{ Lo, Hi rune }

// ParseUnicodeRange parses a contract unicode-range: a comma list, no
// spaces, of U+X or U+X-Y (upper-case hex, no leading zero, X < Y <= 10FFFF).
func ParseUnicodeRange(s string) ([]Span, bool) {
	if s == "" {
		return nil, false
	}
	var out []Span
	for _, part := range strings.Split(s, ",") {
		m := rangePattern.FindStringSubmatch(part)
		if m == nil {
			return nil, false
		}
		lo, _ := strconv.ParseUint(m[1], 16, 32)
		hi := lo
		if m[2] != "" {
			hi, _ = strconv.ParseUint(m[2], 16, 32)
			if hi <= lo {
				return nil, false
			}
		}
		if hi > unicode.MaxRune {
			return nil, false
		}
		out = append(out, Span{rune(lo), rune(hi)})
	}
	return out, true
}

// spans is a sorted list of disjoint spans.
type spans []Span

// add inserts r unless it overlaps a span already in the list.
func (s *spans) add(r Span) bool {
	list := *s
	i := sort.Search(len(list), func(i int) bool { return list[i].Hi >= r.Lo })
	if i < len(list) && list[i].Lo <= r.Hi {
		return false
	}
	list = append(list, Span{})
	copy(list[i+1:], list[i:])
	list[i] = r
	*s = list
	return true
}

func oneOf(s string, list []string) bool {
	for _, v := range list {
		if s == v {
			return true
		}
	}
	return false
}

// validName: 1..128 code points, no control character, no surrounding space.
func validName(s string) bool {
	n := utf8.RuneCountInString(s)
	if n == 0 || n > maxOriginal || strings.TrimSpace(s) != s || !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// jsonString decodes raw as a JSON string.
func jsonString(raw json.RawMessage) (string, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '"' {
		return "", false
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return "", false
	}
	return s, true
}

// strictObject reads a JSON object (raw is valid JSON) whose members must
// be exactly want: a repeated member, then an unknown one (first in file
// order), then a missing one (in want's order) is refused.
func strictObject(raw json.RawMessage, path string, want []string) (map[string]json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	tok, err := dec.Token()
	if err != nil || tok != json.Delim('{') {
		return nil, fail("not-an-object", path)
	}
	type member struct {
		key string
		raw json.RawMessage
	}
	var list []member
	seen := map[string]bool{}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, fail("bad-json", path)
		}
		key, _ := tok.(string)
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, fail("bad-json", path)
		}
		if seen[key] {
			return nil, fail("duplicate-member", path+"."+key)
		}
		seen[key] = true
		list = append(list, member{key, v})
	}
	if _, err := dec.Token(); err != nil && err != io.EOF {
		return nil, fail("bad-json", path)
	}
	out := make(map[string]json.RawMessage, len(list))
	for _, m := range list {
		if !oneOf(m.key, want) {
			return nil, fail("unknown-member", path+"."+m.key)
		}
		out[m.key] = m.raw
	}
	for _, k := range want {
		if _, ok := out[k]; !ok {
			return nil, fail("missing-member", path+"."+k)
		}
	}
	return out, nil
}
