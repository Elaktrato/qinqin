package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/library"
)

// contract_library_test drives docs/contracts/library/rows.json against the
// library routes with two users: the row shapes, the position, colour,
// code-point range and overlap rules, isolation, and the deletion log.

type libraryContract struct {
	Version int                 `json:"version"`
	Rule    string              `json:"rule"`
	Shapes  map[string][]string `json:"shapes"`
	Colors  []string            `json:"colors"`
	Cases   []struct {
		Name        string         `json:"name"`
		As          string         `json:"as"`
		Method      string         `json:"method"`
		Path        string         `json:"path"`
		Body        map[string]any `json:"body"`
		Status      int            `json:"status"`
		Expect      map[string]any `json:"expect"`
		Shape       string         `json:"shape"`
		Save        string         `json:"save"`
		StampsEqual bool           `json:"stampsEqual"`
		ListLength  *int           `json:"listLength"`
	} `json:"cases"`
	DeletionsAfter []struct {
		Collection string `json:"collection"`
		Row        string `json:"row"`
	} `json:"deletionsAfter"`
}

func TestLibraryContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "library", "rows.json"))
	if err != nil {
		t.Fatal(err)
	}
	var c libraryContract
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	if err := dec.Decode(&c); err != nil {
		t.Fatal(err)
	}
	if c.Version != 1 || c.Rule != "library-rows" || len(c.Cases) == 0 {
		t.Fatalf("fixture header %d %q, %d cases", c.Version, c.Rule, len(c.Cases))
	}

	ts, sqlDB, dataDir := newServerWithDir(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	aliceID := userID(t, sqlDB, "alice")
	ws := createWorkspace(t, ts.URL, alice, "zh", "")
	createWorkspace(t, ts.URL, bob, "zh", "")
	store := library.Store{DB: sqlDB, Dir: filepath.Join(dataDir, "books")}
	b, err := store.Create(context.Background(), library.Book{UserID: aliceID, WorkspaceID: ws, Language: "zh", Title: "T", Source: "upload", SourceID: "s"},
		[]library.Chapter{
			{Title: "One", Paragraphs: []library.Paragraph{{{Text: "你好世界"}}}},
			{Title: "Two", Paragraphs: []library.Paragraph{{{Text: "再见"}}}},
		})
	if err != nil {
		t.Fatal(err)
	}
	saved := map[string]string{"book": strconv.FormatInt(b.ID, 10)}
	tokens := map[string]string{"alice": alice, "bob": bob, "": ""}
	expand := func(s string) string {
		for k, v := range saved {
			s = strings.ReplaceAll(s, "{"+k+"}", v)
		}
		return s
	}
	checkShape := func(name, shape string, row map[string]any) {
		want := c.Shapes[shape]
		if len(want) == 0 {
			t.Fatalf("%s: unknown shape %q", name, shape)
		}
		got := make([]string, 0, len(row))
		for k := range row {
			got = append(got, k)
		}
		sort.Strings(got)
		w := append([]string{}, want...)
		sort.Strings(w)
		if fmt.Sprint(got) != fmt.Sprint(w) {
			t.Errorf("%s: %s keys %v, want %v", name, shape, got, w)
		}
	}

	for _, tc := range c.Cases {
		body := ""
		if tc.Body != nil {
			for k, v := range tc.Body {
				if s, ok := v.(string); ok && strings.HasPrefix(s, "$") {
					n, err := strconv.Atoi(s[1:])
					if err != nil {
						t.Fatalf("%s: body %q", tc.Name, s)
					}
					tc.Body[k] = strings.Repeat("0", n)
				}
			}
			bs, _ := json.Marshal(tc.Body)
			body = string(bs)
		}
		resp := doRaw(t, tc.Method, ts.URL, expand(tc.Path), tokens[tc.As], body)
		data, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != tc.Status {
			t.Errorf("%s: status %d, want %d (%s)", tc.Name, resp.StatusCode, tc.Status, data)
			continue
		}
		if tc.ListLength != nil {
			var list []map[string]any
			if err := json.Unmarshal(data, &list); err != nil {
				t.Errorf("%s: %v (%s)", tc.Name, err, data)
				continue
			}
			if len(list) != *tc.ListLength {
				t.Errorf("%s: %d rows, want %d", tc.Name, len(list), *tc.ListLength)
			}
			for _, row := range list {
				checkShape(tc.Name, tc.Shape, row)
			}
			continue
		}
		if tc.Expect == nil && tc.Shape == "" {
			continue
		}
		var row map[string]any
		if err := json.Unmarshal(data, &row); err != nil {
			t.Errorf("%s: %v (%s)", tc.Name, err, data)
			continue
		}
		if tc.Shape != "" {
			checkShape(tc.Name, tc.Shape, row)
		}
		for k, want := range tc.Expect {
			if s, ok := want.(string); ok && strings.HasPrefix(s, "$") {
				id, _ := strconv.ParseFloat(saved[s[1:]], 64)
				want = id
			}
			if fmt.Sprint(row[k]) != fmt.Sprint(want) {
				t.Errorf("%s: %s = %v, want %v", tc.Name, k, row[k], want)
			}
		}
		if tc.StampsEqual && (row["updatedAt"] == nil || row["updatedAt"] != row["createdAt"]) {
			t.Errorf("%s: updatedAt %v, createdAt %v", tc.Name, row["updatedAt"], row["createdAt"])
		}
		if tc.Save != "" {
			saved[tc.Save] = fmt.Sprint(int64(row["id"].(float64)))
		}
		for _, color := range []string{fmt.Sprint(row["color"])} {
			if tc.Shape == "highlight" && !contains(c.Colors, color) {
				t.Errorf("%s: colour %q is not one of %v", tc.Name, color, c.Colors)
			}
		}
	}

	// The deletion log holds exactly alice's deleted rows.
	var want []string
	for _, d := range c.DeletionsAfter {
		want = append(want, d.Collection+"/"+saved[strings.TrimPrefix(d.Row, "$")])
	}
	sort.Strings(want)
	rs, err := sqlDB.Query(`SELECT collection, row_id, user_id, workspace_id FROM library_deletions ORDER BY collection, row_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var got []string
	for rs.Next() {
		var coll string
		var row, user, w int64
		if err := rs.Scan(&coll, &row, &user, &w); err != nil {
			t.Fatal(err)
		}
		if user != aliceID || w != ws {
			t.Errorf("deletion %s/%d of user %d workspace %d", coll, row, user, w)
		}
		got = append(got, coll+"/"+strconv.FormatInt(row, 10))
	}
	sort.Strings(got)
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("library_deletions %v, want %v", got, want)
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
