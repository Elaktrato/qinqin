package api

import (
	"encoding/json"
	"os"
	"sort"
	"testing"
)

// docs/contracts/auth/tokens-routes.json lists every route an access token
// may use, generated from the route rows; scripts/gen-api-docs.mjs renders
// it as the Token column of the wiki's API routes page. Regenerate with
// UPDATE_TOKEN_ROUTES_FIXTURE=1 go test -run TokenRoutesFixture ./internal/api/.
const tokenRoutesFixturePath = "../../../docs/contracts/auth/tokens-routes.json"

type tokenRouteRow struct {
	Pattern   string `json:"pattern"`
	Scope     string `json:"scope"`
	Workspace string `json:"workspace"`
}

func TestTokenRoutesFixture(t *testing.T) {
	s, _, _, _ := newGateServer(t)
	scope := map[tokenScope]string{tokRead: "read", tokWrite: "write"}
	ws := map[tokenWS]string{wsNone: "refused", wsGlobal: "any", wsQuery: "query"}
	rows := []tokenRouteRow{}
	for _, rt := range s.routes() {
		if rt.token == noTok {
			continue
		}
		rows = append(rows, tokenRouteRow{rt.pattern, scope[rt.token.scope], ws[rt.token.ws]})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Pattern < rows[j].Pattern })
	doc := struct {
		Doc    string          `json:"_doc"`
		Routes []tokenRouteRow `json:"routes"`
	}{
		Doc:    "GENERATED from the route table by server/internal/api/tokens_routes_fixture_test.go (UPDATE_TOKEN_ROUTES_FIXTURE=1). Every route a personal access token may use; every other route answers 403 token_not_allowed. scope: read (a read or write token) or write (a write token). workspace: how a token limited to one workspace fares - any (the route reads no per-workspace data), query (the request must carry ?workspace= with the token's workspace) or refused (the route spans workspaces or addresses objects by id: 403 token_workspace).",
		Routes: rows,
	}
	want, _ := json.MarshalIndent(doc, "", "\t")
	want = append(want, '\n')
	if os.Getenv("UPDATE_TOKEN_ROUTES_FIXTURE") != "" {
		if err := os.WriteFile(tokenRoutesFixturePath, want, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	have, err := os.ReadFile(tokenRoutesFixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v (regenerate with UPDATE_TOKEN_ROUTES_FIXTURE=1)", err)
	}
	if string(have) != string(want) {
		t.Fatalf("token rules and %s differ: regenerate with UPDATE_TOKEN_ROUTES_FIXTURE=1 and review the diff", tokenRoutesFixturePath)
	}
}
