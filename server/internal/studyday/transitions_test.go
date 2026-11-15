package studyday

import (
	"archive/zip"
	"path"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"
)

func stJohns(t *testing.T) History {
	t.Helper()
	h, err := New([]Change{{Zone: "America/St_Johns"}})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

// A DST end at 00:01 puts the wall clock back to 23:01 of the previous
// date; the date must not repeat and the windows must agree with DayOf.
func TestClockBackAcrossMidnightKeepsTheDate(t *testing.T) {
	h := stJohns(t)
	steps := []struct {
		at, day string
	}{
		{"2010-11-07T02:29:59Z", "2010-11-06"},
		{"2010-11-07T02:30:00Z", "2010-11-07"},
		{"2010-11-07T02:31:00Z", "2010-11-07"},
		{"2010-11-07T03:00:00Z", "2010-11-07"},
		{"2010-11-07T03:30:59Z", "2010-11-07"},
		{"2010-11-08T03:29:59Z", "2010-11-07"},
		{"2010-11-08T03:30:00Z", "2010-11-08"},
	}
	for _, s := range steps {
		if got := h.DayOf(mustTime(t, s.at)).String(); got != s.day {
			t.Errorf("DayOf(%s) = %s, want %s", s.at, got, s.day)
		}
	}
	d7, _ := ParseDate("2010-11-07")
	if got := h.DayStart(d7).Format(time.RFC3339); got != "2010-11-07T02:30:00Z" {
		t.Errorf("DayStart(2010-11-07) = %s", got)
	}
}

func allZoneNames(t *testing.T) []string {
	t.Helper()
	zr, err := zip.OpenReader(runtime.GOROOT() + "/lib/time/zoneinfo.zip")
	if err != nil {
		t.Skipf("no zoneinfo.zip: %v", err)
	}
	defer zr.Close()
	var names []string
	for _, f := range zr.File {
		if f.FileInfo().IsDir() || strings.HasPrefix(path.Base(f.Name), ".") {
			continue
		}
		if ValidZone(f.Name) {
			names = append(names, f.Name)
		}
	}
	sort.Strings(names)
	return names
}

// For EVERY zone of the database and every offset transition from 1970
// to 2040, probes around the transition show that DayOf never decreases,
// never jumps by more than one date, and agrees with the day windows.
func TestEveryZoneEveryTransition(t *testing.T) {
	names := allZoneNames(t)
	if len(names) < 400 {
		t.Fatalf("only %d zones", len(names))
	}
	offs := []time.Duration{-26 * time.Hour, -3 * time.Hour, -90 * time.Minute, -time.Hour, -30 * time.Minute, -time.Second, 0, time.Second, 30 * time.Minute, time.Hour, 90 * time.Minute, 3 * time.Hour, 26 * time.Hour}
	end := time.Date(2040, 1, 1, 0, 0, 0, 0, time.UTC)
	transitions := 0
	for _, name := range names {
		h, err := New([]Change{{Zone: name}})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		loc := h.locs[0]
		cur := time.Unix(0, 0).UTC()
		for cur.Before(end) {
			_, next := cur.In(loc).ZoneBounds()
			if next.IsZero() || !next.After(cur) {
				break
			}
			cur = next
			if cur.After(end) {
				break
			}
			transitions++
			var prev Date
			var haveWindows bool
			var ws []Window
			first := h.DayOf(cur.Add(-30 * time.Hour))
			ws = h.Windows(first, first.AddDays(4))
			haveWindows = len(ws) == 5
			for i, o := range offs {
				at := cur.Add(o)
				d := h.DayOf(at)
				if i > 0 && d.Before(prev) {
					t.Fatalf("%s: DayOf decreased to %s at %s", name, d, at.Format(time.RFC3339))
				}
				if i > 0 && prev.DaysUntil(d) > 3 {
					t.Fatalf("%s: DayOf jumped %s -> %s at %s", name, prev, d, at.Format(time.RFC3339))
				}
				prev = d
				if !haveWindows || d.Before(first) || first.AddDays(4).Before(d) {
					continue
				}
				w := ws[first.DaysUntil(d)]
				if at.Before(w.Start) || !at.Before(w.End) {
					t.Fatalf("%s: %s is %s but window %s is [%s, %s)", name, at.Format(time.RFC3339), d, w.Day, w.Start.Format(time.RFC3339), w.End.Format(time.RFC3339))
				}
			}
		}
	}
	if transitions < 5000 {
		t.Fatalf("only %d transitions probed", transitions)
	}
	t.Logf("%d zones, %d transitions", len(names), transitions)
}

// DayStart is the first instant of its date for every zone (single-zone
// histories): the instant before belongs to an earlier date.
func TestEveryZoneDayStartIsTheFirstInstant(t *testing.T) {
	names := allZoneNames(t)
	dates := []string{"1970-01-01", "1999-12-31", "2000-02-29", "2011-12-30", "2018-02-18", "2024-09-08", "2026-03-29", "2026-10-25", "2026-11-15", "2037-06-30"}
	for _, name := range names {
		h, _ := New([]Change{{Zone: name}})
		for _, ds := range dates {
			d, _ := ParseDate(ds)
			s := h.DayStart(d)
			if h.DayOf(s).Before(d) {
				t.Fatalf("%s %s: DayOf(DayStart) = %s", name, ds, h.DayOf(s))
			}
			if s.Unix() > 0 && !h.DayOf(s.Add(-time.Second)).Before(d) {
				t.Fatalf("%s %s: start %s is not the first instant", name, ds, s.Format(time.RFC3339))
			}
		}
	}
}
