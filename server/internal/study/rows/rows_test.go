package rows

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
)

const contractDir = "../../../../docs/contracts/study/"

func readFixture(t *testing.T, name string, v any) {
	t.Helper()
	raw, err := os.ReadFile(contractDir + name)
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

// jsonValue decodes raw as a JSON value with numbers kept as text.
func jsonValue(t *testing.T, raw []byte) any {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return normNumbers(v)
}

// normNumbers turns json.Number into float64 so 420 and 420.0 compare equal
// as JSON values (the fixtures are written by Python, which writes 1.0).
func normNumbers(v any) any {
	switch x := v.(type) {
	case json.Number:
		f, _ := x.Float64()
		return f
	case map[string]any:
		for k, e := range x {
			x[k] = normNumbers(e)
		}
	case []any:
		for i, e := range x {
			x[i] = normNumbers(e)
		}
	}
	return v
}

type rowsFixture struct {
	Version     int               `json:"version"`
	Rule        string            `json:"rule"`
	Collections []string          `json:"collections"`
	Identity    map[string]string `json:"identity"`
	Cases       []struct {
		Name       string          `json:"name"`
		Collection string          `json:"collection"`
		Valid      bool            `json:"valid"`
		Member     string          `json:"member"`
		Row        json.RawMessage `json:"row"`
	} `json:"cases"`
}

func TestRowsFixture(t *testing.T) {
	var fx rowsFixture
	readFixture(t, "rows.json", &fx)
	if fx.Version != 1 || fx.Rule != "study/rows" {
		t.Fatalf("fixture header %d %q", fx.Version, fx.Rule)
	}
	var names []string
	for _, f := range Families {
		names = append(names, string(f))
	}
	if !reflect.DeepEqual(names, fx.Collections) {
		t.Errorf("Families = %v, fixture collections %v", names, fx.Collections)
	}
	seen := map[string][2]int{}
	for _, c := range fx.Cases {
		t.Run(c.Collection+"/"+c.Name, func(t *testing.T) {
			r, err := Decode(Family(c.Collection), c.Row)
			counts := seen[c.Collection]
			if c.Valid {
				counts[0]++
				if err != nil {
					t.Fatalf("Decode: %v", err)
				}
				if string(r.Family()) != c.Collection {
					t.Errorf("Family = %s", r.Family())
				}
				back, err := json.Marshal(r)
				if err != nil {
					t.Fatal(err)
				}
				if got, want := jsonValue(t, back), jsonValue(t, c.Row); !reflect.DeepEqual(got, want) {
					t.Errorf("encode back:\n got %s\nwant %s", back, c.Row)
				}
				var m map[string]json.RawMessage
				json.Unmarshal(c.Row, &m)
				if key := fx.Identity[c.Collection]; key != "" {
					var id *string
					json.Unmarshal(m[key], &id)
					want := ""
					if id != nil {
						want = *id
					}
					if r.Identity() != want {
						t.Errorf("Identity = %q, want %q", r.Identity(), want)
					}
				} else if r.Identity() != "" {
					t.Errorf("Identity = %q, want empty", r.Identity())
				}
			} else {
				counts[1]++
				if !errors.Is(err, ErrInvalid) {
					t.Fatalf("Decode = %v, %v; want ErrInvalid", r, err)
				}
				if !strings.Contains(err.Error(), c.Member) {
					t.Errorf("error %q does not name %q", err, c.Member)
				}
			}
			seen[c.Collection] = counts
		})
	}
	for _, f := range Families {
		if n := seen[string(f)]; n[0] == 0 {
			t.Errorf("no valid case for %s", f)
		}
	}
}

// Every type encodes every key, even when built with nil slices and extra.
func TestEveryKeyAlwaysPresent(t *testing.T) {
	want := map[Family][]string{
		Cards:        {"id", "kind", "entryId", "written", "entryKind", "sentenceId", "skipKinds", "deckIds", "createdAt"},
		Decks:        {"id", "name", "createdAt", "source"},
		DeckSettings: {"deckId", "cardTypes", "newOrder"},
		Limits:       {"deckId", "new", "reviews"},
		FsrsSets:     {"id", "w", "createdAt", "source", "labelled", "logLoss", "baselineLogLoss"},
		FsrsActive:   {"setId", "changedAt"},
	}
	for f, keys := range want {
		r := New(f)
		raw, err := json.Marshal(r)
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]json.RawMessage
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		all := append(append([]string{}, keys...), "extra", "workspaceId", "version", "updatedAt", "deletedAt")
		if len(m) != len(all) {
			t.Errorf("%s: %s has %d keys, want %d", f, raw, len(m), len(all))
		}
		for _, k := range all {
			if _, ok := m[k]; !ok {
				t.Errorf("%s: %s lacks %q", f, raw, k)
			}
		}
		if string(m["extra"]) != "{}" {
			t.Errorf("%s: extra = %s, want {}", f, m["extra"])
		}
		for _, k := range []string{"skipKinds", "deckIds", "cardTypes", "w"} {
			if v, ok := m[k]; ok && string(v) != "[]" {
				t.Errorf("%s: %s = %s, want []", f, k, v)
			}
		}
	}
}

// A set typed member wins over an extra member of the same name: Validate
// drops the shadowed member, and keeps an extra member of a null one.
func TestValidateDropsShadowedExtra(t *testing.T) {
	raw := []byte(`{"workspaceId":7,"id":"c1","kind":"vocab","entryId":5,"written":"x","entryKind":null,"sentenceId":null,
		"skipKinds":[],"deckIds":[],"createdAt":"t","extra":{"written":"old","entryKind":"word","id":"other","skipKinds":["tone"],"keep":1},
		"version":1,"updatedAt":"2026-11-12T10:00:00Z","deletedAt":null}`)
	r, err := Decode(Cards, raw)
	if err != nil {
		t.Fatal(err)
	}
	c := r.(*Card)
	if got, want := jsonValue(t, c.Extra), jsonValue(t, []byte(`{"entryKind":"word","skipKinds":["tone"],"keep":1}`)); !reflect.DeepEqual(got, want) {
		t.Errorf("extra = %s", c.Extra)
	}
	raw = []byte(`{"workspaceId":7,"deckId":"general","cardTypes":[],"newOrder":{"by":"added"},
		"extra":{"newOrder":{"by":"level"},"updatedAt":"x","deckId":"y","cardTypes":[1],"zoom":2},"version":1,"updatedAt":"2026-11-12T10:00:00Z","deletedAt":null}`)
	r, err = Decode(DeckSettings, raw)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(r.(*DeckSettingsRow).Extra); got != `{"zoom":2}` {
		t.Errorf("deck settings extra = %s", got)
	}
	raw = []byte(`{"workspaceId":7,"deckId":null,"new":null,"reviews":{"limit":3},"extra":{"version":2,"new":10000,"reviews":1},
		"version":1,"updatedAt":"2026-11-12T10:00:00Z","deletedAt":null}`)
	r, err = Decode(Limits, raw)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(r.(*LimitsRow).Extra); got != `{"new":10000}` {
		t.Errorf("limits extra = %s", got)
	}
}

func TestEqual(t *testing.T) {
	a := &Card{ID: "c", Kind: "vocab", EntryID: 1, CreatedAt: "t", Extra: json.RawMessage(`{"a":1,"b":[1,2]}`), Meta: Meta{WorkspaceID: 1, Version: 1}}
	b := &Card{ID: "c", Kind: "vocab", EntryID: 1, CreatedAt: "t", DeckIDs: []string{}, SkipKinds: nil, Extra: json.RawMessage(` { "b" : [1,2], "a":1 }`), Meta: Meta{WorkspaceID: 1, Version: 9}}
	if !Equal(a, b) {
		t.Error("equal content with other meta and key order is not Equal")
	}
	b.DeckIDs = []string{"general"}
	if Equal(a, b) {
		t.Error("different deck ids are Equal")
	}
	if Equal(a, &Deck{ID: "c"}) {
		t.Error("different families are Equal")
	}
}
