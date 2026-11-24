package dict

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"qinqin/internal/model"
)

// Installed is one installed dictionary as the dictionaries table holds it.
type Installed struct {
	ID                                                            int64
	Name, Version, License, Attribution, Notice, PackID, Language string
}

const installedColumns = `id, name, version, license, attribution, notice, pack_id, language`

func scanInstalled(row interface{ Scan(...any) error }) (Installed, error) {
	var d Installed
	err := row.Scan(&d.ID, &d.Name, &d.Version, &d.License, &d.Attribution, &d.Notice, &d.PackID, &d.Language)
	return d, err
}

// List returns every installed dictionary in install order, never nil.
func List(ctx context.Context, sqlDB *sql.DB) ([]Installed, error) {
	rows, err := sqlDB.QueryContext(ctx, `SELECT `+installedColumns+` FROM dictionaries WHERE deleted_at IS NULL ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]Installed, 0)
	for rows.Next() {
		d, err := scanInstalled(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, d)
	}
	return list, rows.Err()
}

// ByPack returns the installed dictionary of a pack id; ErrNotFound when
// it is not installed.
func ByPack(ctx context.Context, sqlDB *sql.DB, packID string) (Installed, error) {
	d, err := scanInstalled(sqlDB.QueryRowContext(ctx,
		`SELECT `+installedColumns+` FROM dictionaries WHERE pack_id = ? AND deleted_at IS NULL`, packID))
	if errors.Is(err, sql.ErrNoRows) {
		return Installed{}, ErrNotFound
	}
	return d, err
}

// PackOf returns the pack id of the dictionaries row id, installed or not,
// or "" when there is no such row.
func PackOf(ctx context.Context, sqlDB *sql.DB, id int64) (string, error) {
	var packID string
	err := sqlDB.QueryRowContext(ctx, `SELECT pack_id FROM dictionaries WHERE id = ?`, id).Scan(&packID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return packID, err
}

// Credits loads the credit (id, pack id, name, licence, attribution) of
// each dictionary id, keyed by id. Senses only load for active
// dictionaries, so the ids of an entry's senses are all found; an id
// without a row is an error.
func Credits(ctx context.Context, sqlDB *sql.DB, ids []int64) (map[int64]model.Dictionary, error) {
	out := map[int64]model.Dictionary{}
	for _, id := range ids {
		if _, ok := out[id]; ok {
			continue
		}
		var d model.Dictionary
		if err := sqlDB.QueryRowContext(ctx, `
			SELECT id, pack_id, name, license, attribution FROM dictionaries WHERE id = ?`,
			id).Scan(&d.ID, &d.PackID, &d.Name, &d.License, &d.Attribution); err != nil {
			return nil, fmt.Errorf("dictionary %d: %w", id, err)
		}
		out[id] = d
	}
	return out, nil
}
