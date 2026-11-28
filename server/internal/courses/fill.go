package courses

import (
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"unicode"
)

// Word sizes of a word lesson (docs/contracts/courses/README.md "Lessons").
const (
	// MaxLessonWords is the most words a lesson introduces.
	MaxLessonWords = 7
)

// Source kinds: where the words of a filled course come from.
const (
	SourceLevels    = "levels"
	SourceFrequency = "frequency"
	SourceNone      = "none"
)

// Lesson kinds.
const (
	KindScript    = "script"
	KindWords     = "words"
	KindGrammar   = "grammar"
	KindPractice  = "practice"
	KindListening = "listening"
	KindSpeaking  = "speaking"
	KindReading   = "reading"
)

// Unplaced reasons.
const (
	// ReasonCharacterLater: the word needs a character the course introduces in a later section.
	ReasonCharacterLater = "character-later"
)

// ListWord is one word as the server resolved it: the dictionary entry's key, its display form and reading, and its
// entry id on this server.
type ListWord struct {
	Key     string `json:"key"`
	Form    string `json:"form"`
	Reading string `json:"reading"`
	EntryID int64  `json:"entryId"`
}

// LevelInput is the installed level pack: its levels in order, each with its member words in the pack's order.
type LevelInput struct {
	Pack   string `json:"pack"`
	Levels []struct {
		Name  string     `json:"name"`
		Words []ListWord `json:"words"`
	} `json:"levels"`
}

// RankedWord is one frequency row resolved to a word: Rank 1 is the most frequent.
type RankedWord struct {
	ListWord
	Rank int `json:"rank"`
}

// FrequencyInput is the frequency pack of the course's language: the ranks of the level words or, with no level
// pack, the rows a level estimate is made from.
type FrequencyInput struct {
	Pack string       `json:"pack"`
	Rows []RankedWord `json:"rows"`
}

// Input is everything Fill reads besides the course.
type Input struct {
	// Levels is the course's level pack; nil when it is not installed.
	Levels *LevelInput
	// Frequency is nil when the language has no frequency pack.
	Frequency *FrequencyInput
	// Topics gives a dictionary key's topics, best first; nil: no labels.
	Topics func(key string) []string
	// Grammar holds the installed grammar points (`<packId>:<lessonId>`).
	Grammar map[string]bool
}

// Filled is a filled course: the skeleton with each unit's words and lessons (docs/contracts/courses/fill.json).
type Filled struct {
	Language    string          `json:"language"`
	Title       Title           `json:"title"`
	Source      Source          `json:"source"`
	Checkpoints Checkpoints     `json:"checkpoints"`
	Sections    []FilledSection `json:"sections"`
	Unplaced    []Unplaced      `json:"unplaced"`
	Counts      Counts          `json:"counts"`
}

// Source names where the words come from.
type Source struct {
	Kind string  `json:"kind"`
	Pack *string `json:"pack"`
}

// FilledSection is a section of a filled course. Exam: a section exam closes it (a section with a level).
type FilledSection struct {
	ID        string       `json:"id"`
	Level     *int         `json:"level"`
	LevelName *string      `json:"levelName"`
	Title     Title        `json:"title"`
	Exam      bool         `json:"exam"`
	Units     []FilledUnit `json:"units"`
}

// FilledUnit is a unit with its words (in teaching order) and lessons (in path order).
type FilledUnit struct {
	ID         string       `json:"id"`
	Title      Title        `json:"title"`
	Topics     []string     `json:"topics"`
	Grammar    []string     `json:"grammar"`
	Characters []string     `json:"characters"`
	Scripts    []string     `json:"scripts"`
	Text       *Text        `json:"text"`
	Focus      *string      `json:"focus"`
	Test       bool         `json:"test"`
	Words      []UnitWord   `json:"words"`
	Lessons    []LessonSpec `json:"lessons"`
}

// UnitWord is one word of a unit with its frequency rank (nil: none) and topics.
type UnitWord struct {
	ListWord
	Rank   *int     `json:"rank"`
	Topics []string `json:"topics"`
}

// LessonSpec is one lesson of a unit. Words (words), Characters and Scripts (script), Point and Available (grammar)
// belong to their kinds only; the JSON form carries a kind's members and no others.
type LessonSpec struct {
	ID         string
	Kind       string
	Words      []string
	Characters []string
	Scripts    []string
	Point      string
	Available  bool
}

// MarshalJSON writes {id, kind} and the kind's own members, in this order.
func (l LessonSpec) MarshalJSON() ([]byte, error) {
	switch l.Kind {
	case KindWords:
		return json.Marshal(struct {
			ID    string   `json:"id"`
			Kind  string   `json:"kind"`
			Words []string `json:"words"`
		}{l.ID, l.Kind, orEmpty(l.Words)})
	case KindScript:
		return json.Marshal(struct {
			ID         string   `json:"id"`
			Kind       string   `json:"kind"`
			Characters []string `json:"characters"`
			Scripts    []string `json:"scripts"`
		}{l.ID, l.Kind, orEmpty(l.Characters), orEmpty(l.Scripts)})
	case KindGrammar:
		return json.Marshal(struct {
			ID        string `json:"id"`
			Kind      string `json:"kind"`
			Point     string `json:"point"`
			Available bool   `json:"available"`
		}{l.ID, l.Kind, l.Point, l.Available})
	}
	return json.Marshal(struct {
		ID   string `json:"id"`
		Kind string `json:"kind"`
	}{l.ID, l.Kind})
}

// Unplaced is a candidate word the rule could not place.
type Unplaced struct {
	Key     string `json:"key"`
	Form    string `json:"form"`
	Reading string `json:"reading"`
	Level   int    `json:"level"`
	Reason  string `json:"reason"`
}

// Counts sums up a fill: the candidate words, those placed, those placed by topic, and the unplaced.
type Counts struct {
	Candidates int `json:"candidates"`
	Placed     int `json:"placed"`
	ByTopic    int `json:"byTopic"`
	Unplaced   int `json:"unplaced"`
}

// candidate is one word that may enter the course.
type candidate struct {
	w      ListWord
	level  int
	rank   *int
	order  int
	topics []string
}

// Fill fills the course's units (docs/contracts/courses/README.md "The fill rule"). It is deterministic: the same
// course and input give the same result.
func Fill(c *Course, in Input) Filled {
	f := Filled{Language: c.Language, Title: c.Title, Checkpoints: c.Checkpoints, Unplaced: []Unplaced{}}
	pool, levelNames := candidates(c, in, &f.Source)

	// The unit that introduces each character, by unit position in the course.
	charUnit := map[rune]int{}
	gidx := 0
	for _, s := range c.Sections {
		for _, u := range s.Units {
			for _, ch := range u.Characters {
				charUnit[[]rune(ch)[0]] = gidx
			}
			gidx++
		}
	}

	first := 0 // course position of the section's first unit
	for _, s := range c.Sections {
		fs := FilledSection{ID: s.ID, Level: s.Level, Title: s.Title, Exam: s.Level != nil, Units: []FilledUnit{}}
		var words [][]candidate
		if s.Level != nil {
			if name, ok := levelNames[*s.Level]; ok {
				fs.LevelName = &name
			}
			var byTopic int
			var unplaced []candidate
			words, unplaced, byTopic = place(s, first, pool[*s.Level], charUnit)
			f.Counts.Candidates += len(pool[*s.Level])
			f.Counts.ByTopic += byTopic
			for _, w := range unplaced {
				f.Unplaced = append(f.Unplaced, Unplaced{Key: w.w.Key, Form: w.w.Form, Reading: w.w.Reading, Level: w.level, Reason: ReasonCharacterLater})
			}
		}
		for i, u := range s.Units {
			var uw []candidate
			if words != nil {
				uw = words[i]
			}
			f.Counts.Placed += len(uw)
			fs.Units = append(fs.Units, fillUnit(u, uw, in.Grammar))
		}
		first += len(s.Units)
		f.Sections = append(f.Sections, fs)
	}
	f.Counts.Unplaced = len(f.Unplaced)
	return f
}

// candidates gathers the course's candidate words by level position, each level in teaching order (rank, then the
// source's order, then the key), and the level names of the scheme.
func candidates(c *Course, in Input, src *Source) (map[int][]candidate, map[int]string) {
	pool := map[int][]candidate{}
	names := map[int]string{}
	seen := map[string]bool{}
	topicsOf := func(key string) []string {
		if in.Topics == nil {
			return []string{}
		}
		if t := in.Topics(key); t != nil {
			return t
		}
		return []string{}
	}
	ranks := map[string]int{}
	if in.Frequency != nil {
		for _, r := range in.Frequency.Rows {
			if old, ok := ranks[r.Key]; !ok || r.Rank < old {
				ranks[r.Key] = r.Rank
			}
		}
	}
	order := 0
	add := func(w ListWord, level int) {
		if seen[w.Key] {
			return
		}
		seen[w.Key] = true
		cd := candidate{w: w, level: level, order: order, topics: topicsOf(w.Key)}
		order++
		if r, ok := ranks[w.Key]; ok {
			cd.rank = &r
		}
		pool[level] = append(pool[level], cd)
	}
	switch {
	case in.Levels != nil:
		src.Kind = SourceLevels
		src.Pack = &in.Levels.Pack
		for i, lv := range in.Levels.Levels {
			names[i+1] = lv.Name
			for _, w := range lv.Words {
				add(w, i+1)
			}
		}
	case in.Frequency != nil && c.Levels != nil && len(c.Levels.Estimate) > 0:
		src.Kind = SourceFrequency
		src.Pack = &in.Frequency.Pack
		rows := slices.Clone(in.Frequency.Rows)
		sort.SliceStable(rows, func(i, j int) bool { return rows[i].Rank < rows[j].Rank })
		for _, r := range rows {
			for i, maxRank := range c.Levels.Estimate {
				if r.Rank <= maxRank {
					add(r.ListWord, i+1)
					break
				}
			}
		}
	default:
		src.Kind = SourceNone
	}
	for level := range pool {
		ws := pool[level]
		sort.SliceStable(ws, func(i, j int) bool {
			a, b := ws[i], ws[j]
			if (a.rank == nil) != (b.rank == nil) {
				return a.rank != nil
			}
			if a.rank != nil && *a.rank != *b.rank {
				return *a.rank < *b.rank
			}
			if a.order != b.order {
				return a.order < b.order
			}
			return a.w.Key < b.w.Key
		})
	}
	return pool, names
}

// place spreads a section's candidates over its units (README "Placement"): pass 1 by topic, pass 2 by order, each
// unit up to its quota; a word only in units at or after the unit that introduces its last character.
func place(s Section, first int, pool []candidate, charUnit map[rune]int) (units [][]candidate, unplaced []candidate, byTopic int) {
	k := len(s.Units)
	units = make([][]candidate, k)
	last := first + k - 1
	// from[i] is the first unit (section-local) word i may go to; -1: none.
	from := make([]int, len(pool))
	placeable := 0
	for i, w := range pool {
		need := first
		for _, r := range w.w.Form {
			if !unicode.Is(unicode.Han, r) {
				continue
			}
			if u, ok := charUnit[r]; ok && u > need {
				need = u
			}
		}
		if need > last {
			from[i] = -1
			unplaced = append(unplaced, w)
			continue
		}
		from[i] = need - first
		placeable++
	}
	quota := make([]int, k)
	for i := range quota {
		quota[i] = placeable / k
		if i < placeable%k {
			quota[i]++
		}
	}
	assigned := make([]int, len(pool)) // unit + 1, 0: not yet
	count := make([]int, k)
	put := func(i, u int) { assigned[i] = u + 1; count[u]++ }
	for i, w := range pool {
		if from[i] < 0 {
			continue
		}
		for _, t := range w.topics {
			best := -1
			for u := from[i]; u < k; u++ {
				if count[u] < quota[u] && slices.Contains(s.Units[u].Topics, t) && (best < 0 || count[u] < count[best]) {
					best = u
				}
			}
			if best >= 0 {
				put(i, best)
				byTopic++
				break
			}
		}
	}
	for i := range pool {
		if from[i] < 0 || assigned[i] != 0 {
			continue
		}
		target := -1
		for u := from[i]; u < k; u++ {
			if count[u] < quota[u] {
				target = u
				break
			}
		}
		if target < 0 {
			for u := from[i]; u < k; u++ {
				if target < 0 || count[u] < count[target] {
					target = u
				}
			}
		}
		put(i, target)
	}
	for i, w := range pool { // pool order is the teaching order
		if assigned[i] != 0 {
			units[assigned[i]-1] = append(units[assigned[i]-1], w)
		}
	}
	return units, unplaced, byTopic
}

// lessonSizes splits n words into ceil(n/7) lessons whose sizes differ by at most one, the larger first.
func lessonSizes(n int) []int {
	if n == 0 {
		return nil
	}
	m := (n + MaxLessonWords - 1) / MaxLessonWords
	sizes := make([]int, m)
	for i := range sizes {
		sizes[i] = n / m
		if i < n%m {
			sizes[i]++
		}
	}
	return sizes
}

// wordLessons splits keys into word lessons named prefix-1, prefix-2 … (README "Lessons").
func wordLessons(prefix string, keys []string) []LessonSpec {
	var out []LessonSpec
	at := 0
	for i, size := range lessonSizes(len(keys)) {
		out = append(out, LessonSpec{ID: fmt.Sprintf("%s-%d", prefix, i+1), Kind: KindWords, Words: slices.Clone(keys[at : at+size])})
		at += size
	}
	return out
}

func orEmpty(l []string) []string {
	if l == nil {
		return []string{}
	}
	return slices.Clone(l)
}

// fillUnit builds a unit's words and lessons in path order (README "Lessons").
func fillUnit(u Unit, words []candidate, grammar map[string]bool) FilledUnit {
	fu := FilledUnit{ID: u.ID, Title: u.Title, Topics: orEmpty(u.Topics), Grammar: orEmpty(u.Grammar),
		Characters: orEmpty(u.Characters), Scripts: orEmpty(u.Scripts), Text: u.Text, Test: u.HasTest(),
		Words: []UnitWord{}, Lessons: []LessonSpec{}}
	if u.Focus != "" {
		focus := u.Focus
		fu.Focus = &focus
	}
	keys := make([]string, 0, len(words))
	for _, w := range words {
		fu.Words = append(fu.Words, UnitWord{ListWord: w.w, Rank: w.rank, Topics: w.topics})
		keys = append(keys, w.w.Key)
	}
	if len(u.Characters) > 0 || len(u.Scripts) > 0 {
		fu.Lessons = append(fu.Lessons, LessonSpec{ID: "script", Kind: KindScript, Characters: orEmpty(u.Characters), Scripts: orEmpty(u.Scripts)})
	}
	grammarLesson := func(point string) LessonSpec {
		return LessonSpec{ID: "grammar-" + grammarLessonID(point), Kind: KindGrammar, Point: point, Available: grammar[point]}
	}
	wl := wordLessons("words", keys)
	g := len(u.Grammar)
	if len(wl) == 0 {
		for _, p := range u.Grammar {
			fu.Lessons = append(fu.Lessons, grammarLesson(p))
		}
	}
	for i, l := range wl {
		fu.Lessons = append(fu.Lessons, l)
		for j := 1; j <= g; j++ {
			if (j*len(wl)+g-1)/g == i+1 { // grammar j after word lesson ceil(j·W/G)
				fu.Lessons = append(fu.Lessons, grammarLesson(u.Grammar[j-1]))
			}
		}
	}
	if len(words) > 0 {
		fu.Lessons = append(fu.Lessons, LessonSpec{ID: "practice", Kind: KindPractice})
	}
	if u.Focus != "" {
		fu.Lessons = append(fu.Lessons, LessonSpec{ID: u.Focus, Kind: u.Focus})
	}
	if u.Text != nil {
		fu.Lessons = append(fu.Lessons, LessonSpec{ID: "reading", Kind: KindReading})
	}
	return fu
}
