package backup

import (
	"time"

	"qinqin/internal/grammar"
	"qinqin/internal/journal"
	"qinqin/internal/keyed"
	"qinqin/internal/study/rows"
)

// Typed study rows (migration 038) travel in an archive in their keyed
// form (docs/contracts/backup/README.md). A restore remaps them like any row
// (workspace, card ids, entries, sentences) and then decodes them with the
// keyed-row codec into the typed tables; one the codec refuses is dropped and
// counted.

// typedRow decodes a remapped row of a typed study family: typed is false for
// every other row; ok is false when the row must be dropped (it has no
// workspace, or the codec cannot read it).
func typedRow(r Row) (row rows.Row, typed, ok bool) {
	if _, isTyped := rows.FamilyOf(r.Key); !isTyped {
		return nil, false, false
	}
	if r.WorkspaceID == nil {
		return nil, true, false
	}
	x, err := rows.FromLegacy(r.Key, r.Data)
	if err != nil {
		return nil, true, false
	}
	x.M().WorkspaceID = *r.WorkspaceID
	if rows.Validate(x) != nil {
		return nil, true, false
	}
	return x, true, true
}

// restoredModified is the edit time a restored typed row keeps: the
// archive's modifiedAt, else its updatedAt (a row no client stamped), else
// the restore time; always RFC 3339 UTC seconds, since last-write-wins
// compares it, and never after the restore time (an edit time in the future
// would win every later write).
func restoredModified(r Row, now string) string {
	limit, limitErr := time.Parse(time.RFC3339, now)
	for _, s := range []*string{r.ModifiedAt, &r.UpdatedAt} {
		if s == nil {
			continue
		}
		if t, err := time.Parse(time.RFC3339, *s); err == nil {
			if limitErr == nil && t.After(limit) {
				return now
			}
			return t.UTC().Truncate(time.Second).Format(time.RFC3339)
		}
	}
	return now
}

// rowKind is where a remapped archive row goes on a restore.
type rowKind int

const (
	kindDrop    rowKind = iota // no store takes it: dropped and counted
	kindKeyed                  // a keyed settings row (internal/keyed)
	kindTyped                  // a typed study row in its keyed form
	kindJournal                // a journal document in its keyed form
	kindGrammar                // grammar lesson progress in its keyed form
)

// kindOf decides where a remapped row goes; a keyed row of no family or in
// the wrong scope, and every other key, is dropped.
func kindOf(r Row) rowKind {
	switch {
	case journal.IsKeyed(r.Key):
		return kindJournal
	case grammar.IsKeyed(r.Key):
		return kindGrammar
	}
	if _, typed := rows.FamilyOf(r.Key); typed {
		return kindTyped
	}
	if keyed.Check(r.Key, r.WorkspaceID) == nil {
		return kindKeyed
	}
	return kindDrop
}
