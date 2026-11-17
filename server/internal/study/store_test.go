package study_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"qinqin/internal/db"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "q.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	for _, s := range []string{
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't'), (2, 'bob', 'h', 0, 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (7, 1, 'zh', '', '{}', 't'), (8, 1, 'ja', '', '{}', 't'), (9, 2, 'zh', '', '{}', 't')`,
	} {
		if _, err := sqlDB.Exec(s); err != nil {
			t.Fatal(err)
		}
	}
	return sqlDB
}

func ts(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func clockAt(t *testing.T, s string) func() {
	at := ts(t, s)
	return study.SetNowForTest(func() time.Time { return at })
}

// decodeBody builds a typed row from a fixture body (no meta) for a workspace.
func decodeBody(t *testing.T, f rows.Family, body json.RawMessage, ws int64, updatedAt string) rows.Row {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatal(err)
	}
	m["workspaceId"], _ = json.Marshal(ws)
	m["updatedAt"], _ = json.Marshal(updatedAt)
	raw, _ := json.Marshal(m)
	r, err := rows.Decode(f, raw)
	if err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return r
}

type stored struct {
	Row        json.RawMessage `json:"row"`
	ModifiedAt string          `json:"modifiedAt"`
	Version    int             `json:"version"`
	UpdatedAt  string          `json:"updatedAt"`
	DeletedAt  *string         `json:"deletedAt"`
}

func TestLWWFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/study/lww.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Now   string `json:"now"`
		Cases []struct {
			Name       string  `json:"name"`
			Collection string  `json:"collection"`
			Stored     *stored `json:"stored"`
			Push       struct {
				UpdatedAt string          `json:"updatedAt"`
				DeletedAt *string         `json:"deletedAt"`
				Row       json.RawMessage `json:"row"`
			} `json:"push"`
			Expect      string  `json:"expect"`
			StoredAfter *stored `json:"storedAfter"`
		} `json:"cases"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(&fx); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			sqlDB := openDB(t)
			f := rows.Family(c.Collection)
			var identity string
			if c.Stored != nil {
				r := decodeBody(t, f, c.Stored.Row, 7, c.Stored.UpdatedAt)
				identity = r.Identity()
				var del *string
				if c.Stored.DeletedAt != nil {
					del = c.Stored.DeletedAt
				}
				if err := study.InsertStored(ctx, sqlDB, 1, r, c.Stored.Version, c.Stored.UpdatedAt, c.Stored.ModifiedAt, del); err != nil {
					t.Fatal(err)
				}
			}
			defer clockAt(t, fx.Now)()
			r := decodeBody(t, f, c.Push.Row, 7, c.Push.UpdatedAt)
			identity = r.Identity()
			var deletedAt *time.Time
			if c.Push.DeletedAt != nil {
				d := ts(t, *c.Push.DeletedAt)
				deletedAt = &d
			}
			outcome, err := study.ApplyOutcome(ctx, sqlDB, 1, r, study.EditTime(r.M().UpdatedAt, deletedAt), deletedAt != nil)
			if err != nil {
				t.Fatal(err)
			}
			if outcome.String() != c.Expect {
				t.Errorf("outcome = %s, want %s", outcome, c.Expect)
			}
			got, ok, err := study.Load(ctx, sqlDB, 1, 7, f, identity)
			if err != nil {
				t.Fatal(err)
			}
			if c.StoredAfter == nil {
				if ok {
					t.Errorf("row stored, want none")
				}
				return
			}
			if !ok {
				t.Fatal("row missing")
			}
			want := decodeBody(t, f, c.StoredAfter.Row, 7, c.StoredAfter.UpdatedAt)
			if !rows.Equal(got, want) {
				g, _ := json.Marshal(got)
				t.Errorf("stored row %s, want %s", g, c.StoredAfter.Row)
			}
			m := got.M()
			if m.Version != c.StoredAfter.Version {
				t.Errorf("version %d, want %d", m.Version, c.StoredAfter.Version)
			}
			if m.UpdatedAt.Format(time.RFC3339) != c.StoredAfter.UpdatedAt || m.ModifiedAt.Format(time.RFC3339) != c.StoredAfter.ModifiedAt {
				t.Errorf("updated %s modified %s, want %s %s", m.UpdatedAt, m.ModifiedAt, c.StoredAfter.UpdatedAt, c.StoredAfter.ModifiedAt)
			}
			if (m.DeletedAt == nil) != (c.StoredAfter.DeletedAt == nil) || (m.DeletedAt != nil && m.DeletedAt.Format(time.RFC3339) != *c.StoredAfter.DeletedAt) {
				t.Errorf("deleted %v, want %v", m.DeletedAt, c.StoredAfter.DeletedAt)
			}
		})
	}
}

func card(t *testing.T, ws int64, id string, entry int) rows.Row {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"id": id, "kind": "vocab", "entryId": entry, "written": nil, "entryKind": nil, "sentenceId": nil,
		"skipKinds": []string{}, "deckIds": []string{"general"}, "createdAt": "t", "extra": map[string]any{}})
	return decodeBody(t, rows.Cards, body, ws, "2026-01-01T00:00:00Z")
}

func apply(t *testing.T, q study.Querier, user int64, r rows.Row, at string, deleted bool) bool {
	t.Helper()
	defer clockAt(t, at)()
	ok, err := study.Apply(context.Background(), q, user, r, ts(t, at), deleted)
	if err != nil {
		t.Fatal(err)
	}
	return ok
}

func TestApplyBumpsVersionAndRefusesInvalid(t *testing.T) {
	sqlDB := openDB(t)
	for i, at := range []string{"2026-11-01T00:00:00Z", "2026-11-01T00:00:05Z"} {
		r := card(t, 7, "c1", 1+i)
		if !apply(t, sqlDB, 1, r, at, false) {
			t.Fatal("not applied")
		}
		got, _, _ := study.Load(context.Background(), sqlDB, 1, 7, rows.Cards, "c1")
		if got.M().Version != i+1 {
			t.Errorf("version %d after %d writes", got.M().Version, i+1)
		}
	}
	bad := card(t, 7, "c2", 1).(*rows.Card)
	bad.Kind = "flash"
	if _, err := study.Apply(context.Background(), sqlDB, 1, bad, time.Now(), false); err == nil {
		t.Error("invalid row applied")
	}
}

func TestPullCursorTombstonesOrderAndIsolation(t *testing.T) {
	sqlDB := openDB(t)
	ctx := context.Background()
	apply(t, sqlDB, 1, card(t, 7, "c-b", 2), "2026-11-01T10:00:00Z", false)
	apply(t, sqlDB, 1, card(t, 7, "c-a", 1), "2026-11-01T10:00:00Z", false)
	apply(t, sqlDB, 1, card(t, 8, "c-a", 1), "2026-11-01T09:00:00Z", false)
	apply(t, sqlDB, 1, card(t, 7, "c-gone", 3), "2026-11-01T08:00:00Z", false)
	apply(t, sqlDB, 1, card(t, 7, "c-gone", 3), "2026-11-01T11:00:00Z", true)
	apply(t, sqlDB, 2, card(t, 9, "c-a", 1), "2026-11-01T10:00:00Z", false)
	deck := decodeBody(t, rows.Decks, json.RawMessage(`{"id":"d1","name":"n","createdAt":"t","source":null,"extra":{}}`), 7, "2026-11-01T00:00:00Z")
	apply(t, sqlDB, 1, deck, "2026-11-01T12:00:00Z", false)

	ids := func(d study.Delta) []string {
		var out []string
		for _, c := range d.Cards {
			out = append(out, c.ID+"@"+c.UpdatedAt.Format("15:04")+del(c.DeletedAt))
		}
		return out
	}
	d, err := study.Pull(ctx, sqlDB, 1, time.Time{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(d); !equal(got, []string{"c-a@09:00", "c-a@10:00", "c-b@10:00"}) {
		t.Errorf("zero cursor cards = %v (live only, by updated_at then workspace then id)", got)
	}
	if len(d.Decks) != 1 || d.DeckSettings == nil || d.Limits == nil || d.FsrsSets == nil || d.FsrsActive == nil {
		t.Errorf("delta %+v: decks or nil collections", d)
	}
	d, _ = study.Pull(ctx, sqlDB, 1, ts(t, "1970-01-01T00:00:00Z"), nil)
	if got := ids(d); !equal(got, []string{"c-a@09:00", "c-a@10:00", "c-b@10:00", "c-gone@11:00x"}) {
		t.Errorf("1970 cursor cards = %v (tombstones ship)", got)
	}
	d, _ = study.Pull(ctx, sqlDB, 1, ts(t, "2026-11-01T10:00:00Z"), nil)
	if got := ids(d); !equal(got, []string{"c-a@10:00", "c-b@10:00", "c-gone@11:00x"}) {
		t.Errorf("cursor 10:00 cards = %v (inclusive second)", got)
	}
	d, _ = study.Pull(ctx, sqlDB, 1, time.Time{}, map[rows.Family]bool{rows.Decks: true})
	if len(d.Cards) != 0 || d.Cards == nil || len(d.Decks) != 1 {
		t.Errorf("decks-only pull: cards %v decks %v", d.Cards, d.Decks)
	}
	d, _ = study.Pull(ctx, sqlDB, 2, ts(t, "1970-01-01T00:00:00Z"), nil)
	if got := ids(d); !equal(got, []string{"c-a@10:00"}) || len(d.Decks) != 0 {
		t.Errorf("user 2 pull = %v decks %d", got, len(d.Decks))
	}
	if d.Cards[0].WorkspaceID != 9 {
		t.Errorf("user 2 card workspace %d", d.Cards[0].WorkspaceID)
	}

	// Get and ListCards skip tombstones and other users.
	if _, ok, _ := study.Get(ctx, sqlDB, 1, 7, rows.Cards, "c-gone"); ok {
		t.Error("Get returned a tombstone")
	}
	if _, ok, _ := study.Get(ctx, sqlDB, 2, 7, rows.Cards, "c-a"); ok {
		t.Error("user 2 read user 1's card")
	}
	if r, ok, _ := study.Get(ctx, sqlDB, 1, 7, rows.Cards, "c-a"); !ok || r.(*rows.Card).EntryID != 1 {
		t.Errorf("Get c-a = %v %v", r, ok)
	}
	list, err := study.ListCards(ctx, sqlDB, 1, 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != "c-a" || list[1].ID != "c-b" {
		t.Errorf("ListCards = %+v", list)
	}
	if list, _ := study.ListCards(ctx, sqlDB, 2, 7); len(list) != 0 {
		t.Errorf("user 2 lists user 1's workspace: %v", list)
	}
}

func del(t *time.Time) string {
	if t != nil {
		return "x"
	}
	return ""
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
