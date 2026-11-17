package fonts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"sort"
)

// InstalledFace is one face of an installed pack with the credits of its
// pack, as GET /api/fonts lists it.
type InstalledFace struct {
	PackID string
	Face
	License, Attribution string
}

// Pack is the registry row of an installed font pack.
type Pack struct {
	PackID, Name, Version, License, Attribution, Notice, UpdatedAt string
}

// Faces returns every face of every installed font pack, ordered by face
// (sans, serif, kai), script (Hans, Hant, Jpan), style, the lower weight
// bound, then pack id; each face's slices in faces.json order.
func Faces(ctx context.Context, q Querier) ([]InstalledFace, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT s.pack_id, s.face, s.script, s.weight, s.style, s.original, s.sha, s.unicode_range, p.license, p.attribution
		FROM font_slices s JOIN font_packs p ON p.pack_id = s.pack_id AND p.deleted_at IS NULL
		ORDER BY s.pack_id, s.face, s.script, s.weight, s.style, s.ord`)
	if err != nil {
		return nil, fmt.Errorf("fonts: list faces: %w", err)
	}
	defer rows.Close()
	var out []InstalledFace
	for rows.Next() {
		var f InstalledFace
		var s Slice
		if err := rows.Scan(&f.PackID, &f.Face.Face, &f.Script, &f.Weight, &f.Style, &f.Original, &s.Sha, &s.UnicodeRange,
			&f.License, &f.Attribution); err != nil {
			return nil, fmt.Errorf("fonts: list faces: %w", err)
		}
		s.File = "slices/" + s.Sha + ".woff2"
		if n := len(out); n > 0 && out[n-1].PackID == f.PackID && out[n-1].Key() == f.Key() {
			out[n-1].Slices = append(out[n-1].Slices, s)
			continue
		}
		f.WeightLo, f.WeightHi, _ = ParseWeight(f.Weight)
		f.Slices = []Slice{s}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("fonts: list faces: %w", err)
	}
	rank := func(list []string, v string) int { return slices.Index(list, v) }
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		switch {
		case a.Face.Face != b.Face.Face:
			return rank(FaceOrder, a.Face.Face) < rank(FaceOrder, b.Face.Face)
		case a.Script != b.Script:
			return rank(ScriptOrder, a.Script) < rank(ScriptOrder, b.Script)
		case a.Style != b.Style:
			return rank(StyleOrder, a.Style) < rank(StyleOrder, b.Style)
		case a.WeightLo != b.WeightLo:
			return a.WeightLo < b.WeightLo
		}
		return a.PackID < b.PackID
	})
	return out, nil
}

// Packs returns the installed font packs by name, then id.
func Packs(ctx context.Context, q Querier) ([]Pack, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT pack_id, name, version, license, attribution, notice, updated_at
		FROM font_packs WHERE deleted_at IS NULL ORDER BY name, pack_id`)
	if err != nil {
		return nil, fmt.Errorf("fonts: list packs: %w", err)
	}
	defer rows.Close()
	var out []Pack
	for rows.Next() {
		var p Pack
		if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &p.License, &p.Attribution, &p.Notice, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("fonts: list packs: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Installed reports whether a slice of an installed pack has the sha256
// sha (GET /fonts/{file} serves only those).
func Installed(ctx context.Context, q Querier, sha string) (bool, error) {
	var one int
	err := q.QueryRowContext(ctx, `
		SELECT 1 FROM font_slices s JOIN font_packs p ON p.pack_id = s.pack_id AND p.deleted_at IS NULL
		WHERE s.sha = ? LIMIT 1`, sha).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
