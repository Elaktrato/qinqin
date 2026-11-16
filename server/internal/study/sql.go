// Package study stores the typed study rows (cards, decks, deck settings,
// limits, FSRS sets, the active set; shapes in study/rows): last-write-wins
// writes, reads, the sync pull, and the legacy view old web shells use.
// Every query is scoped to one user. Contract: docs/contracts/study/.
package study

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"qinqin/internal/study/rows"
)

// Querier is *sql.DB or *sql.Tx.
type Querier interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// table describes the storage of one family: its table, the identity
// column ("" for the one row per workspace) and the typed columns.
type table struct {
	name     string
	identity string
	cols     []string
}

var tables = map[rows.Family]table{
	rows.Cards:        {"study_cards", "id", []string{"id", "kind", "entry_id", "written", "entry_kind", "sentence_id", "skip_kinds", "deck_ids", "created_at"}},
	rows.Decks:        {"study_decks", "id", []string{"id", "name", "created_at", "source"}},
	rows.DeckSettings: {"study_deck_settings", "deck_id", []string{"deck_id", "card_types", "new_order"}},
	rows.Limits:       {"study_limits", "deck_id", []string{"deck_id", "new_set", "new_limit", "reviews_set", "reviews_limit"}},
	rows.FsrsSets:     {"study_fsrs_sets", "id", []string{"id", "w", "created_at", "source", "labelled", "log_loss", "baseline_log_loss"}},
	rows.FsrsActive:   {"study_fsrs_active", "", []string{"set_id", "changed_at"}},
}

// Tables lists the study table names (registry and deletion code use it).
func Tables() []string {
	out := make([]string, 0, len(rows.Families))
	for _, f := range rows.Families {
		out = append(out, tables[f].name)
	}
	return out
}

// TableOf is the table of a family.
func TableOf(f rows.Family) string { return tables[f].name }

const metaCols = "extra, version, updated_at, modified_at, deleted_at"

// stamp formats a time as stored: RFC 3339 UTC seconds.
func stamp(t time.Time) string { return t.UTC().Truncate(time.Second).Format(time.RFC3339) }

func jsonText(v any) string {
	raw, _ := json.Marshal(v)
	return string(raw)
}

func nullable[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// typedValues are the typed column values of a row, in table column order.
func typedValues(r rows.Row) []any {
	switch x := r.(type) {
	case *rows.Card:
		return []any{x.ID, x.Kind, x.EntryID, nullable(x.Written), nullable(x.EntryKind), nullable(x.SentenceID),
			jsonText(orEmpty(x.SkipKinds)), jsonText(orEmpty(x.DeckIDs)), x.CreatedAt}
	case *rows.Deck:
		var source any
		if x.Source != nil {
			source = jsonText(x.Source)
		}
		return []any{x.ID, x.Name, x.CreatedAt, source}
	case *rows.DeckSettingsRow:
		var order any
		if x.NewOrder != nil {
			order = jsonText(x.NewOrder)
		}
		return []any{x.DeckID, jsonText(orEmpty(x.CardTypes)), order}
	case *rows.LimitsRow:
		deck := ""
		if x.DeckID != nil {
			deck = *x.DeckID
		}
		var newLimit, reviewsLimit any
		if x.New != nil {
			newLimit = nullable(x.New.Limit)
		}
		if x.Reviews != nil {
			reviewsLimit = nullable(x.Reviews.Limit)
		}
		return []any{deck, boolInt(x.New != nil), newLimit, boolInt(x.Reviews != nil), reviewsLimit}
	case *rows.FsrsSet:
		return []any{x.ID, jsonText(orEmpty(x.W)), x.CreatedAt, x.Source, nullable(x.Labelled), nullable(x.LogLoss), nullable(x.BaselineLogLoss)}
	case *rows.FsrsActiveRow:
		return []any{nullable(x.SetID), nullable(x.ChangedAt)}
	}
	return nil
}

func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func extraText(e json.RawMessage) string {
	if len(strings.TrimSpace(string(e))) == 0 {
		return "{}"
	}
	return string(e)
}

// InsertStored inserts r for userID as stored elsewhere: version and the
// three stamps are written verbatim (the migration copies plugin_data's
// strings byte for byte). The row must not exist yet.
func InsertStored(ctx context.Context, q Querier, userID int64, r rows.Row, version int, updatedAt, modifiedAt string, deletedAt *string) error {
	t := tables[r.Family()]
	cols := append([]string{"user_id", "workspace_id"}, t.cols...)
	args := append([]any{userID, r.M().WorkspaceID}, typedValues(r)...)
	args = append(args, extraText(rowExtra(r)), version, updatedAt, modifiedAt, nullable(deletedAt))
	query := `INSERT INTO ` + t.name + ` (` + strings.Join(cols, ", ") + `, ` + metaCols + `) VALUES (` +
		strings.TrimSuffix(strings.Repeat("?, ", len(cols)+5), ", ") + `)`
	if _, err := q.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("study: insert %s %q: %w", r.Family(), r.Identity(), err)
	}
	return nil
}

// Insert inserts r keeping its meta: Version, UpdatedAt, ModifiedAt (zero:
// UpdatedAt) and DeletedAt. A restore uses it.
func Insert(ctx context.Context, q Querier, userID int64, r rows.Row) error {
	m := r.M()
	mod := m.ModifiedAt
	if mod.IsZero() {
		mod = m.UpdatedAt
	}
	var deleted *string
	if m.DeletedAt != nil {
		s := stamp(*m.DeletedAt)
		deleted = &s
	}
	return InsertStored(ctx, q, userID, r, m.Version, stamp(m.UpdatedAt), stamp(mod), deleted)
}

func rowExtra(r rows.Row) json.RawMessage {
	switch x := r.(type) {
	case *rows.Card:
		return x.Extra
	case *rows.Deck:
		return x.Extra
	case *rows.DeckSettingsRow:
		return x.Extra
	case *rows.LimitsRow:
		return x.Extra
	case *rows.FsrsSet:
		return x.Extra
	case *rows.FsrsActiveRow:
		return x.Extra
	}
	return nil
}

// selectCols is the column list scanRow reads.
func selectCols(f rows.Family) string {
	return "workspace_id, " + strings.Join(tables[f].cols, ", ") + ", " + metaCols
}

type scanner interface{ Scan(dest ...any) error }

func parseStamp(s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("study: parse timestamp %q: %w", s, err)
	}
	return t, nil
}

func decodeList[T any](text string, what string) ([]T, error) {
	out := []T{}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return nil, fmt.Errorf("study: stored %s %q: %w", what, text, err)
	}
	return out, nil
}

func strPtr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	s := n.String
	return &s
}

// scanRow reads one row of family f in selectCols order.
func scanRow(f rows.Family, sc scanner) (rows.Row, error) {
	var (
		ws                       int64
		extra, updated, modified string
		version                  int
		deleted                  sql.NullString
	)
	meta := []any{&extra, &version, &updated, &modified, &deleted}
	var r rows.Row
	var finish func() error
	switch f {
	case rows.Cards:
		c := &rows.Card{}
		var written, entryKind sql.NullString
		var sentence sql.NullInt64
		var skip, decks string
		dest := append([]any{&ws, &c.ID, &c.Kind, &c.EntryID, &written, &entryKind, &sentence, &skip, &decks, &c.CreatedAt}, meta...)
		if err := sc.Scan(dest...); err != nil {
			return nil, err
		}
		finish = func() (err error) {
			c.Written, c.EntryKind = strPtr(written), strPtr(entryKind)
			if sentence.Valid {
				n := sentence.Int64
				c.SentenceID = &n
			}
			if c.SkipKinds, err = decodeList[string](skip, "skip_kinds"); err != nil {
				return err
			}
			c.DeckIDs, err = decodeList[string](decks, "deck_ids")
			return err
		}
		r = c
	case rows.Decks:
		d := &rows.Deck{}
		var source sql.NullString
		if err := sc.Scan(append([]any{&ws, &d.ID, &d.Name, &d.CreatedAt, &source}, meta...)...); err != nil {
			return nil, err
		}
		finish = func() error {
			if !source.Valid {
				return nil
			}
			d.Source = &rows.DeckSource{}
			return d.Source.UnmarshalJSON([]byte(source.String))
		}
		r = d
	case rows.DeckSettings:
		s := &rows.DeckSettingsRow{}
		var types string
		var order sql.NullString
		if err := sc.Scan(append([]any{&ws, &s.DeckID, &types, &order}, meta...)...); err != nil {
			return nil, err
		}
		finish = func() (err error) {
			if s.CardTypes, err = decodeList[string](types, "card_types"); err != nil {
				return err
			}
			if order.Valid {
				s.NewOrder = &rows.NewOrder{}
				return s.NewOrder.UnmarshalJSON([]byte(order.String))
			}
			return nil
		}
		r = s
	case rows.Limits:
		l := &rows.LimitsRow{}
		var deck string
		var newSet, reviewsSet int
		var newLimit, reviewsLimit sql.NullInt64
		if err := sc.Scan(append([]any{&ws, &deck, &newSet, &newLimit, &reviewsSet, &reviewsLimit}, meta...)...); err != nil {
			return nil, err
		}
		field := func(set int, n sql.NullInt64) *rows.LimitField {
			if set == 0 {
				return nil
			}
			if !n.Valid {
				return &rows.LimitField{}
			}
			v := int(n.Int64)
			return &rows.LimitField{Limit: &v}
		}
		finish = func() error {
			if deck != "" {
				l.DeckID = &deck
			}
			l.New, l.Reviews = field(newSet, newLimit), field(reviewsSet, reviewsLimit)
			return nil
		}
		r = l
	case rows.FsrsSets:
		s := &rows.FsrsSet{}
		var w string
		var labelled, logLoss, baseline sql.NullFloat64
		if err := sc.Scan(append([]any{&ws, &s.ID, &w, &s.CreatedAt, &s.Source, &labelled, &logLoss, &baseline}, meta...)...); err != nil {
			return nil, err
		}
		finish = func() (err error) {
			for _, p := range []struct {
				n   sql.NullFloat64
				dst **float64
			}{{labelled, &s.Labelled}, {logLoss, &s.LogLoss}, {baseline, &s.BaselineLogLoss}} {
				if p.n.Valid {
					v := p.n.Float64
					*p.dst = &v
				}
			}
			s.W, err = decodeList[float64](w, "w")
			return err
		}
		r = s
	case rows.FsrsActive:
		a := &rows.FsrsActiveRow{}
		var setID, changed sql.NullString
		if err := sc.Scan(append([]any{&ws, &setID, &changed}, meta...)...); err != nil {
			return nil, err
		}
		finish = func() error {
			a.SetID, a.ChangedAt = strPtr(setID), strPtr(changed)
			return nil
		}
		r = a
	default:
		return nil, fmt.Errorf("study: unknown family %q", f)
	}
	if err := finish(); err != nil {
		return nil, fmt.Errorf("study: read %s: %w", f, err)
	}
	m := r.M()
	m.WorkspaceID, m.Version = ws, version
	var err error
	if m.UpdatedAt, err = parseStamp(updated); err != nil {
		return nil, err
	}
	if m.ModifiedAt, err = parseStamp(modified); err != nil {
		// An edit time no client wrote in RFC 3339 (a hand-made archive) must
		// not make the row unreadable: it counts as the write stamp.
		m.ModifiedAt = m.UpdatedAt
	}
	if deleted.Valid {
		d, err := parseStamp(deleted.String)
		if err != nil {
			return nil, err
		}
		m.DeletedAt = &d
	}
	setExtra(r, json.RawMessage(extra))
	return r, nil
}

func setExtra(r rows.Row, e json.RawMessage) {
	switch x := r.(type) {
	case *rows.Card:
		x.Extra = e
	case *rows.Deck:
		x.Extra = e
	case *rows.DeckSettingsRow:
		x.Extra = e
	case *rows.LimitsRow:
		x.Extra = e
	case *rows.FsrsSet:
		x.Extra = e
	case *rows.FsrsActiveRow:
		x.Extra = e
	}
}

// identityWhere is the WHERE clause naming one row of family f.
func identityWhere(f rows.Family) string {
	w := "user_id = ? AND workspace_id = ?"
	if id := tables[f].identity; id != "" {
		w += " AND " + id + " = ?"
	}
	return w
}

func identityArgs(f rows.Family, userID, workspaceID int64, identity string) []any {
	args := []any{userID, workspaceID}
	if tables[f].identity != "" {
		args = append(args, identity)
	}
	return args
}

// Load returns one row of the user, live or tombstoned; false when absent.
func Load(ctx context.Context, q Querier, userID, workspaceID int64, f rows.Family, identity string) (rows.Row, bool, error) {
	t, ok := tables[f]
	if !ok {
		return nil, false, fmt.Errorf("study: unknown family %q", f)
	}
	r, err := scanRow(f, q.QueryRowContext(ctx, `SELECT `+selectCols(f)+` FROM `+t.name+` WHERE `+identityWhere(f),
		identityArgs(f, userID, workspaceID, identity)...))
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("study: load %s %q: %w", f, identity, err)
	}
	return r, true, nil
}
