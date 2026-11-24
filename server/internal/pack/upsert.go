package pack

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Column is one column of a registry row an import writes. Value is its
// parameter; Expr, if set, is an SQL expression written instead (the next
// ord of the table). An InsertOnly column is written when the row is
// created and never again (an ord, a created_at), so it is not compared.
type Column struct {
	Name       string
	Value      any
	Expr       string
	InsertOnly bool
}

// Registry is the registry row of one pack: its table (a Descriptor's
// Registry), its pack id, the updated_at stamp a write sets, and every
// other column the import writes. Force writes the row even when no column
// differs: for a type whose data rows changed but whose registry row holds
// no fingerprint of them (audio, font).
type Registry struct {
	Table   string
	PackID  string
	Stamp   string
	Columns []Column
	Force   bool
}

// TermColumns are the columns of every registry: name, version, license,
// attribution and notice, followed by the type's own columns.
func TermColumns(name, version, license, attribution, notice string, own ...Column) []Column {
	return append([]Column{{Name: "name", Value: name}, {Name: "version", Value: version}, {Name: "license", Value: license},
		{Name: "attribution", Value: attribution}, {Name: "notice", Value: notice}}, own...)
}

// ManifestColumns are TermColumns of manifest m.
func ManifestColumns(m Manifest, own ...Column) []Column {
	return TermColumns(m.Name, m.Version, m.License, m.Attribution, m.Notice, own...)
}

// RowQuerier is what UpsertRegistry writes through (*sql.Tx).
type RowQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// UpsertRegistry writes the registry row r and returns its rowid (the id
// column of a table that has one) and whether it wrote. A new pack is
// inserted. An installed pack whose columns are all unchanged (IS NOT, so
// NULLs compare too) is not written: no restamp, no row changed, so
// re-importing an unchanged pack writes nothing. Otherwise every column
// but the insert-only ones is updated, updated_at is stamped and an
// uninstalled pack is revived (deleted_at NULL). The table must have a
// unique pack_id and the columns updated_at and deleted_at.
func UpsertRegistry(ctx context.Context, q RowQuerier, r Registry) (rowID int64, changed bool, err error) {
	names := []string{"pack_id"}
	values := []string{"?"}
	args := []any{r.PackID}
	var set, differs []string
	for _, c := range r.Columns {
		names = append(names, c.Name)
		if c.Expr != "" {
			values = append(values, c.Expr)
		} else {
			values = append(values, "?")
			args = append(args, c.Value)
		}
		if c.InsertOnly {
			continue
		}
		set = append(set, c.Name+" = excluded."+c.Name)
		differs = append(differs, r.Table+"."+c.Name+" IS NOT excluded."+c.Name)
	}
	names = append(names, "updated_at")
	values = append(values, "?")
	args = append(args, r.Stamp)
	set = append(set, "updated_at = excluded.updated_at", "deleted_at = NULL")
	differs = append(differs, r.Table+".deleted_at IS NOT NULL")
	query := `INSERT INTO ` + r.Table + ` (` + strings.Join(names, ", ") + `) VALUES (` + strings.Join(values, ", ") + `)
		ON CONFLICT (pack_id) DO UPDATE SET ` + strings.Join(set, ", ")
	if !r.Force {
		query += `
		WHERE ` + strings.Join(differs, " OR ")
	}
	query += `
		RETURNING rowid`
	err = q.QueryRowContext(ctx, query, args...).Scan(&rowID)
	if errors.Is(err, sql.ErrNoRows) {
		// Unchanged: the conflict update's WHERE skipped the write.
		if err := q.QueryRowContext(ctx, `SELECT rowid FROM `+r.Table+` WHERE pack_id = ?`, r.PackID).Scan(&rowID); err != nil {
			return 0, false, fmt.Errorf("read %s row of %s: %w", r.Table, r.PackID, err)
		}
		return rowID, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("write %s row of %s: %w", r.Table, r.PackID, err)
	}
	return rowID, true, nil
}
