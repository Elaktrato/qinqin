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

func coreNote(ws int64, key, data, updated string, modified *string) PluginRow {
	return PluginRow{PluginID: CorePlugin, WorkspaceID: &ws, Key: key, Data: json.RawMessage(data), UpdatedAt: updated, ModifiedAt: modified}
}

func strp(s string) *string { return &s }

// Two archive notes whose entries map to the same target entry: the newest
// (modifiedAt, else updatedAt) wins, a tie goes to the smaller source entry
// id, and the loser is dropped. Nothing blocks.
func TestNoteCollisionNewestWins(t *testing.T) {
	cases := []struct {
		name   string
		a, b   PluginRow
		winner string
	}{
		{"newer modifiedAt wins",
			coreNote(7, "note:1", `{"version":1,"entryId":1,"text":"a"}`, "2026-11-20T00:00:00Z", strp("2026-11-01T00:00:00Z")),
			coreNote(7, "note:2", `{"version":1,"entryId":2,"text":"b"}`, "2026-11-02T00:00:00Z", strp("2026-11-02T00:00:00Z")),
			"note:2"},
		{"updatedAt when modifiedAt is null",
			coreNote(7, "note:1", `{"version":1,"entryId":1,"text":"a"}`, "2026-11-05T00:00:00Z", nil),
			coreNote(7, "note:2", `{"version":1,"entryId":2,"text":"b"}`, "2026-11-02T00:00:00Z", strp("2026-11-04T00:00:00Z")),
			"note:1"},
		{"tie goes to the smaller source entry id",
			coreNote(7, "note:10", `{"version":1,"entryId":10,"text":"a"}`, "2026-11-05T00:00:00Z", nil),
			coreNote(7, "note:9", `{"version":1,"entryId":9,"text":"b"}`, "2026-11-05T00:00:00Z", nil),
			"note:9"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			for _, order := range [][2]PluginRow{{c.a, c.b}, {c.b, c.a}} {
				m := NewMaps()
				m.Workspaces[7] = 70
				for _, r := range order {
					src, _ := strconv.ParseInt(r.Key[len("note:"):], 10, 64)
					m.Entries[src] = 500
				}
				for _, r := range order {
					m.RegisterNote(r)
				}
				kept := 0
				for _, r := range order {
					nr, drop := m.PluginRow(r)
					if drop {
						if r.Key == c.winner {
							t.Errorf("winner %s dropped", r.Key)
						}
						continue
					}
					kept++
					if r.Key != c.winner {
						t.Errorf("loser %s kept", r.Key)
					}
					if nr.Key != "note:500" || *nr.WorkspaceID != 70 {
						t.Errorf("kept row %+v", nr)
					}
					if id, _ := intMember(nr.Data, "entryId"); id != 500 {
						t.Errorf("entryId %d", id)
					}
				}
				if kept != 1 {
					t.Errorf("kept %d rows, want 1", kept)
				}
			}
		})
	}
}

// The same target entry in two workspaces is two notes, both kept.
func TestNoteCollisionIsPerWorkspace(t *testing.T) {
	m := NewMaps()
	m.Workspaces[7], m.Workspaces[8] = 70, 80
	m.Entries[1] = 500
	a := coreNote(7, "note:1", `{"version":1,"entryId":1,"text":"a"}`, "2026-11-05T00:00:00Z", nil)
	b := coreNote(8, "note:1", `{"version":1,"entryId":1,"text":"b"}`, "2026-11-06T00:00:00Z", nil)
	m.RegisterNote(a)
	m.RegisterNote(b)
	for _, r := range []PluginRow{a, b} {
		if _, drop := m.PluginRow(r); drop {
			t.Errorf("%v dropped", r)
		}
	}
}

// Without RegisterNote every note is its own winner (single-source behaviour).
func TestNoteWithoutRegisterIsItsOwnWinner(t *testing.T) {
	m := NewMaps()
	m.Workspaces[7] = 70
	m.Entries[1], m.Entries[2] = 500, 500
	for _, r := range []PluginRow{
		coreNote(7, "note:1", `{"version":1,"entryId":1,"text":"a"}`, "2026-11-05T00:00:00Z", nil),
		coreNote(7, "note:2", `{"version":1,"entryId":2,"text":"b"}`, "2026-11-06T00:00:00Z", nil),
	} {
		if nr, drop := m.PluginRow(r); drop || nr.Key != "note:500" {
			t.Errorf("%s: drop=%v key=%s", r.Key, drop, nr.Key)
		}
	}
}

// Member order and the bytes of untouched values survive a note rewrite.
func TestNoteRewriteKeepsOtherBytes(t *testing.T) {
	m := NewMaps()
	m.Workspaces[7] = 70
	m.Entries[1201] = 1250
	in := coreNote(7, "note:1201", `{"text":"马\n<b>x</b>","zeta":{"b": 1,"a":[3, 2,1]},"entryId":1201,"version":1}`, "2026-11-05T00:00:00Z", nil)
	out, drop := m.PluginRow(in)
	want := `{"text":"马\n<b>x</b>","zeta":{"b": 1,"a":[3, 2,1]},"entryId":1250,"version":1}`
	if drop || out.Key != "note:1250" || string(out.Data) != want {
		t.Errorf("got %s %s want %s", out.Key, out.Data, want)
	}
}

// Keys that are not canonical note keys are left alone.
func TestNonCanonicalNoteKeysUntouched(t *testing.T) {
	m := NewMaps()
	m.Workspaces[7] = 70
	m.Entries[1201], m.Entries[1] = 1250, 2
	for _, r := range []PluginRow{
		coreNote(7, "note:01201", `{"version":1,"entryId":1201,"text":"x"}`, "2026-11-05T00:00:00Z", nil),
		coreNote(7, "note:+1", `{"version":1,"entryId":1,"text":"x"}`, "2026-11-05T00:00:00Z", nil),
		coreNote(7, "note:1", `"not an object"`, "2026-11-05T00:00:00Z", nil),
		coreNote(7, "notecfg", `{"version":1,"onAnswer":false}`, "2026-11-05T00:00:00Z", nil),
	} {
		nr, drop := m.PluginRow(r)
		if drop || nr.Key != r.Key || string(nr.Data) != string(r.Data) {
			t.Errorf("%s changed: drop=%v %s %s", r.Key, drop, nr.Key, nr.Data)
		}
	}
}
