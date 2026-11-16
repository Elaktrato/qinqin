package api

import (
	"encoding/json"
	"os"
	"sort"
	"testing"
)

// The web service worker decides per route whether a response may be cached
// (apps/web/src/lib/pwa/sw/classify.ts). Its tests read this fixture, so a
// route added to routes() fails here until the fixture - and with it the
// worker's classification decision - is updated. Regenerate with
// UPDATE_ROUTES_FIXTURE=1 go test -run RoutesFixture ./internal/api/ and
// review the diff: a new GET route is "bypass" unless classify.ts opts it in.
const routesFixturePath = "../../../apps/web/src/lib/pwa/sw/routes.fixture.json"

type fixtureRoute struct {
	Pattern string `json:"pattern"`
	Access  string `json:"access"`
}

func TestRoutesFixture(t *testing.T) {
	s, _, _, _, _ := newGateServerFresh(t)
	var got []fixtureRoute
	for _, rt := range s.routes() {
		got = append(got, fixtureRoute{rt.pattern, string(rt.access)})
	}
	sort.Slice(got, func(i, j int) bool { return got[i].Pattern < got[j].Pattern })
	want, _ := json.MarshalIndent(got, "", "\t")
	want = append(want, '\n')
	if os.Getenv("UPDATE_ROUTES_FIXTURE") != "" {
		if err := os.WriteFile(routesFixturePath, want, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	have, err := os.ReadFile(routesFixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v (regenerate with UPDATE_ROUTES_FIXTURE=1)", err)
	}
	if string(have) != string(want) {
		t.Fatalf("routes() and %s differ: a route was added, removed or re-protected. Regenerate with UPDATE_ROUTES_FIXTURE=1 and decide in classify.ts whether the new GET route may be cached offline (default: no)", routesFixturePath)
	}
}
