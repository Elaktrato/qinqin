package sentences

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"qinqin/internal/model"
	"qinqin/internal/pack"
)

// Saved sentences (#279, docs/contracts/reader/saved-sentences.json): the
// reader saves the book sentence a studied word is met in as an own
// sentence of the entry. Two sentences are the same when their normalised
// texts are equal.

// ErrNotReportable is a report reason on an own sentence the AI did not write.
var ErrNotReportable = errors.New("sentences: only AI-written examples can be reported")

// isSentenceSpace is the contract's whitespace set (the same in every
// client): ASCII whitespace, NEL, the no-break spaces, the Unicode space
// separators, the line and paragraph separators and the byte order mark.
func isSentenceSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x85, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

// NormalizeText turns every run of whitespace into one space and trims the
// ends. Nothing else is folded (punctuation, width, case).
func NormalizeText(s string) string {
	return strings.Join(strings.FieldsFunc(s, isSentenceSpace), " ")
}

// SameText is the first sentence of list whose normalised text equals
// text's; an empty text matches nothing.
func SameText(list []model.Sentence, text string) (model.Sentence, bool) {
	want := NormalizeText(text)
	if want == "" {
		return model.Sentence{}, false
	}
	for _, s := range list {
		if NormalizeText(s.Hanzi) == want {
			return s, true
		}
	}
	return model.Sentence{}, false
}

// FindSame is the active sentence of the entry viewerID sees (pack and own,
// in ForEntry's order) with the same text, if any.
func FindSame(ctx context.Context, sqlDB *sql.DB, entryID, viewerID int64, text string) (model.Sentence, bool, error) {
	list, err := ForEntry(ctx, sqlDB, entryID, viewerID)
	if err != nil {
		return model.Sentence{}, false, err
	}
	s, ok := SameText(list, text)
	return s, ok, nil
}

// DeleteOwn deletes the caller's own sentence sentenceID of entryID (a
// tombstone, so the pull ships the deletion). A reason reports it and is
// only allowed on an AI-written example (ErrNotReportable otherwise). A pack
// sentence, another user's or another entry's is ErrSentenceNotFound.
func DeleteOwn(ctx context.Context, sqlDB *sql.DB, userID, entryID, sentenceID int64, reason string) error {
	if err := checkReason(reason); err != nil {
		return err
	}
	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("delete own sentence: %w", err)
	}
	defer tx.Rollback()
	var hanzi, pinyin, translation, level, provider, modelID string
	err = tx.QueryRowContext(ctx, `
		SELECT hanzi, pinyin, translation, ai_level, ai_provider, ai_model FROM sentences
		WHERE id = ? AND entry_id = ? AND user_id = ? AND deleted_at IS NULL`,
		sentenceID, entryID, userID).Scan(&hanzi, &pinyin, &translation, &level, &provider, &modelID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrSentenceNotFound
	}
	if err != nil {
		return fmt.Errorf("delete own sentence: %w", err)
	}
	if reason != "" {
		if provider == "" && modelID == "" {
			return ErrNotReportable
		}
		if err := report(ctx, tx, userID, entryID, reason, hanzi, pinyin, translation, level, provider, modelID); err != nil {
			return err
		}
	}
	stamp := pack.Now()
	if _, err := tx.ExecContext(ctx, `UPDATE sentences SET deleted_at = ?, updated_at = ? WHERE id = ?`, stamp, stamp, sentenceID); err != nil {
		return fmt.Errorf("delete own sentence: %w", err)
	}
	return tx.Commit()
}
