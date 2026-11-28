package counters_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/counters"
	"qinqin/internal/drills"
	"qinqin/internal/lexicon"
)

const contractDir = "../../../docs/contracts/counters"

func decodeFixture(t *testing.T, name string, v any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(contractDir, name))
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

type itemsFixture struct {
	Version int               `json:"version"`
	Rule    string            `json:"rule"`
	Doc     string            `json:"doc"`
	Drills  map[string]string `json:"drills"`
	Cases   []struct {
		Name    string `json:"name"`
		Drill   string `json:"drill"`
		Item    string `json:"item"`
		Valid   bool   `json:"valid"`
		EntryID int64  `json:"entryId"`
		Counter string `json:"counter"`
		Number  string `json:"number"`
	} `json:"cases"`
}

// TestItemsContract: the item keys of the three drills (items.json).
func TestItemsContract(t *testing.T) {
	var fx itemsFixture
	decodeFixture(t, "items.json", &fx)
	if fx.Rule != "counters/items" {
		t.Fatalf("rule = %q", fx.Rule)
	}
	want := map[string]string{counters.MeasureWordsDrill: "entry", counters.CountersDrill: "entry", counters.ReadingsDrill: "reading"}
	if len(fx.Drills) != len(want) {
		t.Fatalf("drills = %v, want %v", fx.Drills, want)
	}
	for id, shape := range want {
		if fx.Drills[id] != shape {
			t.Errorf("drill %s: shape %q, want %q", id, fx.Drills[id], shape)
		}
		if !drills.ValidID(id) {
			t.Errorf("drill %s is not a drill id", id)
		}
	}
	for _, c := range fx.Cases {
		if got := counters.ValidItem(c.Drill, c.Item); got != c.Valid {
			t.Errorf("%s: ValidItem(%q, %q) = %v, want %v", c.Name, c.Drill, c.Item, got, c.Valid)
		}
		if c.Valid && !drills.ValidItem(c.Item) {
			t.Errorf("%s: %q is not a drill item key", c.Name, c.Item)
		}
		switch {
		case !c.Valid:
		case fx.Drills[c.Drill] == "entry":
			if id, ok := counters.ParseEntryItem(c.Item); !ok || id != c.EntryID {
				t.Errorf("%s: ParseEntryItem(%q) = %d, %v; want %d", c.Name, c.Item, id, ok, c.EntryID)
			}
		default:
			counter, number, ok := counters.ParseReadingItem(c.Item)
			if !ok || counter != c.Counter || number != c.Number {
				t.Errorf("%s: ParseReadingItem(%q) = %q, %q, %v", c.Name, c.Item, counter, number, ok)
			}
			if counters.ReadingItem(counter, number) != c.Item {
				t.Errorf("%s: ReadingItem(%q, %q) = %q", c.Name, counter, number, counters.ReadingItem(counter, number))
			}
		}
	}
}

type fixtureMeasure struct {
	Simplified  string `json:"simplified"`
	Traditional string `json:"traditional"`
	Pinyin      string `json:"pinyin"`
}

type measuresFixture struct {
	Version       int              `json:"version"`
	Rule          string           `json:"rule"`
	Doc           string           `json:"doc"`
	Fallback      fixtureMeasure   `json:"fallback"`
	FallbackAfter []string         `json:"fallbackAfter"`
	FallbackNot   []string         `json:"fallbackNot"`
	Pool          []fixtureMeasure `json:"pool"`
	Cases         []struct {
		Name    string `json:"name"`
		Written string `json:"written"`
		Senses  []struct {
			Tags    []string `json:"tags"`
			Glosses []string `json:"glosses"`
		} `json:"senses"`
		Measures []fixtureMeasure `json:"measures"`
		Gloss    string           `json:"gloss"`
		Fallback bool             `json:"fallback"`
	} `json:"cases"`
}

func asFixture(ms []counters.ChineseMeasure) []fixtureMeasure {
	out := []fixtureMeasure{}
	for _, m := range ms {
		out = append(out, fixtureMeasure{m.Simplified, m.Traditional, m.Pinyin})
	}
	return out
}

// TestMeasuresContract: CL notes → measure words, the shown gloss and the
// 个 fallback (measures.json), and the server's lists equal the fixture's.
func TestMeasuresContract(t *testing.T) {
	var fx measuresFixture
	decodeFixture(t, "measures.json", &fx)
	if fx.Rule != "counters/measures" {
		t.Fatalf("rule = %q", fx.Rule)
	}
	if got := asFixture([]counters.ChineseMeasure{counters.FallbackMeasure}); got[0] != fx.Fallback {
		t.Errorf("fallback = %+v, want %+v", got[0], fx.Fallback)
	}
	if !slices.Equal(counters.FallbackAfter, fx.FallbackAfter) {
		t.Errorf("FallbackAfter = %v, want %v", counters.FallbackAfter, fx.FallbackAfter)
	}
	if !slices.Equal(counters.FallbackNot, fx.FallbackNot) {
		t.Errorf("FallbackNot = %v, want %v", counters.FallbackNot, fx.FallbackNot)
	}
	if got := asFixture(counters.ChinesePool); !slices.Equal(got, fx.Pool) {
		t.Errorf("pool = %+v\nwant %+v", got, fx.Pool)
	}
	for _, c := range fx.Cases {
		senses := make([]lexicon.Sense, len(c.Senses))
		for i, s := range c.Senses {
			senses[i] = lexicon.Sense{Ord: i, Tags: s.Tags, Glosses: s.Glosses}
		}
		ms := counters.MeasuresOf(senses)
		if got := asFixture(ms); !slices.Equal(got, c.Measures) {
			t.Errorf("%s: measures = %+v, want %+v", c.Name, got, c.Measures)
		}
		if got := counters.ShownGloss(senses); got != c.Gloss {
			t.Errorf("%s: gloss = %q, want %q", c.Name, got, c.Gloss)
		}
		if got := counters.HasFallback(c.Written, ms); got != c.Fallback {
			t.Errorf("%s: fallback = %v, want %v", c.Name, got, c.Fallback)
		}
	}
}
