package courses

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

// EventType is the event type of course progress (docs/contracts/courses/README.md "Progress events").
const EventType = "course"

// Event kinds.
const (
	EventLessonStarted  = "lesson-started"
	EventLessonFinished = "lesson-finished"
	EventUnitTest       = "unit-test"
	EventSectionExam    = "section-exam"
	EventPlacement      = "placement"
)

// Limits of a progress event.
const (
	maxScore       = 1000
	maxEventWords  = 50
	maxWordKeySize = 128
)

// Statuses of units, sections and lessons in a path state.
const (
	StatusDone     = "done"
	StatusCurrent  = "current"
	StatusNext     = "next"
	StatusUnlocked = "unlocked"
	StatusLocked   = "locked"
)

// NextTest is a unit's `next` when its lessons are done and its test is what comes next.
const NextTest = "test"

// StoredEvent is an event as the log holds it (only what the derivation reads).
type StoredEvent struct {
	ID      string          `json:"id"`
	TS      string          `json:"ts"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// Progress is one parsed `course` event.
type Progress struct {
	Kind    string
	Course  string
	Unit    string
	Section string
	Lesson  string
	Score   int
	Total   int
	Passed  bool
	Early   bool
	Words   []string
	at      time.Time
	id      string
}

// LessonPayload is the payload of a lesson-started (finished false) or lesson-finished event, in its member order.
func LessonPayload(course, unit, lesson string, finished bool, score, total int, words []string) json.RawMessage {
	if !finished {
		raw, _ := json.Marshal(struct {
			Kind   string `json:"kind"`
			Course string `json:"course"`
			Unit   string `json:"unit"`
			Lesson string `json:"lesson"`
		}{EventLessonStarted, course, unit, lesson})
		return raw
	}
	if words == nil {
		words = []string{}
	}
	raw, _ := json.Marshal(struct {
		Kind   string   `json:"kind"`
		Course string   `json:"course"`
		Unit   string   `json:"unit"`
		Lesson string   `json:"lesson"`
		Score  int      `json:"score"`
		Total  int      `json:"total"`
		Words  []string `json:"words"`
	}{EventLessonFinished, course, unit, lesson, score, total, words})
	return raw
}

// ParseProgress reads a stored event as a course event (README "Parsing"); ok false: it is not one and counts
// nowhere. Members a kind does not name are ignored.
func ParseProgress(e StoredEvent) (Progress, bool) {
	if e.Type != EventType {
		return Progress{}, false
	}
	at, err := time.Parse(time.RFC3339Nano, e.TS)
	if err != nil {
		return Progress{}, false
	}
	var raw map[string]json.RawMessage
	dec := json.NewDecoder(bytes.NewReader(e.Payload))
	if dec.Decode(&raw) != nil || raw == nil {
		return Progress{}, false
	}
	p := Progress{at: at, id: e.ID}
	str := func(name string, pattern func(string) bool) (string, bool) {
		var s string
		if json.Unmarshal(raw[name], &s) != nil || !pattern(s) {
			return "", false
		}
		return s, true
	}
	num := func(name string) (int, bool) {
		var f float64
		if json.Unmarshal(raw[name], &f) != nil || f != float64(int(f)) || f < 0 || f > maxScore {
			return 0, false
		}
		return int(f), true
	}
	boolean := func(name string) (bool, bool) {
		var b bool
		if v, ok := raw[name]; !ok || json.Unmarshal(v, &b) != nil {
			return false, false
		}
		return b, true
	}
	isID := func(s string) bool { return len(s) <= maxIDBytes && idPattern.MatchString(s) }
	isPack := func(s string) bool { return len(s) <= 128 && packIDPattern.MatchString(s) }
	ok := true
	need := func(v bool) {
		if !v {
			ok = false
		}
	}
	var good bool
	p.Kind, good = str("kind", func(s string) bool { return s != "" })
	need(good)
	p.Course, good = str("course", isPack)
	need(good)
	scored := func() {
		var g1, g2 bool
		p.Score, g1 = num("score")
		p.Total, g2 = num("total")
		need(g1 && g2 && p.Score <= p.Total)
	}
	switch p.Kind {
	case EventLessonStarted, EventLessonFinished:
		p.Unit, good = str("unit", isID)
		need(good)
		p.Lesson, good = str("lesson", isID)
		need(good)
		if p.Kind == EventLessonFinished {
			scored()
			var words []string
			if json.Unmarshal(raw["words"], &words) != nil || words == nil || len(words) > maxEventWords {
				need(false)
			}
			for _, w := range words {
				need(w != "" && len(w) <= maxWordKeySize)
			}
			p.Words = words
		}
	case EventUnitTest:
		p.Unit, good = str("unit", isID)
		need(good)
		scored()
		p.Passed, good = boolean("passed")
		need(good)
		p.Early, good = boolean("early")
		need(good)
	case EventSectionExam:
		p.Section, good = str("section", isID)
		need(good)
		scored()
		p.Passed, good = boolean("passed")
		need(good)
	case EventPlacement:
		p.Section, good = str("section", isID)
		need(good)
	default:
		need(false)
	}
	if !ok {
		return Progress{}, false
	}
	return p, true
}

// State is a learner's path through a course (docs/contracts/courses/derive.json).
type State struct {
	// Current is the next thing to do on the path; nil when every unit is done.
	Current  *Position      `json:"current"`
	Sections []SectionState `json:"sections"`
	// Met is every word a finished lesson taught, in the order first met.
	Met []string `json:"met"`
	// Known is the words of skipped units the learner has neither met nor marked known: the client marks them known.
	Known []string `json:"known"`
}

// Position names the current unit and its next lesson id, or NextTest.
type Position struct {
	Section string `json:"section"`
	Unit    string `json:"unit"`
	Next    string `json:"next"`
}

// SectionState is a section's status and whether its exam was passed.
type SectionState struct {
	ID         string      `json:"id"`
	Status     string      `json:"status"`
	ExamPassed bool        `json:"examPassed"`
	Units      []UnitState `json:"units"`
}

// UnitState is a unit's status: done (Skipped: by a test, exam or placement, not by study), current, unlocked or
// locked; Next is its next lesson (or NextTest) while it is open; CatchUp holds the lessons of words a done, studied
// unit gained after the learner finished it.
type UnitState struct {
	ID         string        `json:"id"`
	Status     string        `json:"status"`
	Skipped    bool          `json:"skipped"`
	TestPassed bool          `json:"testPassed"`
	Next       *string       `json:"next"`
	Lessons    []LessonState `json:"lessons"`
	CatchUp    []LessonSpec  `json:"catchUp"`
}

// LessonState is a lesson's status (done, next, unlocked, locked) and whether it was started and not finished.
type LessonState struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Started bool   `json:"started"`
}

type unitRef struct {
	section, unit int
}

// Derive replays one workspace's events of course courseID over the filled course (README "Derivation"). known is
// the words the learner has marked known. The result depends on the events' (ts, id) order, never on their arrival.
func Derive(f *Filled, courseID string, events []StoredEvent, known []string) State {
	var ps []Progress
	for _, e := range events {
		if p, ok := ParseProgress(e); ok && p.Course == courseID {
			ps = append(ps, p)
		}
	}
	sort.SliceStable(ps, func(i, j int) bool {
		if !ps[i].at.Equal(ps[j].at) {
			return ps[i].at.Before(ps[j].at)
		}
		return ps[i].id < ps[j].id
	})

	var order []unitRef // every unit in course order
	unitAt := map[string]int{}
	sectionAt := map[string]int{}
	for si, s := range f.Sections {
		sectionAt[s.ID] = si
		for ui, u := range s.Units {
			unitAt[u.ID] = len(order)
			order = append(order, unitRef{si, ui})
		}
	}
	unit := func(i int) FilledUnit { r := order[i]; return f.Sections[r.section].Units[r.unit] }

	finished := map[[2]string]bool{}
	started := map[[2]string]bool{}
	var met []string
	metSet := map[string]bool{}
	passed := make([]int, len(order)) // 0 not passed, 1 studied, 2 skipped
	testPassed := make([]bool, len(order))
	examPassed := make([]bool, len(f.Sections))
	skipBefore := func(end int) { // every unit before end that is not passed is skipped
		for i := 0; i < end; i++ {
			if passed[i] == 0 {
				passed[i] = 2
			}
		}
	}
	for _, p := range ps {
		switch p.Kind {
		case EventLessonStarted:
			started[[2]string{p.Unit, p.Lesson}] = true
		case EventLessonFinished:
			finished[[2]string{p.Unit, p.Lesson}] = true
			for _, w := range p.Words {
				if !metSet[w] {
					metSet[w] = true
					met = append(met, w)
				}
			}
		case EventUnitTest:
			i, ok := unitAt[p.Unit]
			if !ok || !p.Passed {
				continue
			}
			testPassed[i] = true
			if p.Early {
				skipBefore(i + 1)
			} else if passed[i] == 0 {
				passed[i] = 1
			}
		case EventSectionExam:
			si, ok := sectionAt[p.Section]
			if !ok || !p.Passed {
				continue
			}
			examPassed[si] = true
			end := 0
			for i, r := range order {
				if r.section <= si {
					end = i + 1
				}
			}
			skipBefore(end)
		case EventPlacement:
			si, ok := sectionAt[p.Section]
			if !ok {
				continue
			}
			end := 0
			for i, r := range order {
				if r.section < si {
					end = i + 1
				}
			}
			skipBefore(end)
		}
	}

	knownIn := map[string]bool{}
	for _, k := range known {
		knownIn[k] = true
	}
	st := State{Met: met, Known: []string{}}
	if st.Met == nil {
		st.Met = []string{}
	}
	knownOut := map[string]bool{}
	done := make([]bool, len(order))
	for i := range order {
		u := unit(i)
		done[i] = passed[i] != 0
		if !done[i] && !u.Test {
			all := true
			for _, l := range u.Lessons {
				all = all && finished[[2]string{u.ID, l.ID}]
			}
			done[i] = all
		}
		if passed[i] == 2 {
			for _, w := range u.Words {
				if !metSet[w.Key] && !knownIn[w.Key] && !knownOut[w.Key] {
					knownOut[w.Key] = true
					st.Known = append(st.Known, w.Key)
				}
			}
		}
	}

	position := -1
	for i := range order {
		if done[i] {
			position = i
		}
	}
	current := -1
	for i := position + 1; i < len(order); i++ {
		if !done[i] {
			current = i
			break
		}
	}

	for si, s := range f.Sections {
		ss := SectionState{ID: s.ID, ExamPassed: examPassed[si], Units: []UnitState{}}
		allDone, hasCurrent, hasUnlocked := true, false, false
		for _, u := range s.Units {
			i := unitAt[u.ID]
			us := UnitState{ID: u.ID, TestPassed: testPassed[i], Lessons: []LessonState{}, CatchUp: []LessonSpec{}}
			switch {
			case done[i]:
				us.Status = StatusDone
				us.Skipped = passed[i] == 2
				for _, l := range u.Lessons {
					us.Lessons = append(us.Lessons, LessonState{ID: l.ID, Status: StatusDone})
				}
				if passed[i] != 2 {
					var keys []string
					for _, w := range u.Words {
						if !metSet[w.Key] && !knownIn[w.Key] && !knownOut[w.Key] {
							keys = append(keys, w.Key)
						}
					}
					us.CatchUp = append(us.CatchUp, wordLessons("catch-up", keys)...)
					if us.CatchUp == nil {
						us.CatchUp = []LessonSpec{}
					}
				}
			case i == current || i < position:
				us.Status = StatusUnlocked
				if i == current {
					us.Status = StatusCurrent
					hasCurrent = true
				} else {
					hasUnlocked = true
				}
				next := openLessons(u, finished, started, &us)
				us.Next = &next
				if next == "" {
					us.Next = nil
				}
				if i == current {
					st.Current = &Position{Section: s.ID, Unit: u.ID, Next: next}
				}
			default:
				us.Status = StatusLocked
				for _, l := range u.Lessons {
					ls := LessonState{ID: l.ID, Status: StatusLocked}
					if finished[[2]string{u.ID, l.ID}] {
						ls.Status = StatusDone
					}
					us.Lessons = append(us.Lessons, ls)
				}
			}
			allDone = allDone && done[i]
			ss.Units = append(ss.Units, us)
		}
		switch {
		case allDone:
			ss.Status = StatusDone
		case hasCurrent:
			ss.Status = StatusCurrent
		case hasUnlocked:
			ss.Status = StatusUnlocked
		default:
			ss.Status = StatusLocked
		}
		st.Sections = append(st.Sections, ss)
	}
	if st.Sections == nil {
		st.Sections = []SectionState{}
	}
	return st
}

// openLessons sets the lesson states of an open unit and returns its next lesson id, NextTest, or "" (README
// "Inside a unit"): the learner's position is the last finished lesson; the first unfinished lesson after it is next;
// unfinished lessons before it are unlocked; later ones locked. With none after it, the unit's test is next, or, for
// a unit without a test, its first unfinished lesson.
func openLessons(u FilledUnit, finished, started map[[2]string]bool, us *UnitState) string {
	pos := -1
	for li, l := range u.Lessons {
		if finished[[2]string{u.ID, l.ID}] {
			pos = li
		}
	}
	next := -1
	for li := pos + 1; li < len(u.Lessons); li++ {
		if !finished[[2]string{u.ID, u.Lessons[li].ID}] {
			next = li
			break
		}
	}
	if next < 0 && !u.Test {
		for li, l := range u.Lessons {
			if !finished[[2]string{u.ID, l.ID}] {
				next = li
				break
			}
		}
	}
	for li, l := range u.Lessons {
		key := [2]string{u.ID, l.ID}
		ls := LessonState{ID: l.ID}
		switch {
		case finished[key]:
			ls.Status = StatusDone
		case li == next:
			ls.Status = StatusNext
		case li < pos || (next >= 0 && li < next):
			ls.Status = StatusUnlocked
		default:
			ls.Status = StatusLocked
		}
		ls.Started = started[key] && !finished[key] && ls.Status != StatusLocked
		us.Lessons = append(us.Lessons, ls)
	}
	switch {
	case next >= 0:
		return u.Lessons[next].ID
	case u.Test:
		return NextTest
	}
	return ""
}

// String is for test failures.
func (p Position) String() string { return fmt.Sprintf("%s/%s/%s", p.Section, p.Unit, p.Next) }
