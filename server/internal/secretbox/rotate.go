package secretbox

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// Column describes one sealed value of a table: where the ciphertext, nonce
// and secret fingerprint live, which columns identify the row, and the AAD
// of a row. Names are code constants, never user input.
type Column struct {
	Table    string
	Keys     []string // identifying columns (their scanned values reach AAD)
	Ct       string
	Nonce    string
	FP       string
	AAD      func(keys []any) (string, error)
	NotNull  string // optional extra condition, e.g. "pending_ct IS NOT NULL"
	Describe string // for errors only
}

// Rotator re-seals values sealed under the previous secret with the current
// one. Rows that neither secret opens are left untouched.
type Rotator struct{ Current, Previous *Sealer }

// Active reports whether there is anything to rotate between.
func (r Rotator) Active() bool {
	return r.Current != nil && r.Previous != nil && r.Previous.Fingerprint() != r.Current.Fingerprint()
}

// Rotate re-seals every row of c whose fingerprint is Previous's, inside tx,
// and returns how many moved. A row that does not open under Previous is
// skipped (it stays undecryptable); a write failure aborts.
func (r Rotator) Rotate(ctx context.Context, tx *sql.Tx, c Column) (int, error) {
	if !r.Active() {
		return 0, nil
	}
	query := `SELECT ` + strings.Join(append(append([]string{}, c.Keys...), c.Ct, c.Nonce), ", ") +
		` FROM ` + c.Table + ` WHERE ` + c.FP + ` = ?`
	if c.NotNull != "" {
		query += ` AND ` + c.NotNull
	}
	rows, err := tx.QueryContext(ctx, query, r.Previous.Fingerprint())
	if err != nil {
		return 0, fmt.Errorf("rotate %s: %w", c.Table, err)
	}
	type old struct {
		keys      []any
		ct, nonce []byte
	}
	var olds []old
	for rows.Next() {
		o := old{keys: make([]any, len(c.Keys))}
		dest := make([]any, 0, len(c.Keys)+2)
		for i := range o.keys {
			dest = append(dest, &o.keys[i])
		}
		dest = append(dest, &o.ct, &o.nonce)
		if err := rows.Scan(dest...); err != nil {
			rows.Close()
			return 0, fmt.Errorf("rotate %s: %w", c.Table, err)
		}
		olds = append(olds, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("rotate %s: %w", c.Table, err)
	}
	where := make([]string, len(c.Keys))
	for i, k := range c.Keys {
		where[i] = k + " = ?"
	}
	update := `UPDATE ` + c.Table + ` SET ` + c.Ct + ` = ?, ` + c.Nonce + ` = ?, ` + c.FP + ` = ? WHERE ` + strings.Join(where, " AND ")
	n := 0
	for _, o := range olds {
		aad, err := c.AAD(o.keys)
		if err != nil {
			continue
		}
		plain, err := r.Previous.Open(o.ct, o.nonce, aad)
		if err != nil {
			continue
		}
		ct, nonce, err := r.Current.Seal(plain, aad)
		if err != nil {
			return 0, err
		}
		args := append([]any{ct, nonce, r.Current.Fingerprint()}, o.keys...)
		if _, err := tx.ExecContext(ctx, update, args...); err != nil {
			return 0, fmt.Errorf("rotate %s: %w", c.Table, err)
		}
		n++
	}
	return n, nil
}
