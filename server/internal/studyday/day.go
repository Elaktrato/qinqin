// Package studyday implements the learner's day: the calendar date a
// learner's instant belongs to, by the time zone in effect at that
// instant. The rule is documented and pinned by JSON fixtures in
// docs/contracts/study-day/ and implemented identically by the web and
// Android clients.
package studyday

import (
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"
	_ "time/tzdata" // the zone database is part of the binary
)

// epoch is the lower end of the rule's domain: earlier instants are
// clamped to it (zones before ~1900 have local mean time offsets that
// break the search bracket).
var epoch = time.Unix(0, 0).UTC()

// Date is a civil calendar date (proleptic Gregorian).
type Date struct {
	Year  int
	Month time.Month
	Day   int
}

// ParseDate parses exactly YYYY-MM-DD and rejects dates that do not exist.
func ParseDate(s string) (Date, error) {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return Date{}, fmt.Errorf("studyday: %q is not YYYY-MM-DD", s)
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return Date{}, fmt.Errorf("studyday: %q is not a date", s)
	}
	return dateOf(t), nil
}

func dateOf(t time.Time) Date {
	y, m, d := t.Date()
	return Date{y, m, d}
}

func (d Date) utc() time.Time { return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC) }

// String formats the date as YYYY-MM-DD.
func (d Date) String() string { return d.utc().Format("2006-01-02") }

// AddDays is civil-date arithmetic, never "+ 86 400 s".
func (d Date) AddDays(n int) Date { return dateOf(d.utc().AddDate(0, 0, n)) }

// Before reports whether d is an earlier date than o.
func (d Date) Before(o Date) bool { return d.utc().Before(o.utc()) }

// DaysUntil is o − d in civil days.
func (d Date) DaysUntil(o Date) int { return int(o.utc().Sub(d.utc()) / (24 * time.Hour)) }

// Change is one entry of a zone history: from nil only for the first.
type Change struct {
	Zone string
	From *time.Time
}

// History is a user's zone history ready to compute days. The zero
// value is not usable; use New or UTCHistory.
type History struct {
	names  []string
	locs   []*time.Location
	from   []time.Time // from[0] unused
	floors []Date      // floors[0] is the zero Date (before every real date)
}

var zoneCache sync.Map // name -> *time.Location

func loadZone(name string) (*time.Location, error) {
	if !nameOK(name) {
		return nil, ErrUnknownZone
	}
	if v, ok := zoneCache.Load(name); ok {
		return v.(*time.Location), nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, ErrUnknownZone
	}
	zoneCache.Store(name, loc)
	return loc, nil
}

// New builds a history. It rejects unknown zones, a first change with
// From, a later change without From and From values that do not
// strictly increase (compared at whole seconds).
func New(changes []Change) (History, error) {
	if len(changes) == 0 {
		return UTCHistory(), nil
	}
	h := History{}
	for i, c := range changes {
		loc, err := loadZone(c.Zone)
		if err != nil {
			return History{}, fmt.Errorf("studyday: change %d: %w", i, err)
		}
		var from time.Time
		switch {
		case i == 0 && c.From != nil:
			return History{}, errors.New("studyday: the first change must have no From")
		case i > 0 && c.From == nil:
			return History{}, fmt.Errorf("studyday: change %d has no From", i)
		case i > 0:
			from = c.From.UTC().Truncate(time.Second)
			if i > 1 && !from.After(h.from[i-1]) {
				return History{}, fmt.Errorf("studyday: change %d From does not increase", i)
			}
		}
		h.names = append(h.names, c.Zone)
		h.locs = append(h.locs, loc)
		h.from = append(h.from, from)
		floor := Date{}
		if i > 0 {
			floor = localDate(h.locs[i-1], from)
			if prev := h.floors[i-1]; floor.Before(prev) {
				floor = prev
			}
		}
		h.floors = append(h.floors, floor)
	}
	return h, nil
}

// UTCHistory is the history of a user with no zone: UTC since always.
func UTCHistory() History {
	h, err := New([]Change{{Zone: "UTC"}})
	if err != nil {
		panic(err)
	}
	return h
}

// Zone is the current (last) zone's name.
func (h History) Zone() string {
	if len(h.names) == 0 {
		return "UTC"
	}
	return h.names[len(h.names)-1]
}

func localDate(loc *time.Location, t time.Time) Date {
	if t.Before(epoch) {
		t = epoch
	}
	return dateOf(t.In(loc))
}

// segment returns the index of the last segment with from <= t.
func (h History) segment(t time.Time) int {
	n := len(h.from)
	k := sort.Search(n-1, func(i int) bool { return h.from[i+1].After(t) })
	return k
}

// DayOf returns the learner's day of an instant: the greatest date whose
// DayStart is not after it. A date never repeats, also where a clock goes
// back across midnight.
func (h History) DayOf(t time.Time) Date {
	if len(h.locs) == 0 {
		h = UTCHistory()
	}
	t = t.UTC()
	if t.Before(epoch) {
		t = epoch
	}
	k := h.segment(t)
	d := localDate(h.locs[k], t)
	if d.Before(h.floors[k]) {
		d = h.floors[k]
	}
	for i := 0; i < 3; i++ {
		if startOfDay(h.locs[k], d.AddDays(1)).After(t) {
			break
		}
		d = d.AddDays(1)
	}
	return d
}

func offsetAt(loc *time.Location, sec int64) int64 {
	_, off := time.Unix(sec, 0).In(loc).Zone()
	return int64(off)
}

// startOfDay is the earliest whole second t >= epoch whose wall clock in
// loc has reached the midnight of d. It works from offsets, not from
// localDate (which is not monotone where a clock goes back across
// midnight): tzdb since 1970 never has two offset changes within the
// 28 hour bracket, so at most one transition T lies inside it.
func startOfDay(loc *time.Location, d Date) time.Time {
	base := d.utc().Unix()
	lo, hi := base-15*3600, base+13*3600
	oLo, oHi := offsetAt(loc, lo), offsetAt(loc, hi)
	var s int64
	if oLo == oHi {
		s = base - oLo
	} else {
		a, b := lo, hi // offset(a) == oLo, offset(b) == oHi
		for b-a > 1 {
			mid := a + (b-a)/2
			if offsetAt(loc, mid) == oLo {
				a = mid
			} else {
				b = mid
			}
		}
		T := b
		if c := base - oLo; c < T {
			s = c
		} else {
			s = max(T, base-oHi)
		}
	}
	if s < 0 {
		s = 0
	}
	return time.Unix(s, 0).UTC()
}

// DayStart is the earliest instant whose DayOf is at least d (whole
// seconds, UTC). The window of an empty (skipped) date has
// DayStart(d) == DayStart(d + 1).
func (h History) DayStart(d Date) time.Time {
	if len(h.locs) == 0 {
		h = UTCHistory()
	}
	last := len(h.locs) - 1
	for k := 0; k <= last; k++ {
		var lo time.Time
		if k >= 1 {
			lo = h.from[k]
			if !h.floors[k].Before(d) { // floor >= d
				return lo
			}
		}
		c := startOfDay(h.locs[k], d)
		if k >= 1 && c.Before(lo) {
			c = lo
		}
		if k == last || c.Before(h.from[k+1]) {
			return c
		}
	}
	return epoch // unreachable
}

// Window is one day's instants [Start, End); empty when Start == End.
type Window struct {
	Day        Date
	Start, End time.Time
}

// Windows returns the windows of from..to inclusive, ascending and
// contiguous (each End is the next Start). It returns nil when to is
// before from.
func (h History) Windows(from, to Date) []Window {
	n := from.DaysUntil(to) + 1
	if n <= 0 {
		return nil
	}
	out := make([]Window, 0, n)
	start := h.DayStart(from)
	for i := 0; i < n; i++ {
		d := from.AddDays(i)
		end := h.DayStart(d.AddDays(1))
		out = append(out, Window{Day: d, Start: start, End: end})
		start = end
	}
	return out
}
