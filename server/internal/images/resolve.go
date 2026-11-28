package images

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"qinqin/internal/pack"
)

// maxTargets bounds the strings one Resolve call looks up.
const maxTargets = 24

// Found is the picture of an entry with its credit.
type Found struct {
	PackID, Concept, Label, Credit, License, Attribution, Basis string
	Sense, Score                                                int
	SVG                                                         string
}

// Resolve finds the picture of a dictionary entry of language: the best
// mapped one among live packs for any of targets (the entry's key and its
// written forms, plus its kana reading when it has no written form).
//
// sense is the 1-based number of the sense the caller shows, 0 for the entry
// as a whole. With a sense, only mappings of that sense and entry-wide ones
// (sense 0) qualify and the sense's own win; with none, every mapping
// qualifies, so a word whose first sense has no picture but whose second has
// one still shows it. Ties break by score (higher), then sense (lower), then
// pack id and concept, so the answer is stable. ok is false when none maps.
// A picture in skip (the caller's reported pictures of the entry, #274) is
// passed over.
func Resolve(ctx context.Context, q Querier, language string, targets []string, sense int, skip []Key) (f Found, ok bool, err error) {
	seen := map[string]bool{}
	var uniq []string
	for _, t := range targets {
		if t = strings.TrimSpace(t); t != "" && !seen[t] && len(uniq) < maxTargets {
			seen[t] = true
			uniq = append(uniq, t)
		}
	}
	if len(uniq) == 0 {
		return Found{}, false, nil
	}
	args := []any{language}
	for _, t := range uniq {
		args = append(args, t)
	}
	where := `m.language = ? AND m.target IN (` + pack.Placeholders(len(uniq)) + `) AND p.deleted_at IS NULL`
	if sense > 0 {
		where += ` AND m.sense IN (0, ?)`
		args = append(args, sense)
	}
	for _, k := range skip {
		where += ` AND NOT (m.pack_id = ? AND m.concept = ?)`
		args = append(args, k.PackID, k.Concept)
	}
	order := `m.score DESC, m.sense, m.pack_id, m.concept`
	if sense > 0 {
		args = append(args, sense)
		order = `(m.sense = ?) DESC, ` + order
	}
	err = q.QueryRowContext(ctx, `
		SELECT m.pack_id, m.concept, m.sense, m.score, m.basis, pic.label, pic.credit, p.license, p.attribution, pic.svg
		FROM image_map m
		JOIN image_packs p ON p.pack_id = m.pack_id
		JOIN image_pictures pic ON pic.pack_id = m.pack_id AND pic.concept = m.concept
		WHERE `+where+` ORDER BY `+order+` LIMIT 1`, args...).Scan(
		&f.PackID, &f.Concept, &f.Sense, &f.Score, &f.Basis, &f.Label, &f.Credit, &f.License, &f.Attribution, &f.SVG)
	if errors.Is(err, sql.ErrNoRows) {
		return Found{}, false, nil
	}
	if err != nil {
		return Found{}, false, fmt.Errorf("images: resolve %s %v: %w", language, uniq, err)
	}
	return f, true, nil
}
