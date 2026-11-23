package datapkg_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"qinqin/internal/datapkg"
	"qinqin/internal/packs"
)

func importAll(t *testing.T, e *pkgEnv, ps ...string) {
	t.Helper()
	for _, p := range ps {
		var pk = map[string][3]string{
			"cedict/v1": {"dictionary", "cedict", "v1"}, "cedict/v2": {"dictionary", "cedict", "v2"},
			"unihan/v1": {"dictionary", "unihan", "v1"}, "hsk-words": {"levels", "hsk-words", "v1"},
		}[p]
		if _, err := packs.Import(context.Background(), e.db, versionPack(t, pk[0], pk[1], "zh", pk[2]), e.onChange()); err != nil {
			t.Fatal(err)
		}
		e.drain()
	}
}

func TestRetentionKeepsThePreviousRevisionSevenDays(t *testing.T) {
	ctx := context.Background()
	clock := &testClock{now: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)}
	e := newPkgEnv(t, newDB(t), clock)
	importAll(t, e, "cedict/v1", "cedict/v2")
	if got := revisionFiles(t, e.reg.Dir, "lexicon.zh"); !slices.Equal(got, []int{1, 2}) {
		t.Fatalf("files %v, want [1 2]", got)
	}
	var retire string
	if err := e.db.QueryRow(`SELECT retire_after FROM package_files WHERE id = 'lexicon.zh' AND revision = 1`).Scan(&retire); err != nil {
		t.Fatal(err)
	}
	if want := clock.Now().Add(7 * 24 * time.Hour).Format(time.RFC3339); retire != want {
		t.Fatalf("retire_after %s, want %s", retire, want)
	}
	f, info, err := e.reg.Open(ctx, "lexicon.zh", 1)
	if err != nil {
		t.Fatalf("r1 within retention: %v", err)
	}
	f.Close()
	if info.Bytes <= 0 || len(info.SHA256) != 64 {
		t.Fatalf("file info %+v", info)
	}

	// A stray temporary file of an interrupted build goes at the next reconcile.
	stray := filepath.Join(e.reg.Dir, "lexicon.zh-r9.qqpkg.tmp")
	if err := os.WriteFile(stray, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	clock.Add(7*24*time.Hour - time.Second)
	e.b.KickReconcile()
	e.drain()
	if got := revisionFiles(t, e.reg.Dir, "lexicon.zh"); !slices.Equal(got, []int{1, 2}) {
		t.Fatalf("one second before expiry: files %v, want [1 2]", got)
	}
	if _, err := os.Stat(stray); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stray .tmp file survived reconcile: %v", err)
	}
	clock.Add(2 * time.Second)
	e.b.KickReconcile()
	e.drain()
	if got := revisionFiles(t, e.reg.Dir, "lexicon.zh"); !slices.Equal(got, []int{2}) {
		t.Fatalf("after expiry: files %v, want [2]", got)
	}
	if _, _, err := e.reg.Open(ctx, "lexicon.zh", 1); !errors.Is(err, datapkg.ErrGone) {
		t.Fatalf("purged r1: %v, want ErrGone", err)
	}
	f, info, err = e.reg.Open(ctx, "lexicon.zh", 2)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(f)
	f.Close()
	if int64(len(body)) != info.Bytes {
		t.Fatalf("read %d bytes, info says %d", len(body), info.Bytes)
	}
	cat, err := e.reg.Catalogue(ctx, []string{"zh"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if row := cat.Packages[0]; row.SHA256 != info.SHA256 || row.Bytes != info.Bytes || row.URL == nil || *row.URL != "/api/packages/lexicon.zh/2" {
		t.Fatalf("catalogue row %+v does not match file %+v", row, info)
	}
	for _, bad := range []struct {
		id  string
		rev int
	}{{"lexicon.zh", 3}, {"lexicon.zh", 0}, {"lexicon.ja", 1}, {"../lexicon.zh", 2}, {"lexicon.zh/..", 2}, {"Lexicon.zh", 2}} {
		if _, _, err := e.reg.Open(ctx, bad.id, bad.rev); !errors.Is(err, datapkg.ErrNotFound) {
			t.Errorf("Open(%q, %d): %v, want ErrNotFound", bad.id, bad.rev, err)
		}
	}
}

func TestKickCoalescesAndWaitDrains(t *testing.T) {
	sqlDB := newDB(t)
	clock := &testClock{now: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)}
	reg := datapkg.Registry{DB: sqlDB, Dir: filepath.Join(t.TempDir(), "packages"), AudioDir: t.TempDir(), Now: clock.Now}
	if _, err := packs.Import(context.Background(), sqlDB, versionPack(t, "dictionary", "cedict", "zh", "v1")); err != nil {
		t.Fatal(err)
	}
	var builds atomic.Int32
	restore := datapkg.SetBuildHookForTest(func(id string) error { builds.Add(1); return nil })
	defer restore()
	b := datapkg.NewBuilder(reg, t.Logf)
	if b.Busy() {
		t.Fatal("Busy on a new builder")
	}
	for range 10 {
		b.Kick("lexicon.zh")
	}
	b.Kick("not a package id", "../x")
	if !b.Busy() {
		t.Fatal("Busy is false with a queued id")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go b.Run(ctx)
	wctx, wcancel := context.WithTimeout(ctx, time.Minute)
	defer wcancel()
	if err := b.Wait(wctx); err != nil {
		t.Fatal(err)
	}
	if n := builds.Load(); n != 1 {
		t.Fatalf("%d builds for ten kicks, want 1", n)
	}
	if b.Busy() {
		t.Fatal("Busy after Wait")
	}
	if got := revisionFiles(t, reg.Dir, "lexicon.zh"); !slices.Equal(got, []int{1}) {
		t.Fatalf("files %v", got)
	}
	// Wait on an idle builder returns at once.
	if err := b.Wait(wctx); err != nil {
		t.Fatal(err)
	}
}

func TestCatalogueLanguagesAdminETagInstance(t *testing.T) {
	ctx := context.Background()
	s := seedAll(t)
	clock := &testClock{now: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)}
	e := newPkgEnvIn(t, s.db, clock, s.audioDir)
	e.b.KickReconcile()
	e.drain()

	ids := func(c datapkg.Catalogue) []string {
		var out []string
		for _, r := range c.Packages {
			out = append(out, r.ID)
		}
		return out
	}
	ja, err := e.reg.Catalogue(ctx, []string{"ja"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"audio.ja-audio", "lemma-rules.ja-rules", "lexicon.ja", "strokes.hw"}; !slices.Equal(ids(ja), want) {
		t.Fatalf("ja catalogue %v, want %v", ids(ja), want)
	}
	if !slices.Equal(ja.Languages, []string{"ja"}) || ja.Format != 1 || ja.Building {
		t.Fatalf("ja top level %+v", ja)
	}
	var instance string
	if err := s.db.QueryRow(`SELECT value FROM server_meta WHERE key = 'instance_id'`).Scan(&instance); err != nil {
		t.Fatal(err)
	}
	if ja.InstanceID != instance {
		t.Fatalf("instanceId %q, want %q", ja.InstanceID, instance)
	}
	all, err := e.reg.Catalogue(ctx, []string{"all"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"audio.ja-audio", "components.zh-comp", "frequency.zh-freq", "grammar.zh-gram", "lemma-rules.ja-rules", "levels.zh-levels",
		"lexicon.ja", "lexicon.zh", "sentences.zh-sent", "strokes.hw"}; !slices.Equal(ids(all), want) {
		t.Fatalf("all catalogue %v, want %v", ids(all), want)
	}
	if !slices.Equal(all.Languages, []string{"ja", "zh"}) {
		t.Fatalf("all: languages %v", all.Languages)
	}
	none, err := e.reg.Catalogue(ctx, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(none.Packages) != 0 || none.Languages == nil || none.Packages == nil {
		t.Fatalf("no languages: %+v", none)
	}
	if none.ETag == ja.ETag || ja.ETag == all.ETag || ja.ETag == "" {
		t.Fatalf("ETags do not follow the language set: %q %q %q", none.ETag, ja.ETag, all.ETag)
	}
	again, _ := e.reg.Catalogue(ctx, []string{"ja"}, false)
	if again.ETag != ja.ETag {
		t.Fatalf("ETag not stable: %q then %q", ja.ETag, again.ETag)
	}

	// The keys of a row are exactly catalogue.json rowKeys; error only for
	// an administrator, only on a row whose last build failed.
	raw, err := os.ReadFile("../../../docs/contracts/packages/catalogue.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		TopKeys []string `json:"topKeys"`
		RowKeys []string `json:"rowKeys"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	checkKeys := func(c datapkg.Catalogue, errorOn string) {
		t.Helper()
		body, _ := json.Marshal(c)
		var top map[string]json.RawMessage
		json.Unmarshal(body, &top)
		if got := sortedKeys(top); !slices.Equal(got, sorted(fx.TopKeys)) {
			t.Fatalf("top keys %v, want %v", got, sorted(fx.TopKeys))
		}
		var rows []map[string]json.RawMessage
		json.Unmarshal(top["packages"], &rows)
		for _, r := range rows {
			want := sorted(fx.RowKeys)
			var id string
			json.Unmarshal(r["id"], &id)
			if id == errorOn {
				want = sorted(append(slices.Clone(fx.RowKeys), "error"))
			}
			if got := sortedKeys(r); !slices.Equal(got, want) {
				t.Fatalf("row %s keys %v, want %v", id, got, want)
			}
		}
	}
	checkKeys(all, "")

	// A failed rebuild of lexicon.ja: the row stays ready, the admin sees error.
	restore := datapkg.SetBuildHookForTest(func(id string) error {
		if id == "lexicon.ja" {
			return errors.New("injected")
		}
		return nil
	})
	clock.Add(time.Minute)
	e.b.Kick("lexicon.ja")
	e.drain()
	restore()
	admin, err := e.reg.Catalogue(ctx, []string{"all"}, true)
	if err != nil {
		t.Fatal(err)
	}
	checkKeys(admin, "lexicon.ja")
	user, _ := e.reg.Catalogue(ctx, []string{"all"}, false)
	checkKeys(user, "")
	if user.ETag == all.ETag {
		t.Fatal("ETag unchanged after a row changed")
	}
	if user.ETag == admin.ETag {
		t.Fatal("the admin and the user catalogue share an ETag")
	}
	zhOnly, _ := e.reg.Catalogue(ctx, []string{"zh"}, false)
	if zhOnly.ETag == "" {
		t.Fatal("no ETag")
	}
}

func TestKickAndCatalogueConcurrently(t *testing.T) {
	ctx := context.Background()
	clock := &testClock{now: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)}
	e := newPkgEnv(t, newDB(t), clock)
	importAll(t, e, "cedict/v1", "hsk-words")
	var wg sync.WaitGroup
	for g := range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range 20 {
				if g%2 == 0 {
					e.b.Kick("lexicon.zh", "levels.hsk-words")
				} else if _, err := e.reg.Catalogue(ctx, []string{"zh"}, i%2 == 0); err != nil {
					t.Error(err)
					return
				}
				_ = e.b.Busy()
			}
		}()
	}
	wg.Wait()
	e.drain()
	cat, err := e.reg.Catalogue(ctx, []string{"zh"}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range cat.Packages {
		if r.State != "ready" || r.Revision != 1 {
			t.Fatalf("row %s: %s r%d after equal rebuilds", r.ID, r.State, r.Revision)
		}
	}
}

func TestBuildingWhileBusy(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	clock := &testClock{now: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)}
	reg := datapkg.Registry{DB: sqlDB, Dir: filepath.Join(t.TempDir(), "packages"), Now: clock.Now}
	b := datapkg.NewBuilder(reg, t.Logf)
	b.KickReconcile()
	cat, err := b.Registry().Catalogue(ctx, []string{"all"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !cat.Building {
		t.Fatal("building false while a reconcile is queued")
	}
	rctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go b.Run(rctx)
	if err := b.Wait(rctx); err != nil {
		t.Fatal(err)
	}
	if cat, _ := b.Registry().Catalogue(ctx, []string{"all"}, false); cat.Building {
		t.Fatal("building true on an idle builder")
	}
}

func sortedKeys(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

func sorted(in []string) []string {
	out := slices.Clone(in)
	slices.Sort(out)
	return out
}

// Two registries on one directory and database (qinqin seed next to a
// running serve) build the same package at the same time: the builds take
// turns under <data>/packages/.lock, so neither deletes the other's
// temporary files and every ready row matches the file on disk.
func TestTwoRegistriesBuildOneDirectoryInTurn(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	clock := &testClock{now: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)}
	dir := filepath.Join(t.TempDir(), "packages")
	if _, err := packs.Import(ctx, sqlDB, versionPack(t, "dictionary", "cedict", "zh", "v1")); err != nil {
		t.Fatal(err)
	}
	// Each build waits (up to a bound) for the other registry's build of the
	// same id, so without the lock both run at once.
	var mu sync.Mutex
	arrived := map[string]int{}
	restore := datapkg.SetBuildHookForTest(func(id string) error {
		mu.Lock()
		arrived[id]++
		mu.Unlock()
		deadline := time.Now().Add(300 * time.Millisecond)
		for time.Now().Before(deadline) {
			mu.Lock()
			n := arrived[id]
			mu.Unlock()
			if n >= 2 {
				break
			}
			time.Sleep(5 * time.Millisecond)
		}
		return nil
	})
	defer restore()
	regs := []datapkg.Registry{
		{DB: sqlDB, Dir: dir, AudioDir: t.TempDir(), Now: clock.Now},
		{DB: sqlDB, Dir: dir, AudioDir: t.TempDir(), Now: clock.Now},
	}
	var wg sync.WaitGroup
	for _, r := range regs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := r.Reconcile(ctx); err != nil {
				t.Errorf("reconcile: %v", err)
			}
		}()
	}
	wg.Wait()
	cat, err := regs[0].Catalogue(ctx, []string{"all"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(cat.Packages) == 0 {
		t.Fatal("no packages")
	}
	for _, row := range cat.Packages {
		if row.State != "ready" || row.Error != "" {
			t.Errorf("row %s: %s %q", row.ID, row.State, row.Error)
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, row.ID, "r"+strconv.Itoa(row.Revision)+".qqpkg"))
		if err != nil {
			t.Errorf("row %s: %v", row.ID, err)
			continue
		}
		if got := sha(body); got != row.SHA256 || int64(len(body)) != row.Bytes {
			t.Errorf("row %s r%d: catalogue sha256 %s bytes %d, file %s bytes %d", row.ID, row.Revision, row.SHA256, row.Bytes, got, len(body))
		}
		f, info, err := regs[1].Open(ctx, row.ID, row.Revision)
		if err != nil {
			t.Errorf("open %s: %v", row.ID, err)
			continue
		}
		f.Close()
		if info.SHA256 != row.SHA256 {
			t.Errorf("row %s: package_files sha256 %s, packages %s", row.ID, info.SHA256, row.SHA256)
		}
	}
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Errorf("leftover %s", e.Name())
		}
	}
}
