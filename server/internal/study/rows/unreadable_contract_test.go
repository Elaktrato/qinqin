package rows

import (
	"encoding/json"
	"os"
	"testing"
)

// docs/contracts/sync/unreadable-rows.json: a reader skips the typed rows the
// strict decode refuses and keeps the rest ("Reading rows" in the sync README).
// The server never sends such a row, but "unreadable" must mean the same thing
// here as in every reader: each typed row of the fixture decodes exactly when
// the fixture calls it readable.
func TestUnreadableRowsFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../docs/contracts/sync/unreadable-rows.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Version int    `json:"version"`
		Rule    string `json:"rule"`
		Rows    map[string][]struct {
			Why string          `json:"_why"`
			Row json.RawMessage `json:"row"`
		} `json:"rows"`
		Expect struct {
			Readable   map[string][]string `json:"readable"`
			Unreadable map[string]int      `json:"unreadable"`
		} `json:"expect"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Version != 1 || fx.Rule != "sync/unreadable-rows" {
		t.Fatalf("fixture header %d %q", fx.Version, fx.Rule)
	}
	for _, f := range Families {
		list, ok := fx.Rows[string(f)]
		if !ok {
			t.Errorf("%s: no rows in the fixture", f)
			continue
		}
		var readable []string
		unreadable := 0
		for i, r := range list {
			row, err := Decode(f, r.Row)
			want := r.Why == "readable"
			if (err == nil) != want {
				t.Errorf("%s[%d] (%s): Decode error %v, readable %v", f, i, r.Why, err, want)
				continue
			}
			if err != nil {
				unreadable++
				continue
			}
			readable = append(readable, row.Identity())
		}
		if got, want := len(readable), len(fx.Expect.Readable[string(f)]); got != want {
			t.Errorf("%s: %d readable rows, fixture expects %d", f, got, want)
		}
		for i, id := range readable {
			if i < len(fx.Expect.Readable[string(f)]) && fx.Expect.Readable[string(f)][i] != id {
				t.Errorf("%s: readable identity %q, fixture %q", f, id, fx.Expect.Readable[string(f)][i])
			}
		}
		// A reader counts fewer than fail here (tombstones and other
		// workspaces are not counted), never more.
		if unreadable < fx.Expect.Unreadable[string(f)] {
			t.Errorf("%s: %d rows fail Decode, fixture counts %d unreadable", f, unreadable, fx.Expect.Unreadable[string(f)])
		}
	}
}
