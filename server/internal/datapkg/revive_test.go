package datapkg_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"

	"qinqin/internal/datapkg"
	"qinqin/internal/dbtest"
	"qinqin/internal/packs"
)

// A change of a manifest field the content hash does not cover (languages,
// requires) makes a new revision, so manifest.json and the catalogue row
// agree; a change of a catalogue-only field (optional) keeps the revision.
func TestManifestFieldsChangeMakeANewRevision(t *testing.T) {
	ctx := context.Background()
	clock := &testClock{now: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)}
	e := newPkgEnv(t, dbtest.Open(t), clock)
	pack := writePack(t, map[string]any{"id": "hw", "name": "Strokes", "type": "strokes", "languages": []string{"zh"}, "license": "Arphic Public License", "format": "hanzi-writer-jsonl-gz"},
		map[string][]byte{"strokes.jsonl.gz": gz(`{"char":"好","data":{"strokes":["M 1 2"]}}` + "\n"), "LICENSE": []byte("Arphic\n")})
	if _, err := packs.Import(ctx, e.db, pack, e.onChange()); err != nil {
		t.Fatal(err)
	}
	e.drain()
	row := func() datapkg.Row {
		t.Helper()
		cat, err := e.reg.Catalogue(ctx, []string{"all"}, true)
		if err != nil {
			t.Fatal(err)
		}
		k := slices.IndexFunc(cat.Packages, func(r datapkg.Row) bool { return r.ID == "strokes.hw" })
		if k < 0 {
			t.Fatalf("no strokes.hw in %+v", cat.Packages)
		}
		return cat.Packages[k]
	}
	manifest := func(r datapkg.Row) datapkg.Manifest {
		t.Helper()
		p := openPackage(t, filepath.Join(e.reg.Dir, r.ID, "r"+strconv.Itoa(r.Revision)+".qqpkg"))
		var m datapkg.Manifest
		if err := json.Unmarshal(p.members["manifest.json"], &m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	first := row()
	if first.Revision != 1 || !slices.Equal(manifest(first).Languages, []string{"zh"}) {
		t.Fatalf("first build: %+v", first)
	}

	clock.Add(time.Minute)
	if _, err := e.db.Exec(`UPDATE stroke_packs SET languages = '["ja","zh"]' WHERE pack_id = 'hw'`); err != nil {
		t.Fatal(err)
	}
	e.b.KickReconcile()
	e.drain()
	second := row()
	if second.Revision != 2 || second.State != "ready" || second.ContentHash != first.ContentHash {
		t.Fatalf("after a languages change: r%d %s hash changed=%v, want r2 ready, same hash", second.Revision, second.State, second.ContentHash != first.ContentHash)
	}
	if m := manifest(second); !slices.Equal(m.Languages, []string{"ja", "zh"}) || !slices.Equal(second.Languages, m.Languages) {
		t.Fatalf("manifest languages %v, catalogue %v", m.Languages, second.Languages)
	}

	// optional is not in the manifest: the revision stays.
	clock.Add(time.Minute)
	if _, err := e.db.Exec(`UPDATE packages SET optional = 1 WHERE id = 'strokes.hw'`); err != nil {
		t.Fatal(err)
	}
	e.b.KickReconcile()
	e.drain()
	if third := row(); third.Revision != 2 || third.Optional {
		t.Fatalf("after an optional change: r%d optional %v, want r2 optional false", third.Revision, third.Optional)
	}
}
