package plugins_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/plugins"
)

// ruleManifest returns a journal-based manifest whose only event
// carries the given activity JSON.
func ruleManifest(t *testing.T, activity string) []byte {
	t.Helper()
	return marshalMutated(t, func(m map[string]any) {
		m["events"] = []any{map[string]any{"type": "journal", "activity": json.RawMessage(activity)}}
	})
}

const okDescribe = `"describe":{"one":"{n} thing","other":"{n} things"}`

func TestParseManifestActivity(t *testing.T) {
	cases := []struct {
		name     string
		activity string
		kind     plugins.Kind
	}{
		{"count", `{"label":"Flashcard reviews",` + okDescribe + `}`, plugins.KindCount},
		{"measure", `{"label":"Reading",` + okDescribe + `,"measure":{"field":"seconds","unit":"seconds","min":30,"max":7200},"pointsPer":300}`, plugins.KindMeasure},
		{"distinct", `{"label":"Journal entries",` + okDescribe + `,"distinctBy":"entryId"}`, plugins.KindDistinct},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m, err := plugins.ParseManifest(ruleManifest(t, c.activity))
			if err != nil {
				t.Fatalf("ParseManifest: %v", err)
			}
			r := m.Events[0].Activity
			if r == nil || r.Kind() != c.kind {
				t.Errorf("rule = %+v, want kind %s", r, c.kind)
			}
		})
	}

	long := strings.Repeat("x", 41)
	bad := []struct {
		name, activity, want string
	}{
		{"empty label", `{"label":"",` + okDescribe + `}`, "label"},
		{"long label", `{"label":"` + long + `",` + okDescribe + `}`, "label"},
		{"one without n", `{"label":"L","describe":{"one":"thing","other":"{n} things"}}`, "describe.one"},
		{"other without n", `{"label":"L","describe":{"one":"{n} thing","other":"things"}}`, "describe.other"},
		{"exclusive", `{"label":"L",` + okDescribe + `,"distinctBy":"a","measure":{"field":"s","unit":"seconds","min":0,"max":10},"pointsPer":1}`, "measure and distinctBy are exclusive"},
		{"pointsPer without measure", `{"label":"L",` + okDescribe + `,"pointsPer":5}`, "pointsPer"},
		{"measure without pointsPer", `{"label":"L",` + okDescribe + `,"measure":{"field":"s","unit":"seconds","min":0,"max":10}}`, "pointsPer"},
		{"pointsPer zero", `{"label":"L",` + okDescribe + `,"measure":{"field":"s","unit":"seconds","min":0,"max":10},"pointsPer":0}`, "pointsPer"},
		{"pointsPer fraction", `{"label":"L",` + okDescribe + `,"measure":{"field":"s","unit":"seconds","min":0,"max":10},"pointsPer":2.5}`, "pointsPer"},
		{"unit minutes", `{"label":"L",` + okDescribe + `,"measure":{"field":"s","unit":"minutes","min":0,"max":10},"pointsPer":1}`, "unit"},
		{"min over max", `{"label":"L",` + okDescribe + `,"measure":{"field":"s","unit":"seconds","min":40,"max":30},"pointsPer":1}`, "min"},
		{"max too big", `{"label":"L",` + okDescribe + `,"measure":{"field":"s","unit":"seconds","min":0,"max":90000},"pointsPer":1}`, "max"},
		{"bad measure field", `{"label":"L",` + okDescribe + `,"measure":{"field":"1x","unit":"seconds","min":0,"max":10},"pointsPer":1}`, "measure.field"},
		{"bad distinct field", `{"label":"L",` + okDescribe + `,"distinctBy":"a-b"}`, "distinctBy"},
		{"unknown field", `{"label":"L",` + okDescribe + `,"bogus":1}`, `unknown field "bogus"`},
	}
	for _, c := range bad {
		t.Run(c.name, func(t *testing.T) {
			_, err := plugins.ParseManifest(ruleManifest(t, c.activity))
			if !errors.Is(err, plugins.ErrInvalidManifest) || !strings.Contains(err.Error(), c.want) {
				t.Errorf("err = %v, want ErrInvalidManifest containing %q", err, c.want)
			}
		})
	}
}

func TestBuiltinActivityRules(t *testing.T) {
	want := map[string]plugins.ActivityRule{
		"qinqin-flashcards": {Label: "Flashcard reviews", Describe: plugins.Plural{One: "{n} flashcard review", Other: "{n} flashcard reviews"}},
		"qinqin-reader": {Label: "Reading", Describe: plugins.Plural{One: "{n} minute of reading", Other: "{n} minutes of reading"},
			Measure: &plugins.Measure{Field: "seconds", Unit: "seconds", Min: 30, Max: 7200}, PointsPer: 300},
		"qinqin-journal": {Label: "Journal entries", Describe: plugins.Plural{One: "{n} journal entry", Other: "{n} journal entries"}, DistinctBy: "entryId"},
	}
	seen := 0
	for _, raw := range plugins.Builtin() {
		m, err := plugins.ParseManifest(raw)
		if err != nil {
			t.Fatal(err)
		}
		w, ok := want[m.ID]
		if !ok {
			if m.Events != nil {
				for _, e := range m.Events {
					if e.Activity != nil {
						t.Errorf("%s/%s unexpectedly has a rule", m.ID, e.Type)
					}
				}
			}
			continue
		}
		seen++
		if got := m.Events[0].Activity; got == nil || !reflect.DeepEqual(*got, w) {
			t.Errorf("%s rule = %+v, want %+v", m.ID, got, w)
		}
	}
	if seen != 3 {
		t.Errorf("checked %d built-ins, want 3", seen)
	}
}
