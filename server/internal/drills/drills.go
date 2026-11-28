// Package drills holds the server's part of the drills framework
// (docs/contracts/drills/): a drill answer is a study event of type
// "drill.<id>" with the payload {item, mode, grade}. The server stores it
// like any event and never reads it, except that every registered drill is
// an activity rule (stats/rules.go: every answer one point, feature
// practice). Schedules and rounds are derived by the client (FSRS), as for
// flashcards. Ids, item keys and Parse pin the contract's rules for Go.
package drills

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// EventPrefix starts the event type of every drill: "drill." + its id.
const EventPrefix = "drill."

// Feature is the core feature the drills belong to (the Practice area).
const Feature = "practice"

// MaxIDLength and MaxItemLength bound a drill id (and a mode) and an item key
// (code points).
const (
	MaxIDLength   = 32
	MaxItemLength = 200
)

// ReservedIDs are never a drill: "weakest" names the round across drills.
var ReservedIDs = []string{"weakest"}

// IDs are the drills the server counts as activity, in the order the
// activity route lists them (the contract's registry). A drill's builder
// adds its id here, in the contract and in the web's DRILL_IDS
// (docs/contracts/drills/README.md, "Adding a drill").
var IDs = []string{
	"tone-pairs",       // the tone-pair drill (#180)
	"conjugation",      // the conjugation trainer (#178)
	"measure-words",    // Chinese measure words (#179)
	"counters",         // Japanese counters (#179)
	"counter-readings", // Japanese number + counter readings (#179)
}

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)

// ValidID reports whether id is a drill id.
func ValidID(id string) bool {
	return validMode(id) && !slices.Contains(ReservedIDs, id)
}

func validMode(mode string) bool {
	return len(mode) <= MaxIDLength && idPattern.MatchString(mode)
}

// ValidItem reports whether item is an item key: 1 to 200 code points, no
// white space (Unicode White_Space) and no control character (Cc).
func ValidItem(item string) bool {
	if item == "" || utf8.RuneCountInString(item) > MaxItemLength {
		return false
	}
	return !strings.ContainsFunc(item, func(r rune) bool {
		return unicode.Is(unicode.White_Space, r) || unicode.IsControl(r)
	})
}

// EventType is the event type of a drill's answers.
func EventType(id string) string { return EventPrefix + id }

// DrillOf returns the drill id of an event type; ok is false when the type
// is no drill's.
func DrillOf(eventType string) (string, bool) {
	id, found := strings.CutPrefix(eventType, EventPrefix)
	if !found || !ValidID(id) {
		return "", false
	}
	return id, true
}

// Member is one of a drill's own payload members, after item, mode and
// grade (#228: the character asked and the one given).
type Member struct {
	Name, Value string
}

// Payload is the payload of one answer, in the contract's member order: item,
// mode, grade, then the drill's own members in order; a member named item,
// mode or grade is left out.
func Payload(item, mode string, grade int, extra ...Member) json.RawMessage {
	out, _ := json.Marshal(struct {
		Item  string `json:"item"`
		Mode  string `json:"mode"`
		Grade int    `json:"grade"`
	}{item, mode, grade})
	for _, m := range extra {
		if m.Name == "item" || m.Name == "mode" || m.Name == "grade" {
			continue
		}
		name, _ := json.Marshal(m.Name)
		value, _ := json.Marshal(m.Value)
		out = append(append(append(append(out[:len(out)-1], ','), name...), ':'), append(value, '}')...)
	}
	return out
}

// Answer is a readable drill answer.
type Answer struct {
	Drill string `json:"drill"`
	Item  string `json:"item"`
	Mode  string `json:"mode"`
	Grade int    `json:"grade"`
}

// Parse reads a stored event as an answer: a drill type, an object payload
// with a valid item, a valid mode and a whole grade 1..4, and an RFC 3339
// ts. Members after these are ignored.
func Parse(eventType string, payload json.RawMessage, ts string) (Answer, bool) {
	drill, ok := DrillOf(eventType)
	if !ok {
		return Answer{}, false
	}
	if _, err := time.Parse(time.RFC3339, ts); err != nil {
		return Answer{}, false
	}
	var p map[string]json.RawMessage
	if err := json.Unmarshal(payload, &p); err != nil || p == nil {
		return Answer{}, false
	}
	var item, mode string
	var grade float64
	if json.Unmarshal(p["item"], &item) != nil || json.Unmarshal(p["mode"], &mode) != nil || json.Unmarshal(p["grade"], &grade) != nil {
		return Answer{}, false
	}
	if !ValidItem(item) || !validMode(mode) || (grade != 1 && grade != 2 && grade != 3 && grade != 4) {
		return Answer{}, false
	}
	return Answer{Drill: drill, Item: item, Mode: mode, Grade: int(grade)}, true
}
