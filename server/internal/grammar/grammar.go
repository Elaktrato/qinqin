package grammar

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"qinqin/internal/pack"
)

// ErrNotFound reports a lesson (or its pack) that does not exist or was
// removed by a re-import.
var ErrNotFound = pack.NotFound("grammar lesson not found")

// ErrNotGrammar reports an Import of a pack whose manifest type is not
// "grammar"; pack dispatch happens in the seed CLI, which routes by
// type, so this guards a misrouted call.
var ErrNotGrammar = errors.New("grammar: manifest type is not \"grammar\"")

// Result counts what one pack import covers.
type Result struct {
	Lessons int // lessons of the pack after the import
}

// LessonSummary is one row of the browse list.
type LessonSummary struct {
	ID       string `json:"id"`
	Level    string `json:"level"`
	Title    string `json:"title"`
	Summary  string `json:"summary"`
	Examples int    `json:"examples"`
}

// PackInfo is an installed grammar pack: its credits, ordered levels and
// (in listings) its lesson summaries in level, then pack order.
type PackInfo struct {
	PackID      string          `json:"packId"`
	Name        string          `json:"name"`
	Version     string          `json:"version"`
	Language    string          `json:"language"`
	License     string          `json:"license"`
	Attribution string          `json:"attribution"`
	Notice      string          `json:"notice"`
	Levels      []Level         `json:"levels"`
	Lessons     []LessonSummary `json:"lessons,omitempty"`
}

// LessonView is one lesson with its pack's credits (without the lesson
// list) and the neighbouring lesson ids in the pack's level order; ""
// at the ends.
type LessonView struct {
	Pack   PackInfo `json:"pack"`
	Lesson Lesson   `json:"lesson"`
	Prev   string   `json:"prev"`
	Next   string   `json:"next"`
}

// Import installs the grammar pack: the pack row is upserted and its
// lessons are diffed against the stored ones in one transaction. A
// lesson the pack dropped is soft-deleted, a returning one revived, a
// changed one updated; an identical pack writes nothing. The data is
// validated before anything is written.
func Import(ctx context.Context, sqlDB *sql.DB, pk pack.Pack) (Result, error) {
	m := pk.Manifest
	m.Language = strings.ToLower(strings.TrimSpace(m.Language))
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeGrammar {
		return Result{}, fmt.Errorf("%w: %q is a %s pack", ErrNotGrammar, m.ID, m.Type)
	}
	if m.Format != pack.FormatJSON {
		return Result{}, fmt.Errorf("%w: grammar pack format %q is not implemented (want json)", pack.ErrInvalidPack, m.Format)
	}
	data, err := ReadData(pk.Dir)
	if err != nil {
		return Result{}, err
	}
	levelsJSON, err := json.Marshal(data.Levels)
	if err != nil {
		return Result{}, fmt.Errorf("import grammar %s: %w", m.ID, err)
	}

	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, fmt.Errorf("import grammar %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	stamp := now()

	packRow, err := upsertPack(ctx, tx, m, string(levelsJSON), stamp)
	if err != nil {
		return Result{}, err
	}

	type stored struct {
		id                               int64
		levelID, title, summary, content string
		ord                              int
		active                           bool
	}
	cur, err := tx.QueryContext(ctx, `
		SELECT id, lesson_id, level_id, ord, title, summary, content_json, deleted_at IS NULL
		FROM grammar_lessons WHERE pack_id = ?`, packRow)
	if err != nil {
		return Result{}, fmt.Errorf("read grammar lessons of %s: %w", m.ID, err)
	}
	existing := map[string]stored{}
	for cur.Next() {
		var (
			lid string
			s   stored
		)
		if err := cur.Scan(&s.id, &lid, &s.levelID, &s.ord, &s.title, &s.summary, &s.content, &s.active); err != nil {
			cur.Close()
			return Result{}, fmt.Errorf("read grammar lessons of %s: %w", m.ID, err)
		}
		existing[lid] = s
	}
	err = cur.Err()
	cur.Close()
	if err != nil {
		return Result{}, fmt.Errorf("read grammar lessons of %s: %w", m.ID, err)
	}

	wanted := map[string]bool{}
	for ord, l := range data.Lessons {
		wanted[l.ID] = true
		content, err := json.Marshal(l)
		if err != nil {
			return Result{}, fmt.Errorf("import grammar %s: %w", m.ID, err)
		}
		have, ok := existing[l.ID]
		switch {
		case !ok:
			_, err = tx.ExecContext(ctx, `
				INSERT INTO grammar_lessons (pack_id, lesson_id, level_id, ord, title, summary, content_json, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				packRow, l.ID, l.Level, ord, l.Title, l.Summary, string(content), stamp)
		case !have.active || have.levelID != l.Level || have.ord != ord || have.title != l.Title ||
			have.summary != l.Summary || have.content != string(content):
			_, err = tx.ExecContext(ctx, `
				UPDATE grammar_lessons
				SET level_id = ?, ord = ?, title = ?, summary = ?, content_json = ?, updated_at = ?, deleted_at = NULL
				WHERE id = ?`,
				l.Level, ord, l.Title, l.Summary, string(content), stamp, have.id)
		}
		if err != nil {
			return Result{}, fmt.Errorf("write grammar lesson %s of %s: %w", l.ID, m.ID, err)
		}
	}
	for lid, s := range existing {
		if s.active && !wanted[lid] {
			if _, err := tx.ExecContext(ctx, `
				UPDATE grammar_lessons SET deleted_at = ?, updated_at = ? WHERE id = ?`,
				stamp, stamp, s.id); err != nil {
				return Result{}, fmt.Errorf("retire grammar lesson %s of %s: %w", lid, m.ID, err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("import grammar %s: %w", m.ID, err)
	}
	return Result{Lessons: len(data.Lessons)}, nil
}

// Uninstall soft-deletes the pack with manifest id packID and its
// lessons in one transaction; a reinstall revives both (see Import). An
// unknown or already uninstalled pack returns ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, packID string) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("uninstall grammar pack %s: %w", packID, err)
	}
	defer tx.Rollback()
	var id int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM grammar_packs WHERE pack_id = ? AND deleted_at IS NULL`, packID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("uninstall grammar pack %s: %w", packID, err)
	}
	stamp := now()
	if _, err := tx.ExecContext(ctx, `
		UPDATE grammar_lessons SET deleted_at = ?, updated_at = ? WHERE pack_id = ? AND deleted_at IS NULL`,
		stamp, stamp, id); err != nil {
		return fmt.Errorf("uninstall grammar lessons of %s: %w", packID, err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE grammar_packs SET deleted_at = ?, updated_at = ? WHERE id = ?`, stamp, stamp, id); err != nil {
		return fmt.Errorf("uninstall grammar pack %s: %w", packID, err)
	}
	return tx.Commit()
}

// upsertPack inserts or updates the pack row, writing only when a stored
// field differs (or the pack was deleted), and returns its row id.
func upsertPack(ctx context.Context, tx *sql.Tx, m pack.Manifest, levelsJSON, stamp string) (int64, error) {
	var (
		id                                            int64
		name, version, language, license, attribution string
		notice, stored                                string
		deleted                                       bool
	)
	err := tx.QueryRowContext(ctx, `
		SELECT id, name, version, language, license, attribution, notice, levels_json, deleted_at IS NOT NULL
		FROM grammar_packs WHERE pack_id = ?`, m.ID).
		Scan(&id, &name, &version, &language, &license, &attribution, &notice, &stored, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		res, err := tx.ExecContext(ctx, `
			INSERT INTO grammar_packs (pack_id, name, version, language, license, attribution, notice, levels_json, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			m.ID, m.Name, m.Version, m.Language, m.License, m.Attribution, m.Notice, levelsJSON, stamp)
		if err != nil {
			return 0, fmt.Errorf("insert grammar pack %s: %w", m.ID, err)
		}
		return res.LastInsertId()
	}
	if err != nil {
		return 0, fmt.Errorf("read grammar pack %s: %w", m.ID, err)
	}
	if deleted || name != m.Name || version != m.Version || language != m.Language || license != m.License ||
		attribution != m.Attribution || notice != m.Notice || stored != levelsJSON {
		if _, err := tx.ExecContext(ctx, `
			UPDATE grammar_packs SET name = ?, version = ?, language = ?, license = ?, attribution = ?,
				notice = ?, levels_json = ?, updated_at = ?, deleted_at = NULL
			WHERE id = ?`,
			m.Name, m.Version, m.Language, m.License, m.Attribution, m.Notice, levelsJSON, stamp, id); err != nil {
			return 0, fmt.Errorf("update grammar pack %s: %w", m.ID, err)
		}
	}
	return id, nil
}

// packRow is a pack's stored row.
type packRow struct {
	rowID int64
	PackInfo
}

// loadPacks reads the active packs (of language, or all when empty),
// their levels and, when withLessons, their lesson summaries in level
// then pack order.
func loadPacks(ctx context.Context, sqlDB *sql.DB, language, packID string, withLessons bool) ([]PackInfo, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT id, pack_id, name, version, language, license, attribution, notice, levels_json
		FROM grammar_packs
		WHERE deleted_at IS NULL AND (? = '' OR language = ?) AND (? = '' OR pack_id = ?)
		ORDER BY language, pack_id`, language, language, packID, packID)
	if err != nil {
		return nil, fmt.Errorf("list grammar packs: %w", err)
	}
	var packs []packRow
	for rows.Next() {
		var (
			p      packRow
			levels string
		)
		if err := rows.Scan(&p.rowID, &p.PackID, &p.Name, &p.Version, &p.Language, &p.License,
			&p.Attribution, &p.Notice, &levels); err != nil {
			rows.Close()
			return nil, fmt.Errorf("list grammar packs: %w", err)
		}
		if err := json.Unmarshal([]byte(levels), &p.Levels); err != nil {
			rows.Close()
			return nil, fmt.Errorf("decode levels of grammar pack %s: %w", p.PackID, err)
		}
		packs = append(packs, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, fmt.Errorf("list grammar packs: %w", err)
	}

	out := make([]PackInfo, 0, len(packs))
	for _, p := range packs {
		if withLessons {
			p.Lessons, err = loadSummaries(ctx, sqlDB, p.rowID, p.Levels)
			if err != nil {
				return nil, err
			}
		}
		out = append(out, p.PackInfo)
	}
	return out, nil
}

// loadSummaries reads a pack's active lessons, ordered by the pack's
// level order and then lesson order.
func loadSummaries(ctx context.Context, sqlDB *sql.DB, packRowID int64, levels []Level) ([]LessonSummary, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT lesson_id, level_id, title, summary, content_json
		FROM grammar_lessons WHERE pack_id = ? AND deleted_at IS NULL ORDER BY ord`, packRowID)
	if err != nil {
		return nil, fmt.Errorf("list grammar lessons: %w", err)
	}
	defer rows.Close()
	list := []LessonSummary{}
	for rows.Next() {
		var (
			s       LessonSummary
			content string
			l       struct {
				Examples []json.RawMessage `json:"examples"`
			}
		)
		if err := rows.Scan(&s.ID, &s.Level, &s.Title, &s.Summary, &content); err != nil {
			return nil, fmt.Errorf("list grammar lessons: %w", err)
		}
		if err := json.Unmarshal([]byte(content), &l); err != nil {
			return nil, fmt.Errorf("decode grammar lesson %s: %w", s.ID, err)
		}
		s.Examples = len(l.Examples)
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list grammar lessons: %w", err)
	}
	rank := map[string]int{}
	for i, lv := range levels {
		rank[lv.ID] = i
	}
	sort.SliceStable(list, func(i, j int) bool { return rank[list[i].Level] < rank[list[j].Level] })
	return list, nil
}

// ListPacks returns the installed grammar packs of language ("" for
// every language) with their lesson summaries; never nil.
func ListPacks(ctx context.Context, sqlDB *sql.DB, language string) ([]PackInfo, error) {
	return loadPacks(ctx, sqlDB, strings.ToLower(strings.TrimSpace(language)), "", true)
}

// LessonByID returns one lesson of an installed pack with the pack's
// credits and the neighbouring lessons; ErrNotFound when the pack or
// lesson is unknown or was removed.
func LessonByID(ctx context.Context, sqlDB *sql.DB, packID, lessonID string) (LessonView, error) {
	if packID == "" {
		return LessonView{}, ErrNotFound
	}
	packs, err := loadPacks(ctx, sqlDB, "", packID, true)
	if err != nil {
		return LessonView{}, err
	}
	if len(packs) == 0 {
		return LessonView{}, ErrNotFound
	}
	pk := packs[0]
	idx := -1
	for i, s := range pk.Lessons {
		if s.ID == lessonID {
			idx = i
		}
	}
	if idx < 0 {
		return LessonView{}, ErrNotFound
	}
	var content string
	err = sqlDB.QueryRowContext(ctx, `
		SELECT l.content_json FROM grammar_lessons l JOIN grammar_packs p ON p.id = l.pack_id
		WHERE p.pack_id = ? AND l.lesson_id = ? AND l.deleted_at IS NULL`, packID, lessonID).Scan(&content)
	if errors.Is(err, sql.ErrNoRows) {
		return LessonView{}, ErrNotFound
	}
	if err != nil {
		return LessonView{}, fmt.Errorf("read grammar lesson %s/%s: %w", packID, lessonID, err)
	}
	v := LessonView{}
	if err := json.Unmarshal([]byte(content), &v.Lesson); err != nil {
		return LessonView{}, fmt.Errorf("decode grammar lesson %s/%s: %w", packID, lessonID, err)
	}
	if idx > 0 {
		v.Prev = pk.Lessons[idx-1].ID
	}
	if idx < len(pk.Lessons)-1 {
		v.Next = pk.Lessons[idx+1].ID
	}
	pk.Lessons = nil
	v.Pack = pk
	return v, nil
}

// now returns the server clock as UTC RFC 3339, the timestamp
// convention for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
