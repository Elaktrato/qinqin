package backup

import (
	"encoding/json"
	"os"
	"reflect"
	"strconv"
	"testing"
)

type remapCase struct {
	Name   string                      `json:"name"`
	Op     string                      `json:"op"`
	Maps   map[string]map[string]int64 `json:"maps"`
	Input  json.RawMessage             `json:"input"`
	Expect json.RawMessage             `json:"expect"`
	Note   string                      `json:"note"`
}

func (c remapCase) buildMaps() *Maps {
	m := NewMaps()
	fill := func(dst map[int64]int64, src map[string]int64) {
		for k, v := range src {
			id, _ := strconv.ParseInt(k, 10, 64)
			dst[id] = v
		}
	}
	fill(m.Entries, c.Maps["entries"])
	fill(m.Sentences, c.Maps["sentences"])
	fill(m.Workspaces, c.Maps["workspaces"])
	fill(m.Books, c.Maps["books"])
	fill(m.Dicts, c.Maps["dicts"])
	return m
}

// norm re-marshals through any so key order and spacing do not matter in comparisons.
func norm(t *testing.T, raw []byte) any {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("bad JSON %s: %v", raw, err)
	}
	return v
}

func TestRemapCases(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/backup/remap.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Doc     string      `json:"_doc"`
		Version int         `json:"version"`
		Rule    string      `json:"rule"`
		Cases   []remapCase `json:"cases"`
	}
	strictDecode(t, raw, &fx)
	if len(fx.Cases) < 20 {
		t.Fatalf("only %d cases", len(fx.Cases))
	}
	for _, c := range fx.Cases {
		c := c
		t.Run(c.Name, func(t *testing.T) {
			m := c.buildMaps()
			switch c.Op {
			case "card":
				var in struct {
					Key  string          `json:"key"`
					Data json.RawMessage `json:"data"`
				}
				json.Unmarshal(c.Input, &in)
				key, data, drop := m.Card(in.Key, in.Data)
				got := map[string]any{"drop": drop}
				if !drop {
					got["key"], got["data"] = key, norm(t, data)
				}
				want := norm(t, c.Expect)
				if !reflect.DeepEqual(any(got), want) {
					t.Errorf("got %v\nwant %v", got, want)
				}
			case "events":
				var in struct {
					Cards []struct {
						Key  string          `json:"key"`
						Data json.RawMessage `json:"data"`
					} `json:"cards"`
					Events []Event `json:"events"`
				}
				json.Unmarshal(c.Input, &in)
				for _, cd := range in.Cards {
					m.RegisterCard(cd.Key, cd.Data)
				}
				var out []any
				for _, e := range in.Events {
					ne, drop := m.Event(e)
					if drop {
						out = append(out, map[string]any{"drop": true})
						continue
					}
					out = append(out, map[string]any{"drop": false, "workspaceId": float64(ne.WorkspaceID), "payload": norm(t, ne.Payload)})
				}
				want := norm(t, c.Expect).(map[string]any)["events"]
				if !reflect.DeepEqual(any(out), want) {
					t.Errorf("got %v\nwant %v", out, want)
				}
			case "pluginRow":
				var in PluginRow
				if err := json.Unmarshal(c.Input, &in); err != nil {
					t.Fatal(err)
				}
				nr, drop := m.PluginRow(in)
				got := map[string]any{"drop": drop}
				if !drop {
					got["workspaceId"] = nil
					if nr.WorkspaceID != nil {
						got["workspaceId"] = float64(*nr.WorkspaceID)
					}
					got["key"], got["data"] = nr.Key, norm(t, nr.Data)
				}
				if !reflect.DeepEqual(any(got), norm(t, c.Expect)) {
					t.Errorf("got %v\nwant %s", got, c.Expect)
				}
			case "workspaceSettings":
				got := norm(t, m.WorkspaceSettings(c.Input))
				if !reflect.DeepEqual(got, norm(t, c.Expect)) {
					t.Errorf("got %v want %s", got, c.Expect)
				}
			default:
				t.Fatalf("unknown op %q", c.Op)
			}
		})
	}
}

// Member order and the bytes of untouched values survive a rewrite.
func TestCardRewriteKeepsUnknownFieldBytes(t *testing.T) {
	m := NewMaps()
	m.Entries[1] = 2
	in := json.RawMessage(`{"zeta":{"b": 1,"a":[3, 2,1]},"id":"c-vocab-1","entryId":1,"x":"ä"}`)
	_, out, drop := m.Card("card:c-vocab-1", in)
	want := `{"zeta":{"b": 1,"a":[3, 2,1]},"id":"c-vocab-2","entryId":2,"x":"ä"}`
	if drop || string(out) != want {
		t.Errorf("got %s want %s", out, want)
	}
}
