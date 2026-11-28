package api_test

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/features"
)

// The feature switches (#199): per user, every core feature listed, an
// unknown id refused.
func TestFeatureRoutes(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	if r := doJSON(t, http.MethodGet, ts.URL, "/api/features", "", nil); r.StatusCode != 401 {
		t.Errorf("GET without a token: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodPut, ts.URL, "/api/features/journal", "", map[string]any{"enabled": false}); r.StatusCode != 401 {
		t.Errorf("PUT without a token: %d", r.StatusCode)
	}
	type sw struct {
		ID        string  `json:"id"`
		Enabled   bool    `json:"enabled"`
		UpdatedAt *string `json:"updatedAt"`
	}
	list := func(token string) []sw {
		t.Helper()
		var out []sw
		r := doJSON(t, http.MethodGet, ts.URL, "/api/features", token, nil)
		decodeJSON(t, r, &out)
		if r.StatusCode != 200 {
			t.Fatalf("GET: %d", r.StatusCode)
		}
		return out
	}
	got := list(alice)
	want := []string{"flashcards", "reader", "journal", "grammar", "scripts", "courses", "stats"}
	if len(got) != len(want) {
		t.Fatalf("list = %+v", got)
	}
	for i, s := range got {
		if s.ID != want[i] || !s.Enabled || s.UpdatedAt != nil {
			t.Errorf("default %d = %+v", i, s)
		}
	}
	var stored sw
	r := doJSON(t, http.MethodPut, ts.URL, "/api/features/journal", alice, map[string]any{"enabled": false})
	decodeJSON(t, r, &stored)
	if r.StatusCode != 200 || stored.ID != "journal" || stored.Enabled || stored.UpdatedAt == nil {
		t.Fatalf("PUT = %d %+v", r.StatusCode, stored)
	}
	if got := list(alice); got[2].Enabled {
		t.Error("the switch did not stick")
	}
	if got := list(bob); !got[2].Enabled {
		t.Error("alice's switch reached bob")
	}
	if r := doJSON(t, http.MethodPut, ts.URL, "/api/features/qinqin-journal", alice, map[string]any{"enabled": false}); r.StatusCode != 404 {
		t.Errorf("an unknown feature: %d, want 404", r.StatusCode)
	}
	if r := doJSON(t, http.MethodPut, ts.URL, "/api/features/journal", alice, map[string]any{}); r.StatusCode != 400 {
		t.Errorf("no enabled: %d, want 400", r.StatusCode)
	}
}

// Every feature the server knows can be switched off and on again (#294): a
// feature added to features.IDs without the database accepting it fails here.
func TestEveryFeatureSwitchesOffAndOn(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	state := func(id string) bool {
		t.Helper()
		var out []struct {
			ID      string `json:"id"`
			Enabled bool   `json:"enabled"`
		}
		r := doJSON(t, http.MethodGet, ts.URL, "/api/features", alice, nil)
		decodeJSON(t, r, &out)
		for _, s := range out {
			if s.ID == id {
				return s.Enabled
			}
		}
		t.Fatalf("%s missing from GET /api/features", id)
		return false
	}
	for _, id := range features.IDs {
		for _, on := range []bool{false, true, false, true} {
			var got struct {
				ID      string `json:"id"`
				Enabled bool   `json:"enabled"`
			}
			r := doJSON(t, http.MethodPut, ts.URL, "/api/features/"+id, alice, map[string]any{"enabled": on})
			decodeJSON(t, r, &got)
			if r.StatusCode != 200 || got.ID != id || got.Enabled != on {
				t.Fatalf("PUT %s enabled=%v: %d %+v", id, on, r.StatusCode, got)
			}
			if state(id) != on {
				t.Errorf("%s: GET does not show enabled=%v", id, on)
			}
		}
	}
}

// docs/contracts/features/switches.json: the order of GET /api/features and
// the answers of PUT /api/features/{id}.
func TestFeaturesContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "features", "switches.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Features []string `json:"features"`
		Put      []struct {
			Name   string         `json:"name"`
			ID     string         `json:"id"`
			Body   map[string]any `json:"body"`
			Status int            `json:"status"`
		} `json:"put"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(features.IDs, fx.Features) {
		t.Errorf("features.IDs = %v, fixture %v", features.IDs, fx.Features)
	}
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	var got []struct {
		ID string `json:"id"`
	}
	decodeJSON(t, doJSON(t, http.MethodGet, ts.URL, "/api/features", alice, nil), &got)
	ids := make([]string, len(got))
	for i, s := range got {
		ids[i] = s.ID
	}
	if !slices.Equal(ids, fx.Features) {
		t.Errorf("GET order = %v, want %v", ids, fx.Features)
	}
	for _, c := range fx.Put {
		if r := doJSON(t, http.MethodPut, ts.URL, "/api/features/"+c.ID, alice, c.Body); r.StatusCode != c.Status {
			t.Errorf("%s: %d, want %d", c.Name, r.StatusCode, c.Status)
		}
	}
}
