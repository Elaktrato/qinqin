package stats

import (
	"slices"

	"qinqin/internal/drills"
)

// The activity rules of the heatmap, goals and the weekly summary (#199): one
// core table, pinned by docs/contracts/events/activity.json. Before #199 the
// rules came from the plugin manifests; there are no plugins any more, so a
// new activity type is a line here and in the contract.

// Measure reads a numeric payload field: events below Min count 0 and
// values above Max are capped at Max.
type Measure struct {
	Field string  `json:"field"`
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
}

// Kind is how a rule scores its events.
type Kind string

const (
	KindCount    Kind = "count"
	KindDistinct Kind = "distinct"
	KindMeasure  Kind = "measure"
)

// Rule makes one event type count as activity.
type Rule struct {
	// Type is the event type, Feature the core feature it belongs to.
	Type       string   `json:"-"`
	Feature    string   `json:"feature"`
	Measure    *Measure `json:"measure,omitempty"`
	PointsPer  int64    `json:"pointsPer,omitempty"`
	DistinctBy string   `json:"distinctBy,omitempty"`
	// Item names a fixed distinct value computed from the payload (items):
	// a rule whose identity is more than one member. Only "course" exists.
	Item string `json:"item,omitempty"`
}

// Kind reports the scoring kind, decided by which optional fields are set.
func (r Rule) Kind() Kind {
	switch {
	case r.Measure != nil:
		return KindMeasure
	case r.DistinctBy != "" || r.Item != "":
		return KindDistinct
	default:
		return KindCount
	}
}

// Unit is "seconds" for a measure rule, "count" otherwise.
func (r Rule) Unit() string {
	if r.Kind() == KindMeasure {
		return "seconds"
	}
	return "count"
}

// Rules are the activity rules, in the order the activity route lists them:
// the core types, then one rule per registered drill (drills.IDs).
var Rules = slices.Concat(coreRules, DrillRules(drills.IDs))

// DrillRules are the activity rules of drills (docs/contracts/drills/,
// counting.json): one count rule per drill, type "drill.<id>", feature
// practice; every answer is a point and its payload is not read.
func DrillRules(ids []string) []Rule {
	out := make([]Rule, 0, len(ids))
	for _, id := range ids {
		out = append(out, Rule{Type: drills.EventType(id), Feature: drills.Feature})
	}
	return out
}

var coreRules = []Rule{
	{Type: "review", Feature: "flashcards"},
	{Type: "read", Feature: "reader", Measure: &Measure{Field: "seconds", Min: 30, Max: 7200}, PointsPer: 300},
	{Type: "journal", Feature: "journal", DistinctBy: "entryId"},
	{Type: "script", Feature: "scripts"},
	// A grammar lesson run (#277): one point per lesson finished, once per lesson per learner day.
	{Type: "grammar", Feature: "grammar", DistinctBy: "point"},
	// A course step (#225, docs/contracts/courses/counting.json): a finished lesson that is not a grammar lesson
	// (its grammar run counts), a unit test or a section exam; one point per step per learner day.
	{Type: "course", Feature: "courses", Item: ItemCourse},
}

// ItemCourse is the course step's identity: [kind, course, unit or section, lesson].
const ItemCourse = "course"

// items are the SQL expressions of the named distinct values, over a row's
// payload; NULL scores nothing. Members are read by JSON type only.
var items = map[string]string{
	ItemCourse: `CASE WHEN json_valid(payload) AND json_type(payload, '$.course') = 'text' THEN
		CASE json_extract(payload, '$.kind')
		WHEN 'lesson-finished' THEN
			CASE WHEN json_type(payload, '$.unit') = 'text' AND json_type(payload, '$.lesson') = 'text'
				AND substr(json_extract(payload, '$.lesson'), 1, 8) <> 'grammar-'
			THEN json_array('lesson', json_extract(payload, '$.course'), json_extract(payload, '$.unit'), json_extract(payload, '$.lesson')) END
		WHEN 'unit-test' THEN
			CASE WHEN json_type(payload, '$.unit') = 'text'
			THEN json_array('unit-test', json_extract(payload, '$.course'), json_extract(payload, '$.unit')) END
		WHEN 'section-exam' THEN
			CASE WHEN json_type(payload, '$.section') = 'text'
			THEN json_array('section-exam', json_extract(payload, '$.course'), json_extract(payload, '$.section')) END
		END
	END`,
}
