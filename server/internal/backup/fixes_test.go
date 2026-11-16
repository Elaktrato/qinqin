package backup

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// exportFiles exports a user and returns the entries (without the manifest).
func exportFiles(t *testing.T, w *baseWorld, uid int64) map[string][]byte {
	t.Helper()
	data, _ := exportBytes(t, w, uid)
	files, _ := unzipAll(t, data)
	delete(files, NameManifest)
	return files
}

// worldCounts sets the manifest counts of newWorld's alice, with overrides.
func worldCounts(over map[string]int) func(m map[string]any) {
	return func(m map[string]any) {
		c := map[string]any{"workspaces": 2, "events": 4, "pluginData": 5, "overlays": 1, "sentences": 1, "books": 1, "bookmarks": 1, "highlights": 1}
		for k, v := range over {
			c[k] = v
		}
		m["counts"] = c
	}
}

func TestSafetyExportsKeepTheLastThreeOrAWeek(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)
	mk := func(name string, age time.Duration) {
		p := filepath.Join(dir, name)
		os.WriteFile(p, []byte("z"), 0o600)
		os.Chtimes(p, now.Add(-age), now.Add(-age))
	}
	mk("20260101-000000.000.zip", 40*24*time.Hour)
	mk("20260301-000000.000.zip", 30*24*time.Hour)
	mk("20261101-000000.000.zip", 15*24*time.Hour)
	mk("20261110-000000.000.zip", 6*24*time.Hour) // within a week: kept even beyond the newest three
	mk("20261114-000000.000.zip", 2*24*time.Hour)
	mk("20261115-000000.000.zip", 1*24*time.Hour)
	mk("20261116-000000.000.zip", time.Hour)
	pruneSafetyDir(dir, now)
	got := dirNames(dir)
	want := []string{"20261110-000000.000.zip", "20261114-000000.000.zip", "20261115-000000.000.zip", "20261116-000000.000.zip"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("kept %v, want %v", got, want)
	}
	dir2 := t.TempDir()
	p := filepath.Join(dir2, "20200101-000000.000.zip")
	os.WriteFile(p, []byte("z"), 0o600)
	os.Chtimes(p, now.Add(-900*24*time.Hour), now.Add(-900*24*time.Hour))
	pruneSafetyDir(dir2, now)
	if len(dirNames(dir2)) != 1 {
		t.Error("the only copy was deleted")
	}
}

func TestRestoreNormalisesEventTimestampsToUTC(t *testing.T) {
	src := newWorld(t)
	files := exportFiles(t, src, src.AliceUID)
	name := PartName(FamEvents, 1)
	var out []string
	stamps := []string{"2026-11-10T11:00:00+02:00", "2026-11-10T09:00:00.987654Z", "2026-11-10T09:30:00-05:00", "2026-11-10T09:45:00Z"}
	for i, l := range lines(files[name]) {
		var e map[string]any
		json.Unmarshal([]byte(l), &e)
		e["ts"] = stamps[i%len(stamps)]
		b, _ := json.Marshal(e)
		out = append(out, string(b))
	}
	files[name] = []byte(strings.Join(out, "\n") + "\n")
	a, err := Open(writeZip(t, files, zopts{manifest: worldCounts(nil)}))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	tg := newTarget(t, nil)
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true}); err != nil {
		t.Fatal(err)
	}
	rs, _ := tg.DB.Query(`SELECT ts FROM study_events WHERE user_id = ? ORDER BY ts`, tg.UID)
	var got []string
	for rs.Next() {
		var ts string
		rs.Scan(&ts)
		got = append(got, ts)
	}
	rs.Close()
	want := []string{"2026-11-10T09:00:00Z", "2026-11-10T09:00:00Z", "2026-11-10T09:45:00Z", "2026-11-10T14:30:00Z"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("stored %v, want %v (UTC, whole seconds, like a normal push)", got, want)
	}
}

func TestRestoreInChunksKeepsIdsConflictsAndDuplicates(t *testing.T) {
	oldC, oldS := eventChunk, eventStmtRows
	eventChunk, eventStmtRows = 3, 2
	t.Cleanup(func() { eventChunk, eventStmtRows = oldC, oldS })
	src := newWorld(t)
	files := exportFiles(t, src, src.AliceUID)
	name := PartName(FamEvents, 1)
	ls := lines(files[name])
	var e map[string]any
	json.Unmarshal([]byte(ls[1]), &e)
	e["id"] = "01JD0000000000000000TAKEN1"
	b, _ := json.Marshal(e)
	files[name] = []byte(strings.Join(append(ls, ls[0], string(b)), "\n") + "\n")
	a, err := Open(writeZip(t, files, zopts{manifest: worldCounts(map[string]int{"events": 6})}))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	tg := newTarget(t, nil)
	carol := mkUser(t, tg.DB, "carol")
	exec(t, tg.DB, `INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, 'zh', '', '{}', 't')`, carol)
	var cw int64
	tg.DB.QueryRow(`SELECT id FROM workspaces WHERE user_id = ?`, carol).Scan(&cw)
	exec(t, tg.DB, `INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES ('01JD0000000000000000TAKEN1', ?, ?, 'd', 't', 'view', '{}', 't')`, carol, cw)
	res, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true})
	if err != nil {
		t.Fatal(err)
	}
	var n int
	tg.DB.QueryRow(`SELECT COUNT(*) FROM study_events WHERE user_id = ?`, tg.UID).Scan(&n)
	if n != 5 || res.ReidentifiedEvents != 1 {
		t.Errorf("alice has %d events (want 4 + 1 reidentified), reidentified %d", n, res.ReidentifiedEvents)
	}
	var owner int64
	tg.DB.QueryRow(`SELECT user_id FROM study_events WHERE id = '01JD0000000000000000TAKEN1'`).Scan(&owner)
	if owner != carol {
		t.Error("carol's event was taken over")
	}
}

func TestOpenRefusesMoreEventsThanTheCap(t *testing.T) {
	old := capEvents
	capEvents = 3
	t.Cleanup(func() { capEvents = old })
	w := newWorld(t)
	data, _ := exportBytes(t, w, w.AliceUID)
	p := filepath.Join(t.TempDir(), "x.zip")
	os.WriteFile(p, data, 0o644)
	_, err := Open(p)
	var ie *InvalidError
	if !errors.As(err, &ie) || ie.Code != CodeTooManyEvents {
		t.Fatalf("error %v, want %s", err, CodeTooManyEvents)
	}
}

func TestPlanBlocksTwoCardsThatWouldGetTheSameId(t *testing.T) {
	src := newWorld(t)
	tg := newTarget(t, nil)
	files := exportFiles(t, src, src.AliceUID)
	row := func(key string, entry int64) string {
		return `{"pluginId":"qinqin-flashcards","workspaceId":` + itoa64(src.Alice.WS1) + `,"key":"card:` + key + `","data":{"id":"` + key + `","entryId":` + itoa64(entry) + `},"version":1,"updatedAt":"t","modifiedAt":null}` + "\n"
	}
	// card 1 is derived (c-vocab-<E1> of entry E1) and moves to c-vocab-<target E1>; card 2 is NOT derived
	// (its number is not its own entry) and keeps the id c-vocab-<target E1>.
	files[PartName(NamePluginData, 1)] = []byte(row("c-vocab-"+itoa64(src.E1), src.E1) + row("c-vocab-"+itoa64(tg.E1), src.E2))
	a, err := Open(writeZip(t, files, zopts{manifest: worldCounts(map[string]int{"pluginData": 2})}))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	rep, _, err := Plan(context.Background(), tg.DB, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Blocking) != 1 || !strings.Contains(rep.Blocking[0], "same id") {
		t.Errorf("blocking %v", rep.Blocking)
	}
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true}); !errors.Is(err, ErrBlocked) {
		t.Errorf("restore: %v, want ErrBlocked (a ready stage must never fail on a unique key)", err)
	}
}

func TestPlanIgnoresSentencesOfOtherUsersWhenResolvingPackSentences(t *testing.T) {
	w := newWorld(t)
	a := openExport(t, w, w.AliceUID)
	tg := newTarget(t, nil)
	other := mkUser(t, tg.DB, "carol")
	exec(t, tg.DB, `INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (?, 'tatoeba', ?, 'packsatz', 'p', 't', 't')`, tg.E2, other)
	_, m, err := Plan(context.Background(), tg.DB, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := m.Sentences[w.Alice.PackSent]; ok {
		t.Error("a sentence owned by another user was taken for a pack sentence")
	}
}
