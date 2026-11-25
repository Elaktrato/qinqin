// Package reminders is the account's study reminders (#137-#139): the
// settings row, the "what to remind and when" computation over the facts the
// clients publish, and the email and web push senders that act on it.
// Contract: docs/contracts/reminders/.
package reminders

import (
	"encoding/json"
	"fmt"
	"sort"
)

// Kind is one thing a reminder can be about.
type Kind string

const (
	KindDue    Kind = "due"
	KindGoal   Kind = "goal"
	KindStreak Kind = "streak"
)

// Kinds lists the kinds in their slot order.
var Kinds = []Kind{KindDue, KindGoal, KindStreak}

// Key is the keyed row (user-global) the settings live in.
const Key = "reminders"

// MaxTimes is how many preferred times count.
const MaxTimes = 3

// Quiet is a daily window without reminders: Start inclusive, End exclusive,
// wrapping midnight when End <= Start. Times are "HH:MM".
type Quiet struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// Channels are the independent delivery switches.
type Channels struct {
	Email  bool `json:"email"`
	Push   bool `json:"push"`
	Device bool `json:"device"`
}

// KindSwitches say which kinds are wanted.
type KindSwitches struct {
	Due    bool `json:"due"`
	Goal   bool `json:"goal"`
	Streak bool `json:"streak"`
}

// On reports whether kind k is wanted.
func (k KindSwitches) On(kind Kind) bool {
	switch kind {
	case KindDue:
		return k.Due
	case KindGoal:
		return k.Goal
	case KindStreak:
		return k.Streak
	}
	return false
}

// Settings is the parsed `reminders` row.
type Settings struct {
	Enabled  bool         `json:"enabled"`
	Kinds    KindSwitches `json:"kinds"`
	Times    []string     `json:"times"`
	Quiet    *Quiet       `json:"quiet"`
	Channels Channels     `json:"channels"`
}

// DefaultSettings are what no row, or a row that is not understood, reads as.
func DefaultSettings() Settings {
	return Settings{
		Kinds: KindSwitches{true, true, true},
		Times: []string{"18:00"},
		Quiet: &Quiet{Start: "22:00", End: "08:00"},
	}
}

func parseClock(s string) (int, bool) {
	if len(s) != 5 || s[2] != ':' {
		return 0, false
	}
	for _, i := range []int{0, 1, 3, 4} {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
	}
	h, m := int(s[0]-'0')*10+int(s[1]-'0'), int(s[3]-'0')*10+int(s[4]-'0')
	if h > 23 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

// Contains reports whether the minute of the day lies inside the window. A nil
// Quiet contains nothing.
func (q *Quiet) Contains(minute int) bool {
	if q == nil {
		return false
	}
	s, ok1 := parseClock(q.Start)
	e, ok2 := parseClock(q.End)
	if !ok1 || !ok2 || s == e {
		return false
	}
	if s < e {
		return minute >= s && minute < e
	}
	return minute >= s || minute < e
}

func boolOr(m map[string]json.RawMessage, key string, def bool) bool {
	var b bool
	if raw, ok := m[key]; ok && json.Unmarshal(raw, &b) == nil {
		return b
	}
	return def
}

func objectOf(raw json.RawMessage) map[string]json.RawMessage {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m
}

// ParseSettings reads a row value by the contract (docs/contracts/reminders/):
// anything not understood falls back to the default, per member.
func ParseSettings(raw json.RawMessage) Settings {
	s := DefaultSettings()
	m := objectOf(raw)
	var version float64
	if m == nil || json.Unmarshal(m["version"], &version) != nil || version < 1 || version != float64(int64(version)) {
		return s
	}
	s.Enabled = boolOr(m, "enabled", false)
	if k := objectOf(m["kinds"]); k != nil {
		s.Kinds = KindSwitches{boolOr(k, "due", true), boolOr(k, "goal", true), boolOr(k, "streak", true)}
	}
	var times []any
	if json.Unmarshal(m["times"], &times) == nil {
		seen := map[string]bool{}
		var ok []string
		for _, v := range times {
			if str, isStr := v.(string); isStr {
				if _, valid := parseClock(str); valid && !seen[str] {
					seen[str] = true
					ok = append(ok, str)
				}
			}
		}
		sort.Strings(ok)
		if len(ok) > MaxTimes {
			ok = ok[:MaxTimes]
		}
		if len(ok) > 0 {
			s.Times = ok
		}
	}
	if raw, present := m["quiet"]; present {
		if string(raw) == "null" {
			s.Quiet = nil
		} else if q := objectOf(raw); q != nil {
			var qs Quiet
			_ = json.Unmarshal(raw, &qs)
			a, ok1 := parseClock(qs.Start)
			b, ok2 := parseClock(qs.End)
			switch {
			case !ok1 || !ok2:
			case a == b:
				s.Quiet = nil
			default:
				s.Quiet = &qs
			}
		}
	}
	if c := objectOf(m["channels"]); c != nil {
		s.Channels = Channels{boolOr(c, "email", false), boolOr(c, "push", false), boolOr(c, "device", false)}
	}
	return s
}

// String is for test failures.
func (q Quiet) String() string { return fmt.Sprintf("%s-%s", q.Start, q.End) }
