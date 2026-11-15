package plugins

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// Plural is the two wordings of a rule's description; both contain {n}.
type Plural struct {
	One   string `json:"one"`
	Other string `json:"other"`
}

// Measure reads a numeric payload field: events below Min count 0 and
// values above Max are capped at Max.
type Measure struct {
	Field string  `json:"field"`
	Unit  string  `json:"unit"`
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
}

// ActivityRule is the optional rule that makes an event type count as
// activity on the heatmap.
type ActivityRule struct {
	Label      string   `json:"label"`
	Describe   Plural   `json:"describe"`
	Measure    *Measure `json:"measure,omitempty"`
	PointsPer  int64    `json:"pointsPer,omitempty"`
	DistinctBy string   `json:"distinctBy,omitempty"`
}

// Kind is how a rule scores its events.
type Kind string

const (
	KindCount    Kind = "count"
	KindDistinct Kind = "distinct"
	KindMeasure  Kind = "measure"
)

// Kind reports the scoring kind, decided by which optional fields are set.
func (r ActivityRule) Kind() Kind {
	switch {
	case r.Measure != nil:
		return KindMeasure
	case r.DistinctBy != "":
		return KindDistinct
	default:
		return KindCount
	}
}

var fieldPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*$`)

// UnmarshalJSON decodes an event declaration strictly, including the
// activity rule inside it. A non-object activity is remembered and
// reported by ParseManifest, which keeps the one-message-per-problem
// shape of the other checks.
func (e *EventDecl) UnmarshalJSON(data []byte) error {
	var raw struct {
		Type     string          `json:"type"`
		Activity json.RawMessage `json:"activity"`
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&raw); err != nil {
		return err
	}
	*e = EventDecl{Type: raw.Type}
	if len(raw.Activity) == 0 || isNull(raw.Activity) {
		return nil
	}
	if !isJSONObject(raw.Activity) {
		e.badActivity = true
		return nil
	}
	var rule ActivityRule
	rdec := json.NewDecoder(bytes.NewReader(raw.Activity))
	rdec.DisallowUnknownFields()
	if err := rdec.Decode(&rule); err != nil {
		return err
	}
	e.Activity = &rule
	return nil
}

// validate returns the problems of a rule, each prefixed with at.
func (r ActivityRule) validate(at string) []string {
	var out []string
	add := func(format string, args ...any) { out = append(out, at+fmt.Sprintf(format, args...)) }
	if n := len([]rune(r.Label)); n < 1 || n > 40 {
		add(".label must be 1 to 40 characters")
	}
	if !strings.Contains(r.Describe.One, "{n}") {
		add(".describe.one must contain {n}")
	}
	if !strings.Contains(r.Describe.Other, "{n}") {
		add(".describe.other must contain {n}")
	}
	if r.Measure != nil && r.DistinctBy != "" {
		add(": measure and distinctBy are exclusive")
	}
	if r.DistinctBy != "" && !fieldPattern.MatchString(r.DistinctBy) {
		add(".distinctBy %q must match %s", r.DistinctBy, fieldPattern)
	}
	if r.Measure == nil && r.PointsPer != 0 {
		add(".pointsPer is only allowed with measure")
	}
	if m := r.Measure; m != nil {
		if !fieldPattern.MatchString(m.Field) {
			add(".measure.field %q must match %s", m.Field, fieldPattern)
		}
		if m.Unit != "seconds" {
			add(`.measure.unit must be "seconds"`)
		}
		if m.Min < 0 || m.Min >= m.Max {
			add(".measure.min must be at least 0 and below max")
		}
		if m.Max > 86400 {
			add(".measure.max must be at most 86400")
		}
		if r.PointsPer < 1 {
			add(".pointsPer must be a whole number of at least 1 with measure")
		}
	}
	return out
}

// RuleOf is one activity rule with the plugin and event type it belongs to.
type RuleOf struct {
	Plugin string
	Type   string
	Rule   ActivityRule
}

// ActivityRules lists the activity rules of every registered feature
// plugin whose manifest parses: built-ins first in Builtin() order, then
// the other plugins by id, each in manifest order. An event type is
// listed once, for the first plugin in that order. Order and inclusion
// do not depend on any user's plugin state.
func ActivityRules(ctx context.Context, sqlDB *sql.DB) ([]RuleOf, error) {
	rows, err := sqlDB.QueryContext(ctx, `SELECT pack_id, manifest_json FROM plugin_registry`)
	if err != nil {
		return nil, fmt.Errorf("plugins: read registry: %w", err)
	}
	defer rows.Close()
	byID := map[string]Manifest{}
	for rows.Next() {
		var id, raw string
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, fmt.Errorf("plugins: scan registry: %w", err)
		}
		m, err := ParseManifest([]byte(raw))
		if err != nil {
			continue
		}
		byID[id] = m
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("plugins: read registry: %w", err)
	}

	order := BuiltinIDs()
	var rest []string
	for id := range byID {
		if !slices.Contains(order, id) {
			rest = append(rest, id)
		}
	}
	sort.Strings(rest)
	order = append(order, rest...)

	out := []RuleOf{}
	seen := map[string]bool{}
	for _, id := range order {
		m, ok := byID[id]
		if !ok {
			continue
		}
		for _, e := range m.Events {
			if seen[e.Type] {
				continue
			}
			seen[e.Type] = true
			if e.Activity == nil {
				continue
			}
			out = append(out, RuleOf{Plugin: id, Type: e.Type, Rule: *e.Activity})
		}
	}
	return out, nil
}
