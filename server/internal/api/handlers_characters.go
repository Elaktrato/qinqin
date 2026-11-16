package api

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"qinqin/internal/lexicon"
)

// charRow is one character of GET /api/characters in the compact form the
// web client's CharRow declares: every field but the id and glyph is
// omitted when absent.
type charRow struct {
	I int64    `json:"i"`           // entry id
	C string   `json:"c"`           // glyph (simplified for zh)
	S int      `json:"s,omitempty"` // strokes
	G int      `json:"g,omitempty"` // ja: KANJIDIC2 grade
	F int      `json:"f,omitempty"` // ja: newspaper frequency rank
	T int      `json:"t,omitempty"` // zh: 1 when on the 通用规范汉字表
	B int      `json:"b,omitempty"` // zh: GB2312 level
	H int      `json:"h,omitempty"` // zh: lowest HK primary grade of the cell
	R string   `json:"r,omitempty"` // first reading
	M string   `json:"m,omitempty"` // first gloss
	V []string `json:"v,omitempty"` // variant forms sharing the cell
	K int      `json:"k,omitempty"` // Kangxi number of the radical link
}

// charactersBody is GET /api/characters. Stale is set when the database
// predates the level attrs (see lexicon.CharacterSet): the list then
// comes from the fallback rule and the page shows the re-seed hint.
type charactersBody struct {
	Language string    `json:"language"`
	Count    int       `json:"count"`
	Stale    bool      `json:"stale,omitempty"`
	Chars    []charRow `json:"chars"`
}

// charactersPayload is one encoded response: the JSON body, its gzip
// form and its validator, built for one lexicon version.
type charactersPayload struct {
	version, etag string
	raw, gz       []byte
}

// charactersCache keeps the last payload per language with a character
// universe (ja, zh). A payload is reused while lexicon.CharactersVersion
// is unchanged, so a revalidation or repeat load costs a few index seeks
// instead of the universe query and the compression. Each language has
// its own slot and lock: concurrent first loads of a language share one
// build, and a slow zh build does not hold up ja.
type charactersCache struct {
	mu    sync.Mutex // guards slots
	slots map[string]*charactersSlot
}

// charactersSlot is one language's cached payload and the lock its
// builds run under.
type charactersSlot struct {
	mu      sync.Mutex
	payload *charactersPayload
}

// slot returns language's slot, creating it on first use.
func (c *charactersCache) slot(language string) *charactersSlot {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.slots == nil {
		c.slots = make(map[string]*charactersSlot)
	}
	s := c.slots[language]
	if s == nil {
		s = &charactersSlot{}
		c.slots[language] = s
	}
	return s
}

// get returns language's payload for the current lexicon version,
// building it when the cached one is missing or older. Languages without
// a universe are built (empty) and not cached, so arbitrary codes cannot
// grow the cache. The version is read under the language's lock, after
// any build a request waited for, and before the list: a write in between
// leaves the cached payload under an older version, so the next request
// rebuilds it.
func (c *charactersCache) get(ctx context.Context, st lexicon.Store, language string) (*charactersPayload, error) {
	if !lexicon.HasCharacterUniverse(language) {
		version, err := st.CharactersVersion(ctx)
		if err != nil {
			return nil, err
		}
		return buildCharactersPayload(ctx, st, language, version)
	}
	s := c.slot(language)
	s.mu.Lock()
	defer s.mu.Unlock()
	version, err := st.CharactersVersion(ctx)
	if err != nil {
		return nil, err
	}
	if s.payload != nil && s.payload.version == version {
		return s.payload, nil
	}
	p, err := buildCharactersPayload(ctx, st, language, version)
	if err != nil {
		return nil, err
	}
	s.payload = p
	return p, nil
}

// charactersFormat versions the body's shape inside the ETag: a change to
// the fields (2 dropped "j", the pre-2010 JLPT level; 3 added "k", the
// radical number) bumps it, so a
// validator issued for the old shape over an unchanged lexicon never
// earns a 304.
const charactersFormat = 3

// buildCharactersPayload lists, encodes and compresses language's
// universe. The weak ETag names the body format, the language, the count
// and a digest of the lexicon version (the latest stamps), the same for
// both encodings.
func buildCharactersPayload(ctx context.Context, st lexicon.Store, language, version string) (*charactersPayload, error) {
	set, err := st.Characters(ctx, language)
	if err != nil {
		return nil, err
	}
	body := charactersBody{Language: language, Count: len(set.Rows), Stale: set.Stale, Chars: make([]charRow, len(set.Rows))}
	for i, r := range set.Rows {
		body.Chars[i] = charRow{
			I: r.ID, C: r.Char, S: r.Strokes,
			G: r.Grade, F: r.Freq,
			T: r.TGHZ, B: r.GB, H: r.HKGrade,
			R: r.Reading, M: r.Gloss, V: r.Variants, K: r.Radical,
		}
	}
	var raw bytes.Buffer
	enc := json.NewEncoder(&raw)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(body); err != nil {
		return nil, err
	}
	p := &charactersPayload{version: version, raw: bytes.TrimSuffix(raw.Bytes(), []byte("\n"))}
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	if _, err := zw.Write(p.raw); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	p.gz = gz.Bytes()
	sum := sha256.Sum256([]byte(version))
	p.etag = fmt.Sprintf(`W/"chars%d-%s-%d-%s"`, charactersFormat, language, body.Count, hex.EncodeToString(sum[:8]))
	return p, nil
}

// handleListCharacters serves GET /api/characters?language=: every
// character of the language's universe in compact form, for the mastery
// map. It is public. A missing or malformed language is 400; a
// well-formed language without a universe (only ja and zh have one) gets
// an empty list.
//
// ja lists every KANJIDIC2 character, zh every character on the
// 通用规范汉字表 or with a CC-CEDICT pinyin reading, in code point order.
// A database seeded before the importers kept the level attrs has no
// KANJIDIC2 marker (ja) or standard-list attr (zh): the list then falls
// back to every ja character with KANJIDIC2 strokes or readings, and to
// the zh pinyin rule, and the body carries "stale": true so the page can
// ask for a re-seed (`qinqin seed`).
//
// The body is gzip-compressed when Accept-Encoding allows. It carries a
// weak ETag and `Cache-Control: private, max-age=0, must-revalidate`: the
// browser revalidates each visit and a matching If-None-Match gets a
// bodyless 304.
func (s *server) handleListCharacters(w http.ResponseWriter, r *http.Request) {
	language := r.URL.Query().Get("language")
	if language == "" || !validLanguageParam(language) {
		http.Error(w, "invalid language", http.StatusBadRequest)
		return
	}
	p, err := s.chars.get(r.Context(), lexicon.Store{DB: s.db}, language)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Cache-Control", "private, max-age=0, must-revalidate")
	h.Set("Vary", "Accept-Encoding")
	h.Set("ETag", p.etag)
	if etagMatches(r.Header.Get("If-None-Match"), p.etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	body := p.raw
	if acceptsGzip(r.Header.Get("Accept-Encoding")) {
		h.Set("Content-Encoding", "gzip")
		body = p.gz
	}
	h.Set("Content-Type", "application/json")
	h.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusOK)
	w.Write(body)
}

// etagMatches reports whether an If-None-Match header value matches etag
// by weak comparison (RFC 9110 13.1.2): "*", or any listed tag whose
// opaque part equals etag's, W/ prefixes ignored.
func etagMatches(header, etag string) bool {
	want := strings.TrimPrefix(etag, "W/")
	for _, tag := range strings.Split(header, ",") {
		tag = strings.TrimSpace(tag)
		if tag == "*" || (tag != "" && strings.TrimPrefix(tag, "W/") == want) {
			return true
		}
	}
	return false
}

// acceptsGzip reports whether an Accept-Encoding header value allows
// gzip: a gzip coding (or, absent one, "*") with a non-zero q value.
func acceptsGzip(header string) bool {
	gzipQ, starQ := -1.0, -1.0
	for _, part := range strings.Split(header, ",") {
		name, params, _ := strings.Cut(part, ";")
		q := 1.0
		for _, param := range strings.Split(params, ";") {
			k, v, ok := strings.Cut(strings.TrimSpace(param), "=")
			if ok && strings.EqualFold(strings.TrimSpace(k), "q") {
				parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
				if err != nil {
					parsed = 0
				}
				q = parsed
			}
		}
		switch name = strings.TrimSpace(name); {
		case strings.EqualFold(name, "gzip"):
			gzipQ = q
		case name == "*":
			starQ = q
		}
	}
	if gzipQ >= 0 {
		return gzipQ > 0
	}
	return starQ > 0
}
