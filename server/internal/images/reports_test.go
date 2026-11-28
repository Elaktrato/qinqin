package images_test

import (
	"context"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/images"
	"qinqin/internal/lexicon"
)

// At most MaxReportsPerUser reports are kept per user: the oldest goes first.
func TestPictureReportsAreCapped(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	uid := dbtest.User(t, sqlDB, "u")
	var dictID int64
	if err := sqlDB.QueryRow(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('d', 'd', '1', 'x', 'x', '2026-01-01T00:00:00Z') RETURNING id`).Scan(&dictID); err != nil {
		t.Fatal(err)
	}
	var ids []int64
	for _, k := range []string{"a", "b"} {
		id, err := lexicon.Store{DB: sqlDB}.Put(ctx, &lexicon.Entry{Language: "zh", Kind: "word", Key: k}, dictID)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if _, err := sqlDB.Exec(`INSERT INTO image_packs (pack_id, name, version, languages, license, attribution, updated_at) VALUES ('p', 'p', '1', '["zh"]', 'x', 'x', 't')`); err != nil {
		t.Fatal(err)
	}
	for _, c := range []string{"A", "B", "C", "D"} {
		if _, err := sqlDB.Exec(`INSERT INTO image_pictures (pack_id, concept, label, credit, svg) VALUES ('p', ?, ?, 'c', '<svg/>')`, c, c); err != nil {
			t.Fatal(err)
		}
	}
	images.SetMaxReportsForTest(t, 3)
	for i, c := range []string{"A", "B", "C", "D"} {
		if err := images.Report(ctx, sqlDB, uid, ids[i%2], "p", c, "wrong"); err != nil {
			t.Fatal(err)
		}
	}
	got, err := images.Reported(ctx, sqlDB, uid)
	if err != nil {
		t.Fatal(err)
	}
	var concepts []string
	for _, r := range got {
		concepts = append(concepts, r.Concept)
	}
	slices.Sort(concepts)
	if !slices.Equal(concepts, []string{"B", "C", "D"}) {
		t.Errorf("kept %+v, want B, C, D", got)
	}
	if err := images.Report(ctx, sqlDB, uid, ids[0], "p", "A", "ugly"); err != images.ErrBadReason {
		t.Errorf("a bad reason = %v", err)
	}
}
