package sync_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
	chinsync "qinqin/internal/sync"
)

// docs/contracts/sync/push-result.json straight through sync.Push (B5):
// every case with a JSON body that reaches Push (the 413 and malformed-body
// cases are the handler's, pinned in api/contract_push_test.go). A 200 case
// answers exactly its counts, a 400 case is ErrInvalid with the fixture's
// text and a 404 case ErrNotFound — and then nothing is applied.
func TestContractPushThroughPush(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/sync/push-result.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []struct {
			Name  string `json:"name"`
			Setup *struct {
				Events []json.RawMessage `json:"events"`
				Rows   []json.RawMessage `json:"rows"`
				Cards  []json.RawMessage `json:"cards"`
			} `json:"setup"`
			Body   json.RawMessage `json:"body"`
			Expect struct {
				Status     int                  `json:"status"`
				JSON       *chinsync.PushResult `json:"json"`
				Text       string               `json:"text"`
				TextPrefix string               `json:"textPrefix"`
			} `json:"expect"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	ran := 0
	for _, c := range file.Cases {
		if c.Body == nil || c.Expect.Status == 413 {
			continue
		}
		ran++
		t.Run(c.Name, func(t *testing.T) {
			ctx := context.Background()
			sqlDB := dbtest.Open(t)
			registerReserved(t, sqlDB)
			alice, bob := newUser(t, sqlDB, "alice"), newUser(t, sqlDB, "bob")
			ws, bobWS := newWorkspace(t, sqlDB, alice), newWorkspace(t, sqlDB, bob)
			expand := func(raw json.RawMessage) []byte {
				s := strings.ReplaceAll(string(raw), `"$ws"`, strconv.FormatInt(ws, 10))
				return []byte(strings.ReplaceAll(s, `"$bobWs"`, strconv.FormatInt(bobWS, 10)))
			}
			if s := c.Setup; s != nil {
				for _, e := range s.Events {
					var body chinsync.PushBody
					json.Unmarshal([]byte(`{"events":[`+string(expand(e))+`]}`), &body)
					if _, err := chinsync.Push(ctx, sqlDB, alice, body); err != nil {
						t.Fatal(err)
					}
				}
				for _, d := range s.Rows {
					var r struct {
						Key       string          `json:"key"`
						Data      json.RawMessage `json:"data"`
						UpdatedAt string          `json:"updatedAt"`
					}
					json.Unmarshal(expand(d), &r)
					if _, err := sqlDB.Exec(`INSERT INTO keyed_rows (user_id, workspace_id, key, data, version, updated_at, modified_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
						alice, ws, r.Key, string(r.Data), r.UpdatedAt, r.UpdatedAt); err != nil {
						t.Fatal(err)
					}
				}
				for _, raw := range s.Cards {
					row, err := rows.Decode(rows.Cards, expand(raw))
					if err != nil {
						t.Fatal(err)
					}
					at := row.M().UpdatedAt.UTC().Format("2006-01-02T15:04:05Z")
					if err := study.InsertStored(ctx, sqlDB, alice, row, 1, at, at, nil); err != nil {
						t.Fatal(err)
					}
				}
			}
			count := func() (n int) {
				sqlDB.QueryRow(`SELECT (SELECT COUNT(*) FROM study_events) + (SELECT COUNT(*) FROM keyed_rows) + (SELECT COUNT(*) FROM study_cards)`).Scan(&n)
				return n
			}
			before := count()
			var body chinsync.PushBody
			if err := json.Unmarshal(expand(c.Body), &body); err != nil {
				t.Fatal(err)
			}
			res, err := chinsync.Push(ctx, sqlDB, alice, body)
			switch c.Expect.Status {
			case 200:
				if err != nil || c.Expect.JSON == nil || res != *c.Expect.JSON {
					t.Errorf("Push = %+v, %v; want %+v", res, err, c.Expect.JSON)
				}
			case 400:
				if !errors.Is(err, chinsync.ErrInvalid) || (c.Expect.Text != "" && err.Error() != c.Expect.Text) ||
					!strings.HasPrefix(err.Error(), c.Expect.TextPrefix) {
					t.Errorf("Push error %v, want ErrInvalid %q%q", err, c.Expect.Text, c.Expect.TextPrefix)
				}
			case 404:
				if !errors.Is(err, chinsync.ErrNotFound) {
					t.Errorf("Push error %v, want ErrNotFound", err)
				}
			default:
				t.Fatalf("status %d not covered", c.Expect.Status)
			}
			if c.Expect.Status != 200 && count() != before {
				t.Errorf("a refused push applied rows: %d before, %d after", before, count())
			}
		})
	}
	if ran < 12 {
		t.Errorf("%d cases ran through Push", ran)
	}
}
