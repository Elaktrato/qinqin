package sentences

import (
	"context"
	"database/sql"
)

// PackInfo is one registered sentence pack, for the Sources page.
type PackInfo struct {
	PackID, Name, Version, Language, License, Attribution, Notice string
}

// ListPacks returns the live registered sentence packs by name, then pack
// id, never nil. Legacy packs without a registry row have nothing to credit
// and are not listed.
func ListPacks(ctx context.Context, sqlDB *sql.DB) ([]PackInfo, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT pack_id, name, version, language, license, attribution, notice
		FROM sentence_packs WHERE deleted_at IS NULL ORDER BY name, pack_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []PackInfo{}
	for rows.Next() {
		var p PackInfo
		if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Notice); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, rows.Err()
}
