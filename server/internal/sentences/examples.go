package sentences

// AI example sentences on demand (#186, docs/contracts/examples/): the
// server's checks of a generated sentence, the drafts of a generation, and
// keeping, deleting and reporting them. A kept example is a user-owned row
// of `sentences` marked by ai_provider and ai_model; drafts and reports
// have tables of their own (migration 049).

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"qinqin/internal/ai"
	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/pack"
	"qinqin/internal/segment"
)

// Caps (docs/contracts/examples/examples.json "limits").
const (
	MaxKeptPerEntry            = 10
	MaxExampleTextRunes        = 200
	MaxExampleReadingRunes     = 400
	MaxExampleTranslationRunes = 400
	MaxReportsPerUser          = 500
	MaxRequestIDLength         = 64
	// FewExamples: the entry page offers "Generate examples" while an entry
	// has fewer sentences than this.
	FewExamples = 3
)

// ReportReasons is the closed set of reasons a learner gives when they
// report an example, in display order.
var ReportReasons = []string{"missing_word", "wrong_translation", "wrong_reading", "unnatural", "too_hard", "inappropriate", "other"}

// ValidReason reports whether r is one of ReportReasons.
func ValidReason(r string) bool { return slices.Contains(ReportReasons, r) }

var requestIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// ValidRequestID reports whether id is a client request id: 1 to 64
// letters, digits, '-' or '_'.
func ValidRequestID(id string) bool { return requestIDRe.MatchString(id) }

// Errors of the example store.
var (
	ErrDraftNotFound = errors.New("sentences: draft not found")
	ErrExamplesFull  = errors.New("sentences: the entry has the maximum of kept AI examples")
	ErrBadReason     = errors.New("sentences: unknown report reason")
)

// AIMark is the mark of a sentence row: nil unless an AI wrote it.
func AIMark(provider, modelID string) *model.SentenceAI {
	if provider == "" && modelID == "" {
		return nil
	}
	return &model.SentenceAI{Provider: provider, Model: modelID}
}

// Word is what the checks know of the entry: its id, language, written form
// and form texts.
type Word struct {
	ID       int64
	Language string
	Written  string
	Forms    []string
}

// Candidate is one generated sentence.
type Candidate struct{ Text, Reading, Translation string }

// WordOf is the Word of a lexicon entry.
func WordOf(e lexicon.Entry) Word {
	w := Word{ID: e.ID, Language: e.Language, Written: e.Headword()}
	for _, f := range e.Forms {
		w.Forms = append(w.Forms, f.Text)
	}
	return w
}

// RequestFor is the AI request for entry e at level: the word, its first
// reading of the language's reading system, its first glosses and the texts
// of its sentences (not to repeat). exact: the server cannot recognise an
// inflected form (no dictionary segmentation, no lemma table).
func RequestFor(e lexicon.Entry, existing []model.Sentence, level string, exact bool) ai.ExamplesRequest {
	r := ai.ExamplesRequest{Language: e.Language, Level: level, Word: e.Headword(), ExactForm: exact}
	if p := lang.ProfileOf(e.Language); len(p.Readings) > 0 {
		r.ReadingSystem = p.Readings[0]
		for _, rd := range e.Readings {
			if rd.Type == r.ReadingSystem {
				r.Reading = rd.Value
				break
			}
		}
	}
	for _, s := range e.Senses {
		for _, g := range s.Glosses {
			if len(r.Glosses) < ai.MaxExampleGlosses {
				r.Glosses = append(r.Glosses, g)
			}
		}
	}
	for _, s := range existing {
		if len(r.Existing) < ai.MaxExampleExisting && strings.TrimSpace(s.Hanzi) != "" {
			r.Existing = append(r.Existing, s.Hanzi)
		}
	}
	return r
}

// cleanText is plain one-line text: control characters dropped, every run of
// white space (line breaks included) one space, the ends trimmed.
func cleanText(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		switch {
		case unicode.IsSpace(r):
			space = true
		case unicode.IsControl(r) || r == utf8.RuneError:
		default:
			if space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			space = false
			b.WriteRune(r)
		}
	}
	return b.String()
}

func hasHan(s string) bool {
	return strings.IndexFunc(s, func(r rune) bool { return unicode.Is(unicode.Han, r) }) >= 0
}

// readingFits reports whether a reading is written in the reading system:
// kana (hiragana, katakana, the long-vowel mark), or pinyin (Latin letters
// with or without tone marks, tone numbers, the apostrophe), each with
// punctuation and spaces. No reading system fits no reading.
func readingFits(system, reading string) bool {
	var letter func(rune) bool
	switch system {
	case "kana":
		letter = func(r rune) bool {
			return unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) || r == 'ー'
		}
	case "pinyin":
		letter = func(r rune) bool {
			return unicode.Is(unicode.Latin, r) || r >= '1' && r <= '5' || unicode.Is(unicode.Mn, r)
		}
	default:
		return false
	}
	for _, r := range reading {
		if !letter(r) && !unicode.IsPunct(r) && !unicode.IsSpace(r) {
			return false
		}
	}
	return true
}

type span struct{ start, end int }

// ContainsWord is the cloze card's blank rule (docs/contracts/cards/cloze.json)
// reduced to "is there a blank": a segmenter match that resolves to the entry
// (for a word written with Han, a kana-only match only when the entry is its
// first candidate),
// else a literal occurrence of the written form or a form text (longest
// first, leftmost, not overlapping) that does not lie inside a strictly longer
// segmenter match. matches nil or empty: the literal rule alone.
func ContainsWord(text string, w Word, matches []segment.Match) bool {
	chars := []rune(text)
	hanWord := hasHan(w.Written)
	for _, m := range matches {
		if m.Start < 0 || m.End > len(chars) || m.End <= m.Start {
			continue
		}
		// A kana-only surface of a word written with Han (はし for 橋) is a
		// homophone unless the segmenter ranks the entry first for it.
		if hanWord && !hasHan(string(chars[m.Start:m.End])) {
			if len(m.Entries) > 0 && m.Entries[0].ID == w.ID {
				return true
			}
			continue
		}
		for _, c := range m.Entries {
			if c.ID == w.ID {
				return true
			}
		}
	}
	cands := []string{}
	for _, c := range append([]string{w.Written}, w.Forms...) {
		if c != "" && !slices.Contains(cands, c) {
			cands = append(cands, c)
		}
	}
	slices.SortStableFunc(cands, func(a, b string) int { return utf8.RuneCountInString(b) - utf8.RuneCountInString(a) })
	var found []span
	taken := func(s, e int) bool {
		for _, f := range found {
			if s < f.end && e > f.start {
				return true
			}
		}
		return false
	}
	for _, c := range cands {
		cps := []rune(c)
		for at := 0; at+len(cps) <= len(chars); at++ {
			if !slices.Equal(chars[at:at+len(cps)], cps) || taken(at, at+len(cps)) {
				continue
			}
			found = append(found, span{at, at + len(cps)})
			at += len(cps) - 1
		}
	}
	for _, f := range found {
		inside := false
		for _, m := range matches {
			if m.Start <= f.start && m.End >= f.end && m.End-m.Start > f.end-f.start {
				inside = true
				break
			}
		}
		if !inside {
			return true
		}
	}
	return false
}

// CheckExample applies the server's rules to one generated sentence: it
// returns the cleaned sentence and "" when it may become a draft, else the
// reason it is dropped ("empty", "too_long", "wrong_script", "missing_word",
// "duplicate", checked in that order). matches are the segmenter's matches
// of the cleaned text (nil for a language without segmentation); existing
// are the texts it must not repeat. A reading is emptied, not the sentence,
// when the language has no reading system, when it holds a Han character or
// when it is too long.
func CheckExample(c Candidate, w Word, readingSystem string, matches []segment.Match, existing []string) (Candidate, string) {
	out := Candidate{Text: cleanText(c.Text), Reading: cleanText(c.Reading), Translation: cleanText(c.Translation)}
	switch {
	case out.Text == "" || out.Translation == "":
		return Candidate{}, "empty"
	case utf8.RuneCountInString(out.Text) > MaxExampleTextRunes || utf8.RuneCountInString(out.Translation) > MaxExampleTranslationRunes:
		return Candidate{}, "too_long"
	case !lang.MostlyInScript(w.Language, out.Text):
		return Candidate{}, "wrong_script"
	case !ContainsWord(out.Text, w, matches):
		return Candidate{}, "missing_word"
	}
	for _, e := range existing {
		if cleanText(e) == out.Text {
			return Candidate{}, "duplicate"
		}
	}
	if !readingFits(readingSystem, out.Reading) || utf8.RuneCountInString(out.Reading) > MaxExampleReadingRunes {
		out.Reading = ""
	}
	return out, ""
}

// SegmentFunc segments a text in a language (the server's segmenter).
type SegmentFunc func(ctx context.Context, language, text string) ([]segment.Match, error)

// FilterExamples checks the model's sentences in order and keeps at most
// ai.MaxExamples of them; dropped counts the rest. seg is nil for a language
// the server cannot segment (the literal rule alone). A sentence may repeat
// neither an existing one nor an earlier one of the same answer.
func FilterExamples(ctx context.Context, seg SegmentFunc, w Word, readingSystem string, raw []ai.ExampleSentence, existing []string) (kept []Candidate, dropped int, err error) {
	seen := append([]string{}, existing...)
	for _, r := range raw {
		if len(kept) == ai.MaxExamples {
			dropped++
			continue
		}
		text := cleanText(r.Text)
		var matches []segment.Match
		if seg != nil && text != "" && utf8.RuneCountInString(text) <= MaxExampleTextRunes {
			if matches, err = seg(ctx, w.Language, text); err != nil {
				return nil, 0, err
			}
		}
		c, reason := CheckExample(Candidate{Text: r.Text, Reading: r.Reading, Translation: r.Translation}, w, readingSystem, matches, seen)
		if reason != "" {
			dropped++
			continue
		}
		kept = append(kept, c)
		seen = append(seen, c.Text)
	}
	return kept, dropped, nil
}

// Draft is one undecided sentence of the latest generation for an entry.
type Draft struct {
	ID          int64  `json:"id"`
	EntryID     int64  `json:"entryId"`
	Hanzi       string `json:"hanzi"`
	Pinyin      string `json:"pinyin"`
	Translation string `json:"translation"`
	Level       string `json:"level"`
	Provider    string `json:"provider"`
	Model       string `json:"model"`
	RequestID   string `json:"requestId"`
	CreatedAt   string `json:"createdAt"`
}

// ExamplesView is GET /api/entries/{id}/examples: the caller's drafts of the
// entry and the level of their latest generation or kept example.
type ExamplesView struct {
	Drafts       []Draft      `json:"drafts"`
	DefaultLevel string       `json:"defaultLevel"`
	LastRequest  *LastRequest `json:"lastRequest"`
}

// Generation is who wrote a set of drafts, for which request and level.
type Generation struct{ RequestID, Level, Provider, Model string }

const draftColumns = `id, entry_id, hanzi, pinyin, translation, level, provider, model, request_id, created_at`

type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func drafts(ctx context.Context, q querier, where string, args ...any) ([]Draft, error) {
	rows, err := q.QueryContext(ctx, `SELECT `+draftColumns+` FROM example_drafts WHERE `+where+` ORDER BY id`, args...)
	if err != nil {
		return nil, fmt.Errorf("read drafts: %w", err)
	}
	defer rows.Close()
	out := []Draft{}
	for rows.Next() {
		var d Draft
		if err := rows.Scan(&d.ID, &d.EntryID, &d.Hanzi, &d.Pinyin, &d.Translation, &d.Level, &d.Provider, &d.Model, &d.RequestID, &d.CreatedAt); err != nil {
			return nil, fmt.Errorf("read drafts: %w", err)
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read drafts: %w", err)
	}
	return out, nil
}

// Examples is the caller's drafts of entryID (oldest first) and their default
// level: the level of their latest draft or kept example, else "beginner".
func Examples(ctx context.Context, sqlDB *sql.DB, userID, entryID int64) (ExamplesView, error) {
	list, err := drafts(ctx, sqlDB, `user_id = ? AND entry_id = ?`, userID, entryID)
	if err != nil {
		return ExamplesView{}, err
	}
	v := ExamplesView{Drafts: list, DefaultLevel: "beginner"}
	// The latest generation's level, else the latest kept example's, else the
	// latest draft's (markers expire after a day).
	for _, q := range []string{
		`SELECT level FROM example_generations WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
		`SELECT ai_level FROM sentences WHERE user_id = ? AND ai_level <> '' AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 1`,
		`SELECT level FROM example_drafts WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
	} {
		var level string
		err := sqlDB.QueryRowContext(ctx, q, userID).Scan(&level)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return ExamplesView{}, fmt.Errorf("default level of user %d: %w", userID, err)
		}
		if ai.ValidLevel(level) {
			v.DefaultLevel = level
		}
		break
	}
	var last LastRequest
	err = sqlDB.QueryRowContext(ctx, `SELECT request_id, dropped, provider, model FROM example_generations
		WHERE user_id = ? AND entry_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, userID, entryID).
		Scan(&last.RequestID, &last.Dropped, &last.Provider, &last.Model)
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return ExamplesView{}, fmt.Errorf("last generation of user %d: %w", userID, err)
	default:
		v.LastRequest = &last
	}
	return v, nil
}

// KeptCount is the number of the caller's live AI examples on entryID.
func KeptCount(ctx context.Context, sqlDB *sql.DB, userID, entryID int64) (int, error) {
	return keptCount(ctx, sqlDB, userID, entryID)
}

func keptCount(ctx context.Context, q interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}, userID, entryID int64) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM sentences
		WHERE user_id = ? AND entry_id = ? AND deleted_at IS NULL AND (ai_provider <> '' OR ai_model <> '')`, userID, entryID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count AI examples of user %d on entry %d: %w", userID, entryID, err)
	}
	return n, nil
}

// GenerationResult is the answer of a stored generation: the entry's drafts
// after it, how many sentences the checks dropped, who wrote them and the
// request id.
type GenerationResult struct {
	Drafts    []Draft `json:"drafts"`
	Dropped   int     `json:"dropped"`
	Provider  string  `json:"provider"`
	Model     string  `json:"model"`
	RequestID string  `json:"requestId"`
}

// LastRequest is the latest stored generation of an entry (its marker).
type LastRequest struct {
	RequestID string `json:"requestId"`
	Dropped   int    `json:"dropped"`
	Provider  string `json:"provider"`
	Model     string `json:"model"`
}

// generationTTL is how long a generation marker answers a retry.
const generationTTL = 24 * time.Hour

func storedGeneration(ctx context.Context, q interface {
	querier
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}, userID, entryID int64, requestID string) (GenerationResult, bool, error) {
	r := GenerationResult{RequestID: requestID}
	err := q.QueryRowContext(ctx, `SELECT dropped, provider, model FROM example_generations
		WHERE user_id = ? AND entry_id = ? AND request_id = ?`, userID, entryID, requestID).Scan(&r.Dropped, &r.Provider, &r.Model)
	if errors.Is(err, sql.ErrNoRows) {
		return GenerationResult{}, false, nil
	}
	if err != nil {
		return GenerationResult{}, false, fmt.Errorf("read generation: %w", err)
	}
	if r.Drafts, err = drafts(ctx, q, `user_id = ? AND entry_id = ?`, userID, entryID); err != nil {
		return GenerationResult{}, false, err
	}
	return r, true, nil
}

// StoredGeneration is the answer of the caller's generation requestID of
// entryID when it is stored (a retry), with the entry's drafts as they are now.
func StoredGeneration(ctx context.Context, sqlDB *sql.DB, userID, entryID int64, requestID string) (GenerationResult, bool, error) {
	return storedGeneration(ctx, sqlDB, userID, entryID, requestID)
}

// StoreGeneration stores a generation of the caller for entryID: its marker
// (request id, dropped count, provider, model) and, when it kept sentences,
// those as the entry's drafts in place of the undecided ones. A generation that
// kept nothing leaves the earlier drafts alone (their Keep still works). When
// g.RequestID is stored already (a retry) nothing is written and the stored
// answer comes back. Markers older than a day are removed.
func StoreGeneration(ctx context.Context, sqlDB *sql.DB, userID, entryID int64, g Generation, items []Candidate, dropped int) (GenerationResult, error) {
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return GenerationResult{}, fmt.Errorf("store generation: %w", err)
	}
	defer tx.Rollback()
	if have, ok, err := storedGeneration(ctx, tx, userID, entryID, g.RequestID); err != nil {
		return GenerationResult{}, err
	} else if ok {
		return have, nil
	}
	now := time.Now().UTC()
	stamp := now.Format(time.RFC3339)
	if _, err := tx.ExecContext(ctx, `DELETE FROM example_generations WHERE user_id = ? AND created_at < ?`,
		userID, now.Add(-generationTTL).Format(time.RFC3339)); err != nil {
		return GenerationResult{}, fmt.Errorf("prune generations: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO example_generations (user_id, entry_id, request_id, level, dropped, provider, model, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, userID, entryID, g.RequestID, g.Level, dropped, g.Provider, g.Model, stamp); err != nil {
		return GenerationResult{}, fmt.Errorf("store generation: %w", err)
	}
	if len(items) > 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM example_drafts WHERE user_id = ? AND entry_id = ?`, userID, entryID); err != nil {
			return GenerationResult{}, fmt.Errorf("replace drafts: %w", err)
		}
	}
	for _, c := range items {
		if _, err := tx.ExecContext(ctx, `INSERT INTO example_drafts (user_id, entry_id, request_id, hanzi, pinyin, translation, level, provider, model, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, userID, entryID, g.RequestID, c.Text, c.Reading, c.Translation, g.Level, g.Provider, g.Model, stamp); err != nil {
			return GenerationResult{}, fmt.Errorf("store draft: %w", err)
		}
	}
	out, _, err := storedGeneration(ctx, tx, userID, entryID, g.RequestID)
	if err != nil {
		return GenerationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return GenerationResult{}, fmt.Errorf("store generation: %w", err)
	}
	return out, nil
}

func oneDraft(ctx context.Context, tx *sql.Tx, userID, entryID, draftID int64) (Draft, error) {
	list, err := drafts(ctx, tx, `user_id = ? AND entry_id = ? AND id = ?`, userID, entryID, draftID)
	if err != nil {
		return Draft{}, err
	}
	if len(list) == 0 {
		return Draft{}, ErrDraftNotFound
	}
	return list[0], nil
}

// KeepDraft makes the caller's draft an AI example: a user-owned sentence of
// the entry marked with the draft's provider, model and level. The draft is
// removed in the same transaction. ErrDraftNotFound for a draft that is not
// the caller's on that entry (or kept already), ErrExamplesFull at the cap.
func KeepDraft(ctx context.Context, sqlDB *sql.DB, userID, entryID, draftID int64) (model.Sentence, error) {
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return model.Sentence{}, fmt.Errorf("keep draft: %w", err)
	}
	defer tx.Rollback()
	d, err := oneDraft(ctx, tx, userID, entryID, draftID)
	if err != nil {
		return model.Sentence{}, err
	}
	if n, err := keptCount(ctx, tx, userID, entryID); err != nil {
		return model.Sentence{}, err
	} else if n >= MaxKeptPerEntry {
		return model.Sentence{}, ErrExamplesFull
	}
	res, err := tx.ExecContext(ctx, `
		INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, ai_provider, ai_model, ai_level)
		VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?)`, entryID, userID, d.Hanzi, d.Pinyin, d.Translation, pack.Now(), d.Provider, d.Model, d.Level)
	if err != nil {
		return model.Sentence{}, fmt.Errorf("keep draft: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return model.Sentence{}, fmt.Errorf("keep draft: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM example_drafts WHERE id = ?`, d.ID); err != nil {
		return model.Sentence{}, fmt.Errorf("keep draft: %w", err)
	}
	s, err := scanSentence(tx.QueryRowContext(ctx, `SELECT `+sentenceColumns+` FROM sentences WHERE id = ?`, id))
	if err != nil {
		return model.Sentence{}, fmt.Errorf("keep draft: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return model.Sentence{}, fmt.Errorf("keep draft: %w", err)
	}
	return s, nil
}

// report stores a report row in tx and drops the user's oldest beyond
// MaxReportsPerUser.
func report(ctx context.Context, tx *sql.Tx, userID, entryID int64, reason, hanzi, pinyin, translation, level, provider, modelID string) error {
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO example_reports (user_id, entry_id, language, hanzi, pinyin, translation, reason, level, provider, model, created_at)
		VALUES (?, ?, COALESCE((SELECT language FROM entries WHERE id = ?), ''), ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, entryID, entryID, hanzi, pinyin, translation, reason, level, provider, modelID, pack.Now()); err != nil {
		return fmt.Errorf("store report: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM example_reports WHERE user_id = ?1 AND id NOT IN (
			SELECT id FROM example_reports WHERE user_id = ?1 ORDER BY id DESC LIMIT ?2)`, userID, MaxReportsPerUser); err != nil {
		return fmt.Errorf("prune reports: %w", err)
	}
	return nil
}

func checkReason(reason string) error {
	if reason != "" && !ValidReason(reason) {
		return ErrBadReason
	}
	return nil
}

// DiscardDraft removes the caller's draft; with a reason (one of
// ReportReasons) it is also reported.
func DiscardDraft(ctx context.Context, sqlDB *sql.DB, userID, entryID, draftID int64, reason string) error {
	if err := checkReason(reason); err != nil {
		return err
	}
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("discard draft: %w", err)
	}
	defer tx.Rollback()
	d, err := oneDraft(ctx, tx, userID, entryID, draftID)
	if err != nil {
		return err
	}
	if reason != "" {
		if err := report(ctx, tx, userID, entryID, reason, d.Hanzi, d.Pinyin, d.Translation, d.Level, d.Provider, d.Model); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM example_drafts WHERE id = ?`, d.ID); err != nil {
		return fmt.Errorf("discard draft: %w", err)
	}
	return tx.Commit()
}

// DeleteAI deletes the caller's AI example sentenceID of entryID (a
// tombstone, so the pull ships the deletion); with a reason it is also
// reported. Any other sentence (a pack one, another user's, an own sentence
// the AI did not write) is ErrSentenceNotFound.
func DeleteAI(ctx context.Context, sqlDB *sql.DB, userID, entryID, sentenceID int64, reason string) error {
	if err := checkReason(reason); err != nil {
		return err
	}
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("delete AI example: %w", err)
	}
	defer tx.Rollback()
	var hanzi, pinyin, translation, level, provider, modelID string
	err = tx.QueryRowContext(ctx, `
		SELECT hanzi, pinyin, translation, ai_level, ai_provider, ai_model FROM sentences
		WHERE id = ? AND entry_id = ? AND user_id = ? AND deleted_at IS NULL AND (ai_provider <> '' OR ai_model <> '')`,
		sentenceID, entryID, userID).Scan(&hanzi, &pinyin, &translation, &level, &provider, &modelID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrSentenceNotFound
	}
	if err != nil {
		return fmt.Errorf("delete AI example: %w", err)
	}
	if reason != "" {
		if err := report(ctx, tx, userID, entryID, reason, hanzi, pinyin, translation, level, provider, modelID); err != nil {
			return err
		}
	}
	stamp := pack.Now()
	if _, err := tx.ExecContext(ctx, `UPDATE sentences SET deleted_at = ?, updated_at = ? WHERE id = ?`, stamp, stamp, sentenceID); err != nil {
		return fmt.Errorf("delete AI example: %w", err)
	}
	return tx.Commit()
}
