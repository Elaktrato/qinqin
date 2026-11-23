package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/model"
)

// docs/contracts/overlays/overlay.json `cases` through PUT /api/entries/{id}
// (the answer, the stored patch) and the pull v2 overlays row, pinned as
// built. The entry is 发 (zh character) of the test dictionaries.

const agedStamp = "2026-01-01T00:00:00Z"

type overlayStep struct {
	Put       json.RawMessage `json:"put"`
	UnknownID bool            `json:"unknownId"`
	Age       bool            `json:"age"`
	Expect    *struct {
		Status   int              `json:"status"`
		Error    string           `json:"error"`
		Written  *string          `json:"written"`
		Readings *[]model.Reading `json:"readings"`
	} `json:"expect"`
}

type overlayRow struct {
	Written  *string          `json:"written"`
	Readings *[]model.Reading `json:"readings"`
	Fresh    bool             `json:"fresh"`
}

func TestContractOverlays(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/overlays/overlay.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Rule  string `json:"rule"`
		Entry struct {
			Language string          `json:"language"`
			Kind     string          `json:"kind"`
			Key      string          `json:"key"`
			Written  string          `json:"written"`
			Readings []model.Reading `json:"readings"`
		} `json:"entry"`
		Cases []struct {
			Name  string        `json:"name"`
			Note  string        `json:"note"`
			Steps []overlayStep `json:"steps"`
			Row   *overlayRow   `json:"row"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if file.Rule != "overlays/overlay" || len(file.Cases) < 6 {
		t.Fatalf("rule %q, %d cases", file.Rule, len(file.Cases))
	}
	for _, c := range file.Cases {
		t.Run(c.Name, func(t *testing.T) {
			if c.Note == "" {
				t.Error("case without note")
			}
			ts, sqlDB := newServer(t)
			seedEntries(t, sqlDB)
			id := lexID(t, sqlDB, file.Entry.Language, file.Entry.Kind, file.Entry.Key)
			alice := registerUser(t, ts.URL, "alice", "")
			bob := registerUser(t, ts.URL, "bob", alice)
			createWorkspace(t, ts.URL, alice, "zh", "Chinese")
			createWorkspace(t, ts.URL, bob, "zh", "Chinese")

			// The shared entry as everyone sees it before any patch.
			shared := getEntryBody(t, ts.URL, id)
			if shared.Written != file.Entry.Written || !jsonSame(shared.Readings, file.Entry.Readings) {
				t.Fatalf("shared entry %q %+v, fixture %q %+v", shared.Written, shared.Readings, file.Entry.Written, file.Entry.Readings)
			}
			for i, st := range c.Steps {
				if st.Age {
					if _, err := sqlDB.Exec(`UPDATE user_edits SET updated_at = ?`, agedStamp); err != nil {
						t.Fatal(err)
					}
					continue
				}
				target := id
				if st.UnknownID {
					target = 999999
				}
				req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/entries/"+strconv.FormatInt(target, 10), strings.NewReader(string(st.Put)))
				req.Header.Set("Authorization", "Bearer "+alice)
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					t.Fatal(err)
				}
				body, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				if resp.StatusCode != st.Expect.Status {
					t.Fatalf("step %d: status %d, want %d: %.300s", i, resp.StatusCode, st.Expect.Status, body)
				}
				if st.Expect.Error != "" {
					if got := errorCode(t, body); got != st.Expect.Error {
						t.Errorf("step %d: body %s, want error %q", i, body, st.Expect.Error)
					}
				}
				if resp.StatusCode == http.StatusOK {
					var view entryBody
					if err := json.Unmarshal(body, &view); err != nil {
						t.Fatal(err)
					}
					if view.Written != *st.Expect.Written || !jsonSame(view.Readings, *st.Expect.Readings) {
						t.Errorf("step %d: view %q %+v, want %q %+v", i, view.Written, view.Readings, *st.Expect.Written, *st.Expect.Readings)
					}
				}
			}

			// The stored patch, as the pull v2 overlays row carries it.
			var written, readings, stamp *string
			err := sqlDB.QueryRow(`SELECT written, readings, updated_at FROM user_edits WHERE entry_id = ?`, id).Scan(&written, &readings, &stamp)
			if c.Row == nil {
				if err == nil {
					t.Fatalf("a row is stored: written %v readings %v", written, readings)
				}
				return
			}
			if err != nil {
				t.Fatalf("no stored row: %v", err)
			}
			if fresh := *stamp != agedStamp; fresh != c.Row.Fresh {
				t.Errorf("stamp %s: fresh %v, want %v", *stamp, fresh, c.Row.Fresh)
			}
			if _, err := sqlDB.Exec(`UPDATE user_edits SET updated_at = ?`, agedStamp); err != nil {
				t.Fatal(err)
			}
			_, _, pulled := get(t, ts.URL, "/api/sync/pull?v=2&collections=overlays", alice)
			var page v2Page
			if err := json.Unmarshal(pulled, &page); err != nil {
				t.Fatal(err)
			}
			rows := page.Collections["overlays"]
			if len(rows) != 1 {
				t.Fatalf("pulled %d overlay rows: %s", len(rows), pulled)
			}
			want, _ := json.Marshal(map[string]any{"entryId": id, "written": c.Row.Written, "readings": c.Row.Readings, "updatedAt": agedStamp})
			if !jsonValueEqual(rows[0], want) {
				t.Errorf("pulled row %s, want %s", rows[0], want)
			}
			_, _, other := get(t, ts.URL, "/api/sync/pull?v=2&collections=overlays", bob)
			var bobPage v2Page
			json.Unmarshal(other, &bobPage)
			if len(bobPage.Collections["overlays"]) != 0 {
				t.Errorf("bob pulls alice's overlay: %s", other)
			}
			if got := getEntryBody(t, ts.URL, id); got.Written != shared.Written {
				t.Errorf("an anonymous read sees %q, want the shared %q", got.Written, shared.Written)
			}
		})
	}
}

func jsonSame(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}
