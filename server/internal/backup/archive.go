package backup

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"qinqin/internal/ai"
	"qinqin/internal/events"
	"qinqin/internal/sentences"
)

// Error codes of an invalid archive (docs/contracts/auth/errors.json).
const (
	CodeInvalid       = "backup_invalid"
	CodeTooLarge      = "backup_too_large"
	CodeVersion       = "backup_version_unsupported"
	CodeTooManyEvents = "backup_too_many_events"
	maxArrayFile      = 32 << 20
	maxEventPayload   = 64 << 10
)

// ErrVersion is returned (wrapped in *InvalidError) for a formatVersion this
// server does not read.
var ErrVersion = errors.New("backup: unsupported format version")

// InvalidError says why an archive was refused. Detail is a short English
// sentence without file contents; Code is one of the Code* constants.
type InvalidError struct {
	Code, Detail string
}

func (e *InvalidError) Error() string { return e.Code + ": " + e.Detail }

func (e *InvalidError) Is(target error) bool { return target == ErrVersion && e.Code == CodeVersion }

func invalid(format string, a ...any) error {
	return &InvalidError{Code: CodeInvalid, Detail: fmt.Sprintf(format, a...)}
}

func tooLarge(format string, a ...any) error {
	return &InvalidError{Code: CodeTooLarge, Detail: fmt.Sprintf(format, a...)}
}

// Caps as variables so tests can scale them down.
var (
	capManifest int64 = MaxManifest
	capLine           = MaxLine
	capBook     int64 = MaxJSONFile
	capArray    int64 = maxArrayFile
	capTotal    int64 = MaxTotal
	capEntries        = MaxEntries
	capEvents         = MaxEvents
)

// Archive is a validated, open personal backup. Open reads every entry once
// (hashing and parsing as it goes, bounded by the caps on the bytes actually
// read); the iterators read an entry again when the restore applies it.
type Archive struct {
	zr         *zip.ReadCloser
	files      map[string]*zip.File
	sizes      map[string]int64
	Manifest   Manifest
	Account    Account
	Workspaces []Workspace
	Books      []Book
	Entries    []EntryRef
	Dicts      []DictRef
	SentRefs   []SentenceRef
	bookFiles  map[int64]bool
	parts      map[string][]string // family -> part names in order
	// Counted during validation.
	Total int64
}

// Close releases the file.
func (a *Archive) Close() error { return a.zr.Close() }

type capReader struct {
	r     io.Reader
	n     int64
	max   int64
	total *int64
	what  string
	over  error // set once a cap is exceeded: it wins over parse errors of the cut-off data
}

func (c *capReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	if c.total != nil {
		*c.total += int64(n)
		if *c.total > capTotal {
			c.over = tooLarge("the archive expands to more than %d bytes", capTotal)
			return n, c.over
		}
	}
	if c.n > c.max {
		c.over = tooLarge("%s is larger than %d bytes", c.what, c.max)
		return n, c.over
	}
	return n, err
}

func zipErr(err error) error {
	var ie *InvalidError
	if errors.As(err, &ie) {
		return err
	}
	return invalid("the archive is damaged or truncated")
}

// Open validates the zip at path completely and returns it. Nothing is
// extracted to disk; entry names are only ever looked up, never joined into a
// path. An unreadable, hostile or too large archive is *InvalidError.
func Open(path string) (*Archive, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, invalid("this is not a readable zip archive")
	}
	a := &Archive{zr: zr, files: map[string]*zip.File{}, sizes: map[string]int64{}, bookFiles: map[int64]bool{}}
	if err := a.validate(); err != nil {
		zr.Close()
		return nil, err
	}
	return a, nil
}

func (a *Archive) validate() error {
	if len(a.zr.File) > capEntries {
		return tooLarge("the archive has more than %d entries", capEntries)
	}
	for _, f := range a.zr.File {
		if _, _, ok := KnownName(f.Name); !ok {
			return invalid("the archive holds an entry this format does not have")
		}
		if _, dup := a.files[f.Name]; dup {
			return invalid("an entry name appears twice")
		}
		if f.Flags&0x1 != 0 {
			return invalid("the archive is encrypted")
		}
		if f.Method != zip.Store && f.Method != zip.Deflate {
			return invalid("an entry uses an unsupported compression method")
		}
		a.files[f.Name] = f
	}
	mf, ok := a.files[NameManifest]
	if !ok {
		return invalid("manifest.json is missing")
	}
	raw, err := a.readAll(mf, capManifest, "manifest.json", nil)
	if err != nil {
		return err
	}
	var head struct {
		Format        string          `json:"format"`
		FormatVersion json.RawMessage `json:"formatVersion"`
	}
	if json.Unmarshal(raw, &head) != nil || head.Format != FormatName {
		return invalid("this is not a qinqin personal backup")
	}
	if string(bytes.TrimSpace(head.FormatVersion)) != strconv.Itoa(FormatVersion) {
		return &InvalidError{Code: CodeVersion, Detail: "this backup has a format version this server cannot read"}
	}
	if err := decodeStrict(raw, &a.Manifest); err != nil {
		return invalid("manifest.json is malformed")
	}
	listed := map[string]FileEntry{}
	for _, fe := range a.Manifest.Files {
		if _, dup := listed[fe.Name]; dup || fe.Name == NameManifest {
			return invalid("the manifest lists an entry twice")
		}
		if _, present := a.files[fe.Name]; !present {
			return invalid("the manifest lists an entry the archive does not hold")
		}
		listed[fe.Name] = fe
	}
	for name := range a.files {
		if _, ok := listed[name]; !ok && name != NameManifest {
			return invalid("an archive entry is not listed in the manifest")
		}
	}
	if a.Manifest.Counts["events"] > capEvents {
		return &InvalidError{Code: CodeTooManyEvents, Detail: fmt.Sprintf("the backup holds more than %d study events", capEvents)}
	}
	var total int64
	hashed := func(name string) (*hashingReader, error) {
		f := a.files[name]
		rc, err := f.Open()
		if err != nil {
			return nil, zipErr(err)
		}
		return &hashingReader{rc: rc, h: sha256.New(), c: &capReader{r: nil, max: perEntryCap(name), total: &total, what: name}}, nil
	}
	finish := func(name string, hr *hashingReader) error {
		hr.rc.Close()
		fe := listed[name]
		if hr.c.n != fe.Bytes || hex.EncodeToString(hr.h.Sum(nil)) != fe.SHA256 {
			return invalid("an entry does not match the manifest checksum")
		}
		a.sizes[name] = hr.c.n
		return nil
	}
	// A reader for a validated entry: caps first, hash on the side.
	read := func(name string, fn func(io.Reader) error) error {
		if _, present := a.files[name]; !present {
			return nil
		}
		hr, err := hashed(name)
		if err != nil {
			return err
		}
		hr.c.r = hr.rc
		if err := fn(io.TeeReader(hr.c, hr.h)); err != nil {
			hr.rc.Close()
			if hr.c.over != nil {
				err = hr.c.over
			}
			return zipErr(err)
		}
		// drain what the parser left (e.g. a trailing newline) so the hash covers every byte
		if _, err := io.Copy(io.Discard, io.TeeReader(hr.c, hr.h)); err != nil {
			hr.rc.Close()
			return zipErr(err)
		}
		return finish(name, hr)
	}
	jsonArray := func(name string, v any) error {
		if _, present := a.files[name]; !present {
			return invalid("%s is missing", name)
		}
		return read(name, func(r io.Reader) error {
			dec := json.NewDecoder(r)
			dec.DisallowUnknownFields()
			if err := dec.Decode(v); err != nil {
				var ie *InvalidError
				if errors.As(err, &ie) {
					return err
				}
				return invalid("%s is malformed", name)
			}
			if _, err := dec.Token(); err != io.EOF {
				return invalid("%s has trailing data", name)
			}
			return nil
		})
	}
	if err := jsonArray(NameAccount, &a.Account); err != nil {
		return err
	}
	if err := a.checkAccount(); err != nil {
		return err
	}
	if err := jsonArray(NameWorkspaces, &a.Workspaces); err != nil {
		return err
	}
	wsIDs, err := a.checkWorkspaces()
	if err != nil {
		return err
	}
	if err := jsonArray(NameBooks, &a.Books); err != nil {
		return err
	}
	bookIDs, err := a.checkBooks(wsIDs)
	if err != nil {
		return err
	}
	if err := jsonArray(NameRefEntries, &a.Entries); err != nil {
		return err
	}
	if err := jsonArray(NameRefDicts, &a.Dicts); err != nil {
		return err
	}
	if err := jsonArray(NameRefSentences, &a.SentRefs); err != nil {
		return err
	}
	if err := a.checkRefs(); err != nil {
		return err
	}
	counts := map[string]int{"workspaces": len(a.Workspaces), "books": len(a.Books)}
	// events (sorted names: the iteration order is the name order)
	a.parts = map[string][]string{}
	for name := range a.files {
		if k, _, _ := KnownName(name); k == KindPart {
			fam := FamilyOf(name)
			a.parts[fam] = append(a.parts[fam], name)
		}
	}
	for _, names := range a.parts {
		sort.Strings(names)
	}
	evCount := 0
	for _, name := range a.parts[FamEvents] {
		n := 0
		err := read(name, func(r io.Reader) error {
			return scanLines(r, name, func(b []byte) error {
				var e Event
				if err := decodeStrict(b, &e); err != nil {
					return invalid("%s holds a malformed line", name)
				}
				n++
				if evCount+n > capEvents {
					return &InvalidError{Code: CodeTooManyEvents, Detail: fmt.Sprintf("the backup holds more than %d study events", capEvents)}
				}
				return checkEvent(e, wsIDs)
			})
		})
		if err != nil {
			return err
		}
		if n > EventsPerFile {
			return invalid("%s holds too many events", name)
		}
		evCount += n
	}
	counts["events"] = evCount
	seenRows := map[string]struct{}{}
	n, err := a.countLines(read, NameRows, func(b []byte) error {
		var r Row
		if err := decodeStrict(b, &r); err != nil {
			return invalid("%s holds a malformed line", NameRows)
		}
		return checkRow(r, wsIDs, seenRows)
	})
	if err != nil {
		return err
	}
	counts["rows"] = n
	seenEdit := map[int64]struct{}{}
	if counts["overlays"], err = a.countLines(read, NameOverlays, func(b []byte) error {
		var o Overlay
		if err := decodeStrict(b, &o); err != nil || o.EntryID <= 0 {
			return invalid("%s holds a malformed line", NameOverlays)
		}
		if _, dup := seenEdit[o.EntryID]; dup {
			return invalid("%s names an entry twice", NameOverlays)
		}
		seenEdit[o.EntryID] = struct{}{}
		return nil
	}); err != nil {
		return err
	}
	seenSent := map[int64]struct{}{}
	aiPerEntry := map[int64]int{}
	if counts["sentences"], err = a.countLines(read, NameSentences, func(b []byte) error {
		var s OwnSentence
		if !ownSentenceLineOK(b) || decodeStrict(b, &s) != nil {
			return invalid("%s holds a malformed line", NameSentences)
		}
		if _, dup := seenSent[s.ID]; dup {
			return invalid("%s names a sentence twice", NameSentences)
		}
		seenSent[s.ID] = struct{}{}
		if s.AI != nil {
			if aiPerEntry[s.EntryID]++; aiPerEntry[s.EntryID] > sentences.MaxKeptPerEntry {
				return invalid("%s holds more than %d AI examples of one entry", NameSentences, sentences.MaxKeptPerEntry)
			}
		}
		return nil
	}); err != nil {
		return err
	}
	seenMark := map[string]struct{}{}
	if counts["bookmarks"], err = a.countLines(read, NameBookmarks, func(b []byte) error {
		var m Bookmark
		if err := decodeStrict(b, &m); err != nil || !bookIDs[m.BookID] || m.Position == "" || len(m.Position) > 64 || len(m.Label) > 1024 {
			return invalid("%s holds a malformed line", NameBookmarks)
		}
		k := strconv.FormatInt(m.BookID, 10) + "|" + m.Position
		if _, dup := seenMark[k]; dup {
			return invalid("%s holds a bookmark twice", NameBookmarks)
		}
		seenMark[k] = struct{}{}
		return nil
	}); err != nil {
		return err
	}
	if counts["highlights"], err = a.countLines(read, NameHighlights, func(b []byte) error {
		var h Highlight
		if err := decodeStrict(b, &h); err != nil || !bookIDs[h.BookID] || h.Chapter < 0 || h.Paragraph < 0 ||
			h.StartCP < 0 || h.EndCP < h.StartCP || len(h.Text) > 65536 || len(h.Note) > 65536 || len(h.Color) > 32 {
			return invalid("%s holds a malformed line", NameHighlights)
		}
		return nil
	}); err != nil {
		return err
	}
	// book content: only for books listed in books.json, syntax-checked as a stream
	for name := range a.files {
		kind, id, _ := KnownName(name)
		if kind != KindBook {
			continue
		}
		if !bookIDs[id] {
			return invalid("a book file belongs to no book of the archive")
		}
		if err := read(name, func(r io.Reader) error { return checkJSONArrayStream(r, name) }); err != nil {
			return err
		}
		a.bookFiles[id] = true
	}
	// counts of the manifest must equal what was read
	for k, v := range counts {
		if a.Manifest.Counts[k] != v {
			return invalid("the manifest count of %s does not match the archive", k)
		}
	}
	for k := range a.Manifest.Counts {
		if _, ok := counts[k]; !ok {
			return invalid("the manifest has a count this format does not have")
		}
	}
	a.Total = total
	return nil
}

func perEntryCap(name string) int64 {
	kind, _, _ := KnownName(name)
	switch {
	case kind == KindBook:
		return capBook
	case strings.HasSuffix(name, ".json"):
		return capArray
	default:
		return capBook // JSONL files: bounded by the total, lines by capLine
	}
}

type hashingReader struct {
	rc io.ReadCloser
	h  interface {
		io.Writer
		Sum([]byte) []byte
	}
	c *capReader
}

// readAll reads one small entry fully under a cap.
func (a *Archive) readAll(f *zip.File, max int64, what string, total *int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, zipErr(err)
	}
	defer rc.Close()
	b, err := io.ReadAll(&capReader{r: rc, max: max, total: total, what: what})
	if err != nil {
		return nil, zipErr(err)
	}
	// manifest.json is verified by name only (it is the root of trust for the rest)
	return b, nil
}

// countLines runs fn over every line of every part of a family.
func (a *Archive) countLines(read func(string, func(io.Reader) error) error, family string, fn func([]byte) error) (int, error) {
	n := 0
	for _, name := range a.parts[family] {
		c := 0
		err := read(name, func(r io.Reader) error {
			return scanLines(r, name, func(b []byte) error { n++; c++; return fn(b) })
		})
		if err != nil {
			return n, err
		}
		if c > EventsPerFile {
			return n, invalid("%s holds too many lines", name)
		}
	}
	return n, nil
}

func scanLines(r io.Reader, name string, fn func([]byte) error) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, min(64<<10, capLine)), capLine)
	for sc.Scan() {
		if len(bytes.TrimSpace(sc.Bytes())) == 0 {
			return invalid("%s holds an empty line", name)
		}
		if err := fn(sc.Bytes()); err != nil {
			return err
		}
	}
	if err := sc.Err(); err != nil {
		if errors.Is(err, bufio.ErrTooLong) {
			return tooLarge("%s holds a line longer than %d bytes", name, capLine)
		}
		return err
	}
	return nil
}

// decodeStrict decodes exactly one JSON value, refusing unknown fields and
// trailing data.
func decodeStrict(b []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if _, err := dec.Token(); err != io.EOF {
		return errors.New("trailing data")
	}
	return nil
}

// checkJSONArrayStream verifies that r is one JSON array, token by token
// (memory O(depth), whatever the size).
func checkJSONArrayStream(r io.Reader, name string) error {
	dec := json.NewDecoder(r)
	t, err := dec.Token()
	if d, ok := t.(json.Delim); err != nil || !ok || d != '[' {
		var ie *InvalidError
		if errors.As(err, &ie) {
			return err
		}
		return invalid("%s is not a JSON array", name)
	}
	depth := 1
	for depth > 0 {
		t, err := dec.Token()
		if err != nil {
			var ie *InvalidError
			if errors.As(err, &ie) {
				return err
			}
			return invalid("%s is not valid JSON", name)
		}
		if d, ok := t.(json.Delim); ok {
			if d == '[' || d == '{' {
				depth++
			} else {
				depth--
			}
		}
	}
	if _, err := dec.Token(); err != io.EOF {
		return invalid("%s has trailing data", name)
	}
	return nil
}

func okText(s string, max int) bool {
	return len(s) <= max && utf8.ValidString(s) && !strings.ContainsRune(s, 0)
}

func (a *Archive) checkAccount() error {
	if !okText(a.Account.Username, 200) || len(a.Account.TimeZones) > 200 || len(a.Account.Features) > 1000 {
		return invalid("account.json is malformed")
	}
	for _, tz := range a.Account.TimeZones {
		if _, err := time.LoadLocation(tz.Zone); err != nil || tz.Zone == "" || tz.Zone == "Local" {
			return invalid("account.json names an unknown time zone")
		}
		if tz.From != nil {
			if _, err := time.Parse(time.RFC3339, *tz.From); err != nil {
				return invalid("account.json has a bad time zone date")
			}
		}
	}
	seen := map[string]bool{}
	for _, f := range a.Account.Features {
		if f.ID == "" || !okText(f.ID, 128) || seen[f.ID] {
			return invalid("account.json has a bad feature switch")
		}
		seen[f.ID] = true
	}
	return nil
}

func (a *Archive) checkWorkspaces() (map[int64]bool, error) {
	ids := map[int64]bool{}
	names := map[string]bool{}
	for _, w := range a.Workspaces {
		key := w.Language + "\x00" + w.Name
		if w.ID <= 0 || ids[w.ID] || names[key] || w.Language == "" || !okText(w.Language, 32) || !okText(w.Name, 200) {
			return nil, invalid("workspaces.json is malformed")
		}
		var obj map[string]json.RawMessage
		if len(w.Settings) == 0 || len(w.Settings) > 64<<10 || json.Unmarshal(w.Settings, &obj) != nil || obj == nil {
			return nil, invalid("workspaces.json holds unreadable settings")
		}
		ids[w.ID], names[key] = true, true
	}
	return ids, nil
}

func (a *Archive) checkBooks(ws map[int64]bool) (map[int64]bool, error) {
	ids := map[int64]bool{}
	src := map[string]bool{}
	for _, b := range a.Books {
		k := strconv.FormatInt(b.WorkspaceID, 10) + "|" + b.Source + "|" + b.SourceID
		if b.ID <= 0 || ids[b.ID] || !ws[b.WorkspaceID] || b.Title == "" || !okText(b.Title, 1024) || !okText(b.Author, 1024) ||
			!okText(b.Source, 256) || !okText(b.SourceID, 512) || !okText(b.SourceURL, 2048) || !okText(b.Attribution, 4096) ||
			!okText(b.LicenseNote, 4096) || !okText(b.Position, 64) || !okText(b.Language, 32) || b.ChapterCount < 0 {
			return nil, invalid("library/books.json is malformed")
		}
		if b.SourceID != "" {
			if src[k] {
				return nil, invalid("library/books.json holds a book twice")
			}
			src[k] = true
		}
		ids[b.ID] = true
	}
	return ids, nil
}

func (a *Archive) checkRefs() error {
	seen := map[int64]bool{}
	for _, e := range a.Entries {
		if e.ID <= 0 || seen[e.ID] || !okText(e.Language, 32) || !okText(e.Kind, 32) || !okText(e.ExtKey, 512) || !okText(e.Written, 1024) {
			return invalid("refs/entries.json is malformed")
		}
		seen[e.ID] = true
	}
	seen = map[int64]bool{}
	for _, d := range a.Dicts {
		if d.ID <= 0 || seen[d.ID] || !okText(d.PackID, 256) {
			return invalid("refs/dictionaries.json is malformed")
		}
		seen[d.ID] = true
	}
	seen = map[int64]bool{}
	for _, s := range a.SentRefs {
		if s.ID <= 0 || seen[s.ID] || s.EntryID <= 0 || !okText(s.SourcePack, 256) || !okText(s.Hanzi, 4096) {
			return invalid("refs/sentences.json is malformed")
		}
		seen[s.ID] = true
	}
	return nil
}

func checkEvent(e Event, ws map[int64]bool) error {
	if !events.ValidID(e.ID) || !ws[e.WorkspaceID] || e.Type == "" || !okText(e.Type, 64) || !okText(e.Device, 256) ||
		len(e.Payload) == 0 || len(e.Payload) > maxEventPayload || !json.Valid(e.Payload) {
		return invalid("an event is malformed")
	}
	if _, err := time.Parse(time.RFC3339, e.TS); err != nil {
		return invalid("an event has a bad timestamp")
	}
	if e.UpdatedAt == "" || len(e.UpdatedAt) > 64 {
		return invalid("an event has a bad update time")
	}
	return nil
}

func checkRow(r Row, ws map[int64]bool, seen map[string]struct{}) error {
	if r.Key == "" || !okText(r.Key, 512) || r.Version < 0 ||
		len(r.Data) == 0 || !json.Valid(r.Data) || r.UpdatedAt == "" || len(r.UpdatedAt) > 64 {
		return invalid("a row is malformed")
	}
	if len(r.Data) > MaxRowValue {
		return tooLarge("a row value is larger than %d bytes", MaxRowValue)
	}
	var wsKey int64
	if r.WorkspaceID != nil {
		if !ws[*r.WorkspaceID] {
			return invalid("a row names an unknown workspace")
		}
		wsKey = *r.WorkspaceID
	}
	k := strconv.FormatInt(wsKey, 10) + "\x00" + r.Key
	if _, dup := seen[k]; dup {
		return invalid("rows holds a row twice")
	}
	seen[k] = struct{}{}
	return nil
}

// each streams one JSONL entry through fn (a validated archive; the entry is
// read again and bounded by the size the manifest recorded).
func each[T any](a *Archive, name string, fn func(T) error) error {
	f, ok := a.files[name]
	if !ok {
		return nil
	}
	rc, err := f.Open()
	if err != nil {
		return zipErr(err)
	}
	defer rc.Close()
	cr := &capReader{r: rc, max: a.sizes[name], what: name}
	err = scanLines(cr, name, func(b []byte) error {
		var v T
		if err := decodeStrict(b, &v); err != nil {
			return invalid("%s holds a malformed line", name)
		}
		return fn(v)
	})
	if err != nil && cr.over != nil {
		return cr.over
	}
	return err
}

// eachFamily streams every line of every part of a family, in part order.
func eachFamily[T any](a *Archive, family string, fn func(T) error) error {
	for _, name := range a.parts[family] {
		if err := each(a, name, fn); err != nil {
			return err
		}
	}
	return nil
}

// Events streams every event, files in name order.
func (a *Archive) Events(fn func(Event) error) error { return eachFamily(a, FamEvents, fn) }

// Rows streams the rows family.
func (a *Archive) Rows(fn func(Row) error) error {
	return eachFamily(a, NameRows, fn)
}

// Overlays streams overlays.jsonl.
func (a *Archive) Overlays(fn func(Overlay) error) error { return eachFamily(a, NameOverlays, fn) }

// ownSentenceLineOK is the live rule of an own sentences line: an id, an
// entry and a text within the caps, and a well-formed AI mark when there is
// one (#186).
func ownSentenceLineOK(b []byte) bool {
	var s OwnSentence
	if err := decodeStrict(b, &s); err != nil || s.ID <= 0 || s.EntryID <= 0 || s.Hanzi == "" || len(s.Hanzi) > 4096 ||
		len(s.Pinyin) > 4096 || len(s.Translation) > 8192 {
		return false
	}
	if s.AI == nil {
		return true
	}
	// A kept AI example: the live rules of the examples (#186, docs/contracts/examples/).
	return s.AI.Provider != "" && s.AI.Model != "" && len(s.AI.Provider) <= 64 && len(s.AI.Model) <= 200 && ai.ValidLevel(s.AI.Level) &&
		strings.TrimSpace(s.Translation) != "" &&
		utf8.RuneCountInString(s.Hanzi) <= sentences.MaxExampleTextRunes &&
		utf8.RuneCountInString(s.Translation) <= sentences.MaxExampleTranslationRunes &&
		utf8.RuneCountInString(s.Pinyin) <= sentences.MaxExampleReadingRunes
}

// OwnSentences streams sentences.jsonl.
func (a *Archive) OwnSentences(fn func(OwnSentence) error) error {
	return eachFamily(a, NameSentences, fn)
}

// Bookmarks streams library/bookmarks.jsonl.
func (a *Archive) Bookmarks(fn func(Bookmark) error) error { return eachFamily(a, NameBookmarks, fn) }

// Highlights streams library/highlights.jsonl.
func (a *Archive) Highlights(fn func(Highlight) error) error {
	return eachFamily(a, NameHighlights, fn)
}

// HasBookFile says whether the archive carries the content of book id.
func (a *Archive) HasBookFile(id int64) bool { return a.bookFiles[id] }

// OpenBook opens the content of a book listed in books.json, bounded by the
// size recorded at validation.
func (a *Archive) OpenBook(id int64) (io.ReadCloser, error) {
	name := BookName(id)
	f, ok := a.files[name]
	if !ok || !a.bookFiles[id] {
		return nil, fmt.Errorf("backup: no content for book %d", id)
	}
	rc, err := f.Open()
	if err != nil {
		return nil, zipErr(err)
	}
	return struct {
		io.Reader
		io.Closer
	}{&capReader{r: rc, max: a.sizes[name], what: name}, rc}, nil
}
