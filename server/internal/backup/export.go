package backup

import (
	"archive/zip"
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Meta is what the manifest records about the producing server.
type Meta struct {
	AppVersion    string
	SchemaVersion string
	Now           time.Time
}

// eventsPerFile is EventsPerFile; tests lower it.
var eventsPerFile = EventsPerFile

// SchemaVersion reads the newest applied migration.
func SchemaVersion(ctx context.Context, db *sql.DB) string {
	var v sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT MAX(version) FROM schema_migrations`).Scan(&v); err != nil || !v.Valid {
		return ""
	}
	return v.String
}

type countingHash struct {
	h io.Writer
	n int64
}

func (c *countingHash) Write(p []byte) (int, error) { c.n += int64(len(p)); return c.h.Write(p) }

// archiveWriter adds entries to a zip while hashing and counting them.
type archiveWriter struct {
	z     *zip.Writer
	now   time.Time
	files []FileEntry
}

type openEntry struct {
	a    *archiveWriter
	name string
	hash interface {
		io.Writer
		Sum([]byte) []byte
	}
	cnt *countingHash
	bw  *bufio.Writer
	enc *json.Encoder
}

func (a *archiveWriter) begin(name string) (*openEntry, error) {
	fw, err := a.z.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: a.now})
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	cnt := &countingHash{h: io.MultiWriter(fw, h)}
	bw := bufio.NewWriterSize(cnt, 64<<10)
	enc := json.NewEncoder(bw)
	enc.SetEscapeHTML(false)
	return &openEntry{a: a, name: name, hash: h, cnt: cnt, bw: bw, enc: enc}, nil
}

func (o *openEntry) finish() error {
	if err := o.bw.Flush(); err != nil {
		return err
	}
	o.a.files = append(o.a.files, FileEntry{Name: o.name, Bytes: o.cnt.n, SHA256: hex.EncodeToString(o.hash.Sum(nil))})
	return nil
}

// jsonFile writes v as one pretty-free JSON document.
func (a *archiveWriter) jsonFile(name string, v any) error {
	o, err := a.begin(name)
	if err != nil {
		return err
	}
	if err := o.enc.Encode(v); err != nil {
		return err
	}
	return o.finish()
}

type refSet struct {
	entries   map[int64]struct{}
	sentences map[int64]struct{}
	dicts     map[int64]struct{}
}

func newRefs() *refSet {
	return &refSet{entries: map[int64]struct{}{}, sentences: map[int64]struct{}{}, dicts: map[int64]struct{}{}}
}

// noteCardID records the entry a derived card id (c-<kind>-<n>) names.
func (r *refSet) noteCardID(id string) {
	if _, n, ok := ParseDerivedCardID(id); ok {
		r.entries[n] = struct{}{}
	}
}

// WriteUser streams the user's personal data as a format-v1 zip into w.
// It reads from ONE read transaction (a WAL snapshot: events and cards
// agree), row by row, so memory is O(references), not O(events). A slow
// client holds the snapshot, and with it the WAL checkpoint, for the
// download's duration. Tables whose registry decision is not ExportRows
// are never read.
func WriteUser(ctx context.Context, db *sql.DB, dataDir string, userID int64, w io.Writer, meta Meta) (Manifest, error) {
	var man Manifest
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return man, fmt.Errorf("backup: begin: %w", err)
	}
	defer tx.Rollback()
	var username string
	if err := tx.QueryRowContext(ctx, `SELECT username FROM users WHERE id = ?`, userID).Scan(&username); err != nil {
		return man, fmt.Errorf("backup: read user: %w", err)
	}
	a := &archiveWriter{z: zip.NewWriter(w), now: meta.Now.UTC()}
	refs := newRefs()
	counts := map[string]int{}

	// account.json
	acc := Account{Username: username, TimeZones: []TimeZone{}, PluginStates: []PluginState{}}
	rows, err := tx.QueryContext(ctx, `SELECT zone, effective_from, created_at FROM user_time_zones WHERE user_id = ? ORDER BY seq`, userID)
	if err != nil {
		return man, fmt.Errorf("backup: time zones: %w", err)
	}
	for rows.Next() {
		var tz TimeZone
		if err := rows.Scan(&tz.Zone, &tz.From, &tz.CreatedAt); err != nil {
			rows.Close()
			return man, err
		}
		acc.TimeZones = append(acc.TimeZones, tz)
	}
	if err := closeRows(rows); err != nil {
		return man, err
	}
	rows, err = tx.QueryContext(ctx, `SELECT pack_id, enabled, ord FROM plugin_states WHERE user_id = ? ORDER BY pack_id`, userID)
	if err != nil {
		return man, fmt.Errorf("backup: plugin states: %w", err)
	}
	for rows.Next() {
		var ps PluginState
		var en int
		if err := rows.Scan(&ps.PluginID, &en, &ps.Order); err != nil {
			rows.Close()
			return man, err
		}
		ps.Enabled = en != 0
		acc.PluginStates = append(acc.PluginStates, ps)
	}
	if err := closeRows(rows); err != nil {
		return man, err
	}
	if err := a.jsonFile(NameAccount, acc); err != nil {
		return man, err
	}

	// workspaces.json
	wsList := []Workspace{}
	rows, err = tx.QueryContext(ctx, `SELECT id, language, name, settings, updated_at FROM workspaces WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return man, fmt.Errorf("backup: workspaces: %w", err)
	}
	for rows.Next() {
		var ws Workspace
		var settings string
		if err := rows.Scan(&ws.ID, &ws.Language, &ws.Name, &settings, &ws.UpdatedAt); err != nil {
			rows.Close()
			return man, err
		}
		if !json.Valid([]byte(settings)) {
			rows.Close()
			return man, fmt.Errorf("backup: workspace %d has unreadable settings", ws.ID)
		}
		ws.Settings = json.RawMessage(settings)
		for _, id := range hiddenDictionaryIDs(ws.Settings) {
			refs.dicts[id] = struct{}{}
		}
		wsList = append(wsList, ws)
	}
	if err := closeRows(rows); err != nil {
		return man, err
	}
	counts["workspaces"] = len(wsList)
	if err := a.jsonFile(NameWorkspaces, wsList); err != nil {
		return man, err
	}

	// events
	if counts["events"], err = writeEvents(ctx, tx, a, userID, refs); err != nil {
		return man, err
	}
	// plugin data (all live rows, user-global ones included)
	if counts["pluginData"], err = writePluginData(ctx, tx, a, userID, refs); err != nil {
		return man, err
	}
	// overlays
	if counts["overlays"], err = writeLines(ctx, tx, a, NameOverlays,
		`SELECT entry_id, written, readings, updated_at FROM user_edits WHERE user_id = ? ORDER BY entry_id`, []any{userID},
		func(rs *sql.Rows) (any, error) {
			var o Overlay
			if err := rs.Scan(&o.EntryID, &o.Written, &o.Readings, &o.UpdatedAt); err != nil {
				return nil, err
			}
			refs.entries[o.EntryID] = struct{}{}
			return o, nil
		}); err != nil {
		return man, err
	}
	// own sentences (pack sentences are content, not user data)
	if counts["sentences"], err = writeLines(ctx, tx, a, NameSentences,
		`SELECT id, entry_id, hanzi, pinyin, translation, updated_at FROM sentences WHERE user_id = ? AND deleted_at IS NULL ORDER BY id`, []any{userID},
		func(rs *sql.Rows) (any, error) {
			var s OwnSentence
			if err := rs.Scan(&s.ID, &s.EntryID, &s.Hanzi, &s.Pinyin, &s.Translation, &s.UpdatedAt); err != nil {
				return nil, err
			}
			refs.entries[s.EntryID] = struct{}{}
			return s, nil
		}); err != nil {
		return man, err
	}
	// library
	bookIDs, err := writeBooks(ctx, tx, a, dataDir, userID)
	if err != nil {
		return man, err
	}
	counts["books"] = len(bookIDs)
	if counts["bookmarks"], err = writeLines(ctx, tx, a, NameBookmarks,
		`SELECT id, book_id, position, label, created_at FROM library_bookmarks WHERE user_id = ? ORDER BY id`, []any{userID},
		func(rs *sql.Rows) (any, error) {
			var b Bookmark
			err := rs.Scan(&b.ID, &b.BookID, &b.Position, &b.Label, &b.CreatedAt)
			return b, err
		}); err != nil {
		return man, err
	}
	if counts["highlights"], err = writeLines(ctx, tx, a, NameHighlights,
		`SELECT id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at
		 FROM library_highlights WHERE user_id = ? ORDER BY id`, []any{userID},
		func(rs *sql.Rows) (any, error) {
			var h Highlight
			err := rs.Scan(&h.ID, &h.BookID, &h.Chapter, &h.Paragraph, &h.StartCP, &h.EndCP, &h.Text, &h.Color, &h.Note, &h.CreatedAt, &h.UpdatedAt)
			return h, err
		}); err != nil {
		return man, err
	}
	// refs (collected while streaming)
	if err := writeRefs(ctx, tx, a, refs, userID); err != nil {
		return man, err
	}

	man = Manifest{Format: FormatName, FormatVersion: FormatVersion, AppVersion: meta.AppVersion, SchemaVersion: meta.SchemaVersion,
		CreatedAt: meta.Now.UTC().Format(time.RFC3339), User: ManifestUser{ID: userID, Username: username},
		Counts: counts, Files: a.files}
	if err := tx.Commit(); err != nil {
		return man, err
	}
	fw, err := a.z.CreateHeader(&zip.FileHeader{Name: NameManifest, Method: zip.Deflate, Modified: a.now})
	if err != nil {
		return man, err
	}
	enc := json.NewEncoder(fw)
	enc.SetIndent("", " ")
	if err := enc.Encode(man); err != nil {
		return man, err
	}
	if err := a.z.Close(); err != nil {
		return man, err
	}
	return man, nil
}

func closeRows(rs *sql.Rows) error {
	if err := rs.Err(); err != nil {
		rs.Close()
		return err
	}
	return rs.Close()
}

// writeLines streams a query as JSON Lines into one entry and returns the
// number of lines. The entry exists (empty) even when there are no rows.
func writeLines(ctx context.Context, tx *sql.Tx, a *archiveWriter, name, query string, args []any, scan func(*sql.Rows) (any, error)) (int, error) {
	o, err := a.begin(name)
	if err != nil {
		return 0, err
	}
	rs, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("backup: %s: %w", name, err)
	}
	n := 0
	for rs.Next() {
		v, err := scan(rs)
		if err != nil {
			rs.Close()
			return 0, fmt.Errorf("backup: %s: %w", name, err)
		}
		if err := o.enc.Encode(v); err != nil {
			rs.Close()
			return 0, err
		}
		n++
	}
	if err := closeRows(rs); err != nil {
		return 0, err
	}
	return n, o.finish()
}

func writeEvents(ctx context.Context, tx *sql.Tx, a *archiveWriter, userID int64, refs *refSet) (int, error) {
	rs, err := tx.QueryContext(ctx, `SELECT id, workspace_id, device, ts, type, payload, updated_at FROM study_events WHERE user_id = ? ORDER BY ts, id`, userID)
	if err != nil {
		return 0, fmt.Errorf("backup: events: %w", err)
	}
	defer rs.Close()
	var cur *openEntry
	file, inFile, total := 0, 0, 0
	for rs.Next() {
		var e Event
		var payload string
		if err := rs.Scan(&e.ID, &e.WorkspaceID, &e.Device, &e.TS, &e.Type, &payload, &e.UpdatedAt); err != nil {
			return 0, err
		}
		if !json.Valid([]byte(payload)) {
			return 0, fmt.Errorf("backup: event %s has an unreadable payload", e.ID)
		}
		e.Payload = json.RawMessage(payload)
		switch e.Type {
		case "review":
			var p struct {
				CardID string `json:"cardId"`
			}
			if json.Unmarshal(e.Payload, &p) == nil {
				refs.noteCardID(p.CardID)
			}
		case "view":
			var p struct {
				EntryID int64 `json:"entryId"`
			}
			if json.Unmarshal(e.Payload, &p) == nil && p.EntryID > 0 {
				refs.entries[p.EntryID] = struct{}{}
			}
		}
		if cur == nil || inFile >= eventsPerFile {
			if cur != nil {
				if err := cur.finish(); err != nil {
					return 0, err
				}
			}
			file++
			inFile = 0
			if cur, err = a.begin(EventsName(file)); err != nil {
				return 0, err
			}
		}
		if err := cur.enc.Encode(e); err != nil {
			return 0, err
		}
		inFile++
		total++
	}
	if err := rs.Err(); err != nil {
		return 0, err
	}
	if cur != nil {
		if err := cur.finish(); err != nil {
			return 0, err
		}
	}
	return total, nil
}

func writePluginData(ctx context.Context, tx *sql.Tx, a *archiveWriter, userID int64, refs *refSet) (int, error) {
	return writeLines(ctx, tx, a, NamePluginData,
		`SELECT pack_id, workspace_id, key, data, version, updated_at, modified_at FROM plugin_data
		 WHERE user_id = ? AND deleted_at IS NULL ORDER BY pack_id, IFNULL(workspace_id, 0), key`, []any{userID},
		func(rs *sql.Rows) (any, error) {
			var r PluginRow
			var data string
			if err := rs.Scan(&r.PluginID, &r.WorkspaceID, &r.Key, &data, &r.Version, &r.UpdatedAt, &r.ModifiedAt); err != nil {
				return nil, err
			}
			if !json.Valid([]byte(data)) {
				return nil, fmt.Errorf("row %s/%s holds unreadable JSON", r.PluginID, r.Key)
			}
			r.Data = json.RawMessage(data)
			if r.PluginID == FlashcardsPlugin && strings.HasPrefix(r.Key, "card:") {
				noteCard(refs, r.Key, r.Data)
			}
			return r, nil
		})
}

// noteCard records the entry and sentence a card row points at.
func noteCard(refs *refSet, key string, data json.RawMessage) {
	refs.noteCardID(strings.TrimPrefix(key, "card:"))
	var c struct {
		EntryID    int64 `json:"entryId"`
		SentenceID int64 `json:"sentenceId"`
	}
	if json.Unmarshal(data, &c) != nil {
		return
	}
	if c.EntryID > 0 {
		refs.entries[c.EntryID] = struct{}{}
	}
	if c.SentenceID > 0 {
		refs.sentences[c.SentenceID] = struct{}{}
	}
}

// writeBooks writes library/books.json and every book's content file
// (copied byte for byte), and returns the book ids.
func writeBooks(ctx context.Context, tx *sql.Tx, a *archiveWriter, dataDir string, userID int64) ([]int64, error) {
	books := []Book{}
	rs, err := tx.QueryContext(ctx, `SELECT id, workspace_id, language, title, author, source, source_id, source_url,
		attribution, license_note, chapter_count, position, created_at FROM library_books WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, fmt.Errorf("backup: books: %w", err)
	}
	for rs.Next() {
		var b Book
		if err := rs.Scan(&b.ID, &b.WorkspaceID, &b.Language, &b.Title, &b.Author, &b.Source, &b.SourceID, &b.SourceURL,
			&b.Attribution, &b.LicenseNote, &b.ChapterCount, &b.Position, &b.CreatedAt); err != nil {
			rs.Close()
			return nil, err
		}
		books = append(books, b)
	}
	if err := closeRows(rs); err != nil {
		return nil, err
	}
	if err := a.jsonFile(NameBooks, books); err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(books))
	for _, b := range books {
		ids = append(ids, b.ID)
		// Only integer ids build the path.
		f, err := os.Open(filepath.Join(dataDir, "books", strconv.FormatInt(userID, 10), strconv.FormatInt(b.ID, 10)+".json"))
		if errors.Is(err, os.ErrNotExist) {
			continue // the text is gone on the source too; the metadata still travels
		}
		if err != nil {
			return nil, fmt.Errorf("backup: book %d: %w", b.ID, err)
		}
		o, err := a.begin(BookName(b.ID))
		if err != nil {
			f.Close()
			return nil, err
		}
		_, cerr := io.Copy(o.bw, f)
		f.Close()
		if cerr != nil {
			return nil, fmt.Errorf("backup: book %d: %w", b.ID, cerr)
		}
		if err := o.finish(); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

func writeRefs(ctx context.Context, tx *sql.Tx, a *archiveWriter, refs *refSet, userID int64) error {
	ents := []EntryRef{}
	for _, id := range sortedIDs(refs.entries) {
		var e EntryRef
		e.ID = id
		err := tx.QueryRowContext(ctx, `SELECT language, kind, ext_key FROM entries WHERE id = ?`, id).Scan(&e.Language, &e.Kind, &e.ExtKey)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("backup: entry ref %d: %w", id, err)
		}
		err = tx.QueryRowContext(ctx, `SELECT text FROM forms WHERE entry_id = ? AND deleted_at IS NULL ORDER BY ord LIMIT 1`, id).Scan(&e.Written)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("backup: entry ref %d: %w", id, err)
		}
		ents = append(ents, e)
	}
	if err := a.jsonFile(NameRefEntries, ents); err != nil {
		return err
	}
	dicts := []DictRef{}
	for _, id := range sortedIDs(refs.dicts) {
		var d DictRef
		d.ID = id
		err := tx.QueryRowContext(ctx, `SELECT pack_id FROM dictionaries WHERE id = ?`, id).Scan(&d.PackID)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		dicts = append(dicts, d)
	}
	if err := a.jsonFile(NameRefDicts, dicts); err != nil {
		return err
	}
	sents := []SentenceRef{}
	for _, id := range sortedIDs(refs.sentences) {
		var s SentenceRef
		var owner sql.NullInt64
		s.ID = id
		err := tx.QueryRowContext(ctx, `SELECT entry_id, source_pack, user_id, hanzi FROM sentences WHERE id = ?`, id).
			Scan(&s.EntryID, &s.SourcePack, &owner, &s.Hanzi)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		s.Own = owner.Valid && owner.Int64 == userID
		if s.Own {
			s.SourcePack = ""
		} else if owner.Valid {
			continue // another user's sentence: never leaves the server in this archive
		}
		sents = append(sents, s)
	}
	return a.jsonFile(NameRefSentences, sents)
}

func sortedIDs(m map[int64]struct{}) []int64 {
	out := make([]int64, 0, len(m))
	for id := range m {
		out = append(out, id)
	}
	slices.Sort(out)
	return out
}

// hiddenDictionaryIDs reads workspace settings.hiddenDictionaries (positive
// integers only; anything else is ignored).
func hiddenDictionaryIDs(settings json.RawMessage) []int64 {
	var s struct {
		Hidden []json.Number `json:"hiddenDictionaries"`
	}
	if json.Unmarshal(settings, &s) != nil {
		return nil
	}
	var out []int64
	for _, n := range s.Hidden {
		if id, err := n.Int64(); err == nil && id > 0 {
			out = append(out, id)
		}
	}
	return out
}
