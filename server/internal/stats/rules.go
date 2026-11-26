package stats

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
}

// Kind reports the scoring kind, decided by which optional fields are set.
func (r Rule) Kind() Kind {
	switch {
	case r.Measure != nil:
		return KindMeasure
	case r.DistinctBy != "":
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

// Rules are the activity rules, in the order the activity route lists them.
var Rules = []Rule{
	{Type: "review", Feature: "flashcards"},
	{Type: "read", Feature: "reader", Measure: &Measure{Field: "seconds", Min: 30, Max: 7200}, PointsPer: 300},
	{Type: "journal", Feature: "journal", DistinctBy: "entryId"},
	{Type: "script", Feature: "scripts"},
}
