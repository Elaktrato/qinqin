package studyday

import (
	"math/rand"
	"testing"
	"time"
)

func TestDateArith(t *testing.T) {
	cases := []struct {
		in   string
		n    int
		want string
	}{
		{"2024-02-28", 1, "2024-02-29"},
		{"2024-02-29", 1, "2024-03-01"},
		{"2023-02-28", 1, "2023-03-01"},
		{"2026-01-01", -1, "2025-12-31"},
		{"2026-12-31", 1, "2027-01-01"},
		{"2026-03-31", 1, "2026-04-01"},
		{"2026-11-15", 0, "2026-11-15"},
		{"2026-11-15", 366, "2027-11-16"},
		{"2000-02-29", 365, "2001-02-28"},
		{"1970-01-01", -1, "1969-12-31"},
	}
	for _, c := range cases {
		d, err := ParseDate(c.in)
		if err != nil {
			t.Fatal(err)
		}
		if got := d.AddDays(c.n).String(); got != c.want {
			t.Errorf("%s + %d = %s, want %s", c.in, c.n, got, c.want)
		}
	}
	a, _ := ParseDate("2024-02-28")
	b, _ := ParseDate("2025-02-28")
	if n := a.DaysUntil(b); n != 366 {
		t.Errorf("DaysUntil = %d, want 366", n)
	}
	if n := b.DaysUntil(a); n != -366 {
		t.Errorf("DaysUntil back = %d, want -366", n)
	}
	if !a.Before(b) || b.Before(a) || a.Before(a) {
		t.Error("Before")
	}
	for _, bad := range []string{"", "2026-13-01", "2026-02-30", "26-01-01", "2026-1-1", "2026-01-01x", "2026/01/01", " 2026-01-01"} {
		if _, err := ParseDate(bad); err == nil {
			t.Errorf("ParseDate(%q) accepted", bad)
		}
	}
}

func TestNewRejects(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	t1 := t0.Add(time.Hour)
	cases := map[string][]Change{
		"empty zone":          {{Zone: ""}},
		"unknown zone":        {{Zone: "Mars/Base"}},
		"second without from": {{Zone: "UTC"}, {Zone: "Asia/Tokyo"}},
		"first with from":     {{Zone: "UTC", From: &t0}},
		"equal from":          {{Zone: "UTC"}, {Zone: "Asia/Tokyo", From: &t1}, {Zone: "Europe/Berlin", From: &t1}},
		"decreasing from":     {{Zone: "UTC"}, {Zone: "Asia/Tokyo", From: &t1}, {Zone: "Europe/Berlin", From: &t0}},
	}
	for name, ch := range cases {
		if _, err := New(ch); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if h, err := New(nil); err != nil || h.Zone() != "UTC" {
		t.Errorf("New(nil) = %v, %v", h.Zone(), err)
	}
}

func TestWindowsEmptyDay(t *testing.T) {
	h, _ := New([]Change{{Zone: "Pacific/Apia"}})
	from, _ := ParseDate("2011-12-29")
	to, _ := ParseDate("2011-12-31")
	ws := h.Windows(from, to)
	if len(ws) != 3 {
		t.Fatalf("%d windows", len(ws))
	}
	if !ws[1].Start.Equal(ws[1].End) || ws[1].Day.String() != "2011-12-30" {
		t.Errorf("window 2011-12-30 = %v", ws[1])
	}
	for i := 1; i < len(ws); i++ {
		if !ws[i-1].End.Equal(ws[i].Start) {
			t.Errorf("windows %d/%d not contiguous", i-1, i)
		}
	}
	if d := ws[2].End.Sub(ws[2].Start); d != 24*time.Hour {
		t.Errorf("2011-12-31 lasts %v", d)
	}
	if got := h.Windows(to, from); len(got) != 0 {
		t.Errorf("reversed range gave %d windows", len(got))
	}
}

func TestWindowsDSTLengths(t *testing.T) {
	h, _ := New([]Change{{Zone: "Europe/Berlin"}})
	d := func(s string) Date { v, _ := ParseDate(s); return v }
	for day, want := range map[string]time.Duration{"2025-03-30": 23 * time.Hour, "2025-10-26": 25 * time.Hour, "2025-06-01": 24 * time.Hour} {
		ws := h.Windows(d(day), d(day))
		if got := ws[0].End.Sub(ws[0].Start); got != want {
			t.Errorf("%s lasts %v, want %v", day, got, want)
		}
	}
}

// Every window contains exactly the instants whose DayOf is its day.
func TestWindowsAgreeWithDayOf(t *testing.T) {
	ts := func(s string) *time.Time { v := mustTime(t, s); return &v }
	hists := map[string]History{}
	hists["west"], _ = New([]Change{{Zone: "Asia/Tokyo"}, {Zone: "America/Los_Angeles", From: ts("2026-11-10T16:00:00Z")}})
	hists["east"], _ = New([]Change{{Zone: "Europe/Berlin"}, {Zone: "Asia/Tokyo", From: ts("2026-11-10T12:00:00Z")}})
	hists["skip"], _ = New([]Change{{Zone: "Etc/GMT+12"}, {Zone: "Pacific/Kiritimati", From: ts("2026-11-10T11:00:00Z")}})
	hists["apia"], _ = New([]Change{{Zone: "Pacific/Apia"}})
	hists["round trip"], _ = New([]Change{{Zone: "Asia/Tokyo"}, {Zone: "America/Los_Angeles", From: ts("2026-11-10T16:00:00Z")}, {Zone: "Asia/Tokyo", From: ts("2026-11-11T20:00:00Z")}, {Zone: "Pacific/Auckland", From: ts("2026-11-11T20:00:01Z")}})
	hists["lord howe"], _ = New([]Change{{Zone: "Australia/Lord_Howe"}})
	from, _ := ParseDate("2011-12-20")
	spans := map[string][2]time.Time{
		"west":       {mustTime(t, "2026-11-08T00:00:00Z"), mustTime(t, "2026-11-14T00:00:00Z")},
		"east":       {mustTime(t, "2026-11-08T00:00:00Z"), mustTime(t, "2026-11-14T00:00:00Z")},
		"skip":       {mustTime(t, "2026-11-08T00:00:00Z"), mustTime(t, "2026-11-14T00:00:00Z")},
		"apia":       {mustTime(t, "2011-12-27T00:00:00Z"), mustTime(t, "2012-01-03T00:00:00Z")},
		"round trip": {mustTime(t, "2026-11-08T00:00:00Z"), mustTime(t, "2026-11-16T00:00:00Z")},
		"lord howe":  {mustTime(t, "2025-04-04T00:00:00Z"), mustTime(t, "2025-04-08T00:00:00Z")},
	}
	_ = from
	for name, h := range hists {
		sp := spans[name]
		first := h.DayOf(sp[0])
		last := h.DayOf(sp[1])
		ws := h.Windows(first, last)
		if len(ws) != first.DaysUntil(last)+1 {
			t.Fatalf("%s: %d windows for %d days", name, len(ws), first.DaysUntil(last)+1)
		}
		// Check at every 5-minute step of the span (and second boundaries around each window edge).
		check := func(at time.Time) {
			d := h.DayOf(at)
			if d.Before(first) || last.Before(d) {
				return
			}
			w := ws[first.DaysUntil(d)]
			if w.Day != d || at.Before(w.Start) || !at.Before(w.End) {
				t.Fatalf("%s: %s has DayOf %s but window %s is [%s, %s)", name, at.Format(time.RFC3339), d, w.Day, w.Start.Format(time.RFC3339), w.End.Format(time.RFC3339))
			}
		}
		for at := sp[0]; at.Before(sp[1]); at = at.Add(5 * time.Minute) {
			check(at)
		}
		for _, w := range ws {
			for _, e := range []time.Time{w.Start, w.End} {
				check(e.Add(-time.Second))
				check(e)
				check(e.Add(time.Second))
			}
		}
	}
}

func TestDayOfMonotone(t *testing.T) {
	ts := func(s string) *time.Time { v := mustTime(t, s); return &v }
	hists := map[string]History{}
	hists["west"], _ = New([]Change{{Zone: "Asia/Tokyo"}, {Zone: "America/Los_Angeles", From: ts("2026-11-10T16:00:00Z")}})
	hists["round trip"], _ = New([]Change{{Zone: "Asia/Tokyo"}, {Zone: "America/Los_Angeles", From: ts("2026-11-10T16:00:00Z")}, {Zone: "Asia/Tokyo", From: ts("2026-11-11T20:00:00Z")}})
	hists["skip"], _ = New([]Change{{Zone: "Etc/GMT+12"}, {Zone: "Pacific/Kiritimati", From: ts("2026-11-10T11:00:00Z")}})
	hists["berlin dst"], _ = New([]Change{{Zone: "Europe/Berlin"}})
	hists["apia"], _ = New([]Change{{Zone: "Pacific/Apia"}})
	spans := map[string][2]string{
		"west": {"2026-11-05T00:00:00Z", "2026-11-16T00:00:00Z"}, "round trip": {"2026-11-05T00:00:00Z", "2026-11-16T00:00:00Z"},
		"skip": {"2026-11-05T00:00:00Z", "2026-11-16T00:00:00Z"}, "berlin dst": {"2025-03-25T00:00:00Z", "2025-11-05T00:00:00Z"},
		"apia": {"2011-12-20T00:00:00Z", "2012-01-10T00:00:00Z"},
	}
	for name, h := range hists {
		prev := h.DayOf(mustTime(t, spans[name][0]))
		end := mustTime(t, spans[name][1])
		for at := mustTime(t, spans[name][0]); at.Before(end); at = at.Add(15 * time.Minute) {
			d := h.DayOf(at)
			if d.Before(prev) {
				t.Fatalf("%s: DayOf decreased from %s to %s at %s", name, prev, d, at.Format(time.RFC3339))
			}
			if prev.DaysUntil(d) > 3 {
				t.Fatalf("%s: jump %s -> %s at %s", name, prev, d, at.Format(time.RFC3339))
			}
			prev = d
		}
	}
}

// Single-zone histories agree with the time package: DayOf is the civil
// date on the zone's wall clock, DayStart the first instant of that date.
func TestSingleZoneMatchesTimePackage(t *testing.T) {
	zones := []string{"UTC", "Europe/Berlin", "America/New_York", "Asia/Tokyo", "Asia/Kathmandu", "Australia/Lord_Howe", "Pacific/Apia", "Pacific/Kiritimati", "Etc/GMT+12", "America/Santiago", "Pacific/Chatham", "Asia/Tehran", "Africa/Casablanca", "America/St_Johns", "Europe/London", "America/Sao_Paulo"}
	rng := rand.New(rand.NewSource(84))
	lo, hi := time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC).Unix(), time.Date(2040, 1, 1, 0, 0, 0, 0, time.UTC).Unix()
	for _, z := range zones {
		loc, err := time.LoadLocation(z)
		if err != nil {
			t.Fatal(err)
		}
		h, err := New([]Change{{Zone: z}})
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 1500; i++ {
			at := time.Unix(lo+rng.Int63n(hi-lo), 0).UTC()
			y, m, d := at.In(loc).Date()
			want := Date{y, m, d}
			if got := h.DayOf(at); got != want {
				t.Fatalf("%s DayOf(%s) = %s, want %s", z, at.Format(time.RFC3339), got, want)
			}
			start := h.DayStart(want)
			if h.DayOf(start) != want || (start.Unix() > lo && h.DayOf(start.Add(-time.Second)) == want) {
				t.Fatalf("%s DayStart(%s) = %s is not the first instant", z, want, start.Format(time.RFC3339))
			}
		}
	}
}

func TestDayBeforeEpochClamps(t *testing.T) {
	h, _ := New([]Change{{Zone: "Europe/Berlin"}})
	if got := h.DayOf(time.Date(1900, 5, 5, 0, 0, 0, 0, time.UTC)).String(); got != "1970-01-01" {
		t.Errorf("DayOf(1900) = %s", got)
	}
	d, _ := ParseDate("1900-05-05")
	if got := h.DayStart(d); !got.Equal(time.Unix(0, 0)) {
		t.Errorf("DayStart(1900-05-05) = %s", got)
	}
}

func TestUTCHistory(t *testing.T) {
	h := UTCHistory()
	if h.Zone() != "UTC" {
		t.Error(h.Zone())
	}
	if got := h.DayOf(time.Date(2026, 11, 15, 23, 59, 59, 0, time.UTC)).String(); got != "2026-11-15" {
		t.Error(got)
	}
}
