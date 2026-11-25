package reminders

import (
	"sort"
	"time"

	"qinqin/internal/studyday"
)

// Bucket is how many cards come due in one UTC hour.
type Bucket struct {
	At    time.Time `json:"at"`
	Count int       `json:"count"`
}

// GoalFacts and StreakFacts are the goal and streak state a client derived.
type GoalFacts struct {
	Set    bool   `json:"set"`
	Status string `json:"status"` // open, met, vacation, none
}

type StreakFacts struct {
	Current  int  `json:"current"`
	TodayMet bool `json:"todayMet"`
}

// Facts is the derived study snapshot one client published for a workspace
// (docs/contracts/reminders/, "Facts"). A cache, never an authority.
type Facts struct {
	Workspace  int64       `json:"workspace"`
	AsOf       time.Time   `json:"asOf"`
	DueNow     int         `json:"dueNow"`
	DueBuckets []Bucket    `json:"dueBuckets"`
	Goal       GoalFacts   `json:"goal"`
	Streak     StreakFacts `json:"streak"`
	Vacation   []string    `json:"vacation"`
}

// Slot is one planned reminder.
type Slot struct {
	ID    int       `json:"id"`
	Kind  Kind      `json:"kind"`
	At    time.Time `json:"at"`
	Local string    `json:"local"`
	Day   string    `json:"day"`
	Count *int      `json:"count"`
}

// StaleAfter is how old facts may be before they count for nothing.
const StaleAfter = 30 * 24 * time.Hour

// Input is everything the computation reads.
type Input struct {
	Now time.Time
	// From is the earliest instant a slot may have (exclusive); zero: Now. The
	// scheduler sets it back to catch slots that just fell due.
	From     time.Time
	History  studyday.History
	Settings Settings
	Facts    []Facts
	Days     int
}

var kindCode = map[Kind]int{KindDue: 1, KindGoal: 2, KindStreak: 3}

func slotID(day studyday.Date, kind Kind) int {
	d := studyday.Date{Year: 1970, Month: time.January, Day: 1}.DaysUntil(day)
	return (d%100000)*10 + kindCode[kind]
}

func onVacation(f Facts, day string) bool {
	for _, v := range f.Vacation {
		if v == day {
			return true
		}
	}
	return false
}

// Plan is "what to remind and when": the reminders the settings allow over
// the next Days calendar dates, from the clients' facts. Pure. At most one slot
// per kind per learner day; sorted by time, then kind.
func Plan(in Input) []Slot {
	if !in.Settings.Enabled || in.Days <= 0 {
		return nil
	}
	var live []Facts
	for _, f := range in.Facts {
		if in.Now.Sub(f.AsOf) <= StaleAfter {
			live = append(live, f)
		}
	}
	if len(live) == 0 {
		return nil
	}
	loc, err := time.LoadLocation(in.History.Zone())
	if err != nil {
		return nil
	}
	var minutes []int
	for _, s := range in.Settings.Times {
		if m, ok := parseClock(s); ok {
			minutes = append(minutes, m)
		}
	}
	from := in.From
	if from.IsZero() {
		from = in.Now
	}
	first := from.In(loc)
	var out []Slot
	for i := 0; i < in.Days; i++ {
		date := time.Date(first.Year(), first.Month(), first.Day()+i, 0, 0, 0, 0, loc)
		var cands []time.Time
		for _, m := range minutes {
			if in.Settings.Quiet.Contains(m) {
				continue
			}
			at := time.Date(date.Year(), date.Month(), date.Day(), m/60, m%60, 0, 0, loc)
			if at.After(from) {
				cands = append(cands, at.UTC())
			}
		}
		if len(cands) == 0 {
			continue
		}
		for _, kind := range Kinds {
			if !in.Settings.Kinds.On(kind) {
				continue
			}
			at := cands[len(cands)-1]
			if kind == KindDue {
				at = cands[0]
			}
			day := in.History.DayOf(at)
			count, ok := slotCount(kind, at, day, live, in.History)
			if !ok {
				continue
			}
			s := Slot{ID: slotID(day, kind), Kind: kind, At: at, Local: at.In(loc).Format("2006-01-02T15:04"), Day: day.String(), Count: count}
			out = append(out, s)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].At.Equal(out[j].At) {
			return out[i].At.Before(out[j].At)
		}
		return kindCode[out[i].Kind] < kindCode[out[j].Kind]
	})
	return out
}

func slotCount(kind Kind, at time.Time, day studyday.Date, facts []Facts, h studyday.History) (*int, bool) {
	ds := day.String()
	total, streak, any := 0, 0, false
	for _, f := range facts {
		if onVacation(f, ds) {
			continue
		}
		factsDay := h.DayOf(f.AsOf)
		switch kind {
		case KindDue:
			n := f.DueNow
			for _, b := range f.DueBuckets {
				if !b.At.After(at) {
					n += b.Count
				}
			}
			total += n
		case KindGoal:
			if !f.Goal.Set {
				continue
			}
			if day == factsDay && f.Goal.Status == "open" || factsDay.Before(day) {
				any = true
			}
		case KindStreak:
			if f.Streak.Current <= 0 {
				continue
			}
			switch {
			case day == factsDay && !f.Streak.TodayMet:
				any, streak = true, max(streak, f.Streak.Current)
			case factsDay.AddDays(1) == day && f.Streak.TodayMet:
				any, streak = true, max(streak, f.Streak.Current+1)
			}
		}
	}
	switch kind {
	case KindDue:
		if total < 1 {
			return nil, false
		}
		return &total, true
	case KindStreak:
		if !any {
			return nil, false
		}
		return &streak, true
	}
	return nil, any
}
