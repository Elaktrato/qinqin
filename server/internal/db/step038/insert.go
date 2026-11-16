// FROZEN with migration 038 (see rows.go): the study_* tables and columns as
// 038 created them, and the insert the Go step writes.

package step038

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

var tables = map[Family]struct {
	name string
	cols []string
}{
	Cards:        {"study_cards", []string{"id", "kind", "entry_id", "written", "entry_kind", "sentence_id", "skip_kinds", "deck_ids", "created_at"}},
	Decks:        {"study_decks", []string{"id", "name", "created_at", "source"}},
	DeckSettings: {"study_deck_settings", []string{"deck_id", "card_types", "new_order"}},
	Limits:       {"study_limits", []string{"deck_id", "new_set", "new_limit", "reviews_set", "reviews_limit"}},
	FsrsSets:     {"study_fsrs_sets", []string{"id", "w", "created_at", "source", "labelled", "log_loss", "baseline_log_loss"}},
	FsrsActive:   {"study_fsrs_active", []string{"set_id", "changed_at"}},
}

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

func typedValues(r Row) ([]any, json.RawMessage) {
	switch x := r.(type) {
	case *Card:
		return []any{x.ID, x.Kind, x.EntryID, nullable(x.Written), nullable(x.EntryKind), nullable(x.SentenceID),
			jsonText(orEmpty(x.SkipKinds)), jsonText(orEmpty(x.DeckIDs)), x.CreatedAt}, x.Extra
	case *Deck:
		var source any
		if x.Source != nil {
			source = jsonText(x.Source)
		}
		return []any{x.ID, x.Name, x.CreatedAt, source}, x.Extra
	case *DeckSettingsRow:
		var order any
		if x.NewOrder != nil {
			order = jsonText(x.NewOrder)
		}
		return []any{x.DeckID, jsonText(orEmpty(x.CardTypes)), order}, x.Extra
	case *LimitsRow:
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
		return []any{deck, boolInt(x.New != nil), newLimit, boolInt(x.Reviews != nil), reviewsLimit}, x.Extra
	case *FsrsSet:
		return []any{x.ID, jsonText(orEmpty(x.W)), x.CreatedAt, x.Source, nullable(x.Labelled), nullable(x.LogLoss), nullable(x.BaselineLogLoss)}, x.Extra
	case *FsrsActiveRow:
		return []any{nullable(x.SetID), nullable(x.ChangedAt)}, x.Extra
	}
	return nil, nil
}

// Insert writes r for userID into its 038 table with the plugin_data row's
// version and stamps verbatim (deletedAt nil = live).
func Insert(ctx context.Context, tx *sql.Tx, userID int64, r Row, version int, updatedAt, modifiedAt string, deletedAt *string) error {
	t := tables[r.Family()]
	values, extra := typedValues(r)
	if len(strings.TrimSpace(string(extra))) == 0 {
		extra = json.RawMessage(`{}`)
	}
	args := append([]any{userID, r.M().WorkspaceID}, values...)
	args = append(args, string(extra), version, updatedAt, modifiedAt, nullable(deletedAt))
	query := `INSERT INTO ` + t.name + ` (user_id, workspace_id, ` + strings.Join(t.cols, ", ") +
		`, extra, version, updated_at, modified_at, deleted_at) VALUES (` +
		strings.TrimSuffix(strings.Repeat("?, ", len(t.cols)+7), ", ") + `)`
	if _, err := tx.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("migration 038: insert %s %q: %w", r.Family(), r.Identity(), err)
	}
	return nil
}
