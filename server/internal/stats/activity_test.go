package stats_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/db"
	"qinqin/internal/events"
	"qinqin/internal/model"
	"qinqin/internal/plugins"
	"qinqin/internal/stats"
	"qinqin/internal/studyday"
)

func newDB(t testing.TB) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

func newUser(t testing.TB, sqlDB *sql.DB, name string) int64 {
	t.Helper()
	u, err := auth.CreateUser(context.Background(), sqlDB, name, "pw-"+name, false)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}

func builtinRules(t testing.TB, sqlDB *sql.DB) []plugins.RuleOf {
	t.Helper()
	for _, raw := range plugins.Builtin() {
		if _, err := plugins.RegisterBuiltin(context.Background(), sqlDB, raw); err != nil {
			t.Fatal(err)
		}
	}
	rules, err := plugins.ActivityRules(context.Background(), sqlDB)
	if err != nil {
		t.Fatal(err)
	}
	return rules
}

var seq int

// add appends one event; payload "" means an absent payload.
func add(t testing.TB, sqlDB *sql.DB, user, ws int64, ts, typ, payload string) {
	t.Helper()
	seq++
	addID(t, sqlDB, user, ws, fmt.Sprintf("ev-%08d", seq), ts, typ, payload)
}

// addID stores one event with a given id (a replacement names its target by id).
func addID(t testing.TB, sqlDB *sql.DB, user, ws int64, id, ts, typ, payload string) {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		t.Fatal(err)
	}
	ev := model.StudyEvent{ID: id, UserID: user, WorkspaceID: ws, Device: "d", TS: parsed, Type: typ}
	if payload != "" {
		ev.Payload = json.RawMessage(payload)
	}
	if _, _, err := events.Append(context.Background(), sqlDB, []model.StudyEvent{ev}); err != nil {
		t.Fatal(err)
	}
}

func day(s string) time.Time {
	d, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return d
}

func date(s string) studyday.Date {
	d, err := studyday.ParseDate(s)
	if err != nil {
		panic(err)
	}
	return d
}

// run buckets by UTC days (a user with no zone).
func run(t *testing.T, sqlDB *sql.DB, user int64, from, to string, ws *int64, rules []plugins.RuleOf) []stats.Cell {
	t.Helper()
	return runIn(t, sqlDB, user, studyday.UTCHistory(), from, to, ws, rules)
}

func runIn(t *testing.T, sqlDB *sql.DB, user int64, h studyday.History, from, to string, ws *int64, rules []plugins.RuleOf) []stats.Cell {
	t.Helper()
	cells, err := stats.Activity(context.Background(), sqlDB, user, h.Windows(date(from), date(to)), ws, rules)
	if err != nil {
		t.Fatalf("Activity: %v", err)
	}
	if cells == nil {
		t.Fatal("cells is nil")
	}
	return cells
}

func TestActivityCount(t *testing.T) {
	sqlDB := newDB(t)
	rules := builtinRules(t, sqlDB)
	u, other := newUser(t, sqlDB, "a"), newUser(t, sqlDB, "b")
	for i := 0; i < 3; i++ {
		add(t, sqlDB, u, 1, "2026-11-13T08:00:00Z", "review", "")
	}
	add(t, sqlDB, u, 2, "2026-11-13T09:00:00Z", "review", `{"x":1}`)
	add(t, sqlDB, other, 1, "2026-11-13T09:00:00Z", "review", "")
	got := run(t, sqlDB, u, "2026-11-01", "2026-11-15", nil, rules)
	want := []stats.Cell{
		{Day: "2026-11-13", Workspace: 1, Type: "review", Points: 3, Raw: 3},
		{Day: "2026-11-13", Workspace: 2, Type: "review", Points: 1, Raw: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
	if got := run(t, sqlDB, u, "2026-11-14", "2026-11-15", nil, rules); len(got) != 0 {
		t.Errorf("empty window = %+v", got)
	}
}

func TestActivityMeasure(t *testing.T) {
	sqlDB := newDB(t)
	rules := builtinRules(t, sqlDB)
	u := newUser(t, sqlDB, "a")
	for _, c := range []struct {
		secs       string
		points     int64
		raw        float64
		day, other string
	}{
		{"29", 0, 0, "2026-11-01", ""}, {"30", 1, 30, "2026-11-02", ""}, {"300", 1, 300, "2026-11-03", ""},
		{"301", 2, 301, "2026-11-04", ""}, {"7200", 24, 7200, "2026-11-05", ""}, {"9000", 24, 7200, "2026-11-06", ""},
	} {
		add(t, sqlDB, u, 1, c.day+"T10:00:00Z", "read", `{"seconds":`+c.secs+`}`)
		got := run(t, sqlDB, u, c.day, c.day, nil, rules)
		if c.points == 0 {
			if len(got) != 0 {
				t.Errorf("seconds %s: %+v, want none", c.secs, got)
			}
			continue
		}
		want := []stats.Cell{{Day: c.day, Workspace: 1, Type: "read", Points: c.points, Raw: c.raw}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("seconds %s: %+v, want %+v", c.secs, got, want)
		}
	}
	for _, s := range []string{"29", "30", "300", "301", "7200", "9000"} {
		add(t, sqlDB, u, 1, "2026-11-10T10:00:00Z", "read", `{"seconds":`+s+`}`)
	}
	got := run(t, sqlDB, u, "2026-11-10", "2026-11-10", nil, rules)
	want := []stats.Cell{{Day: "2026-11-10", Workspace: 1, Type: "read", Points: 52, Raw: 15031}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("one day: %+v, want %+v", got, want)
	}
}

func TestActivityDistinct(t *testing.T) {
	sqlDB := newDB(t)
	rules := builtinRules(t, sqlDB)
	u := newUser(t, sqlDB, "a")
	add(t, sqlDB, u, 1, "2026-11-13T08:00:00Z", "journal", `{"entryId":"A"}`)
	add(t, sqlDB, u, 1, "2026-11-13T09:00:00Z", "journal", `{"entryId":"A"}`)
	add(t, sqlDB, u, 1, "2026-11-14T09:00:00Z", "journal", `{"entryId":"A"}`)
	add(t, sqlDB, u, 1, "2026-11-13T10:00:00Z", "journal", `{"entryId":"B"}`)
	add(t, sqlDB, u, 1, "2026-11-13T11:00:00Z", "journal", `{"entryId":null}`)
	add(t, sqlDB, u, 1, "2026-11-13T12:00:00Z", "journal", `{}`)
	got := run(t, sqlDB, u, "2026-11-13", "2026-11-14", nil, rules)
	want := []stats.Cell{
		{Day: "2026-11-13", Workspace: 1, Type: "journal", Points: 2, Raw: 2},
		{Day: "2026-11-14", Workspace: 1, Type: "journal", Points: 1, Raw: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestActivityBadPayloads(t *testing.T) {
	sqlDB := newDB(t)
	rules := builtinRules(t, sqlDB)
	u := newUser(t, sqlDB, "a")
	for _, typ := range []string{"read", "journal"} {
		for _, p := range []string{`null`, `"x"`, `{"seconds":"300"}`, `{"entryId":5}`, `[1]`, `7`} {
			add(t, sqlDB, u, 1, "2026-11-13T08:00:00Z", typ, p)
		}
		if _, err := sqlDB.Exec(`INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at)
			VALUES ('raw-`+typ+`', ?, 1, 'd', '2026-11-13T08:00:00Z', ?, 'not json', 't')`, u, typ); err != nil {
			t.Fatal(err)
		}
	}
	if got := run(t, sqlDB, u, "2026-11-13", "2026-11-13", nil, rules); len(got) != 0 {
		t.Errorf("bad payloads scored: %+v", got)
	}
}

func TestActivityWindowAndFilter(t *testing.T) {
	sqlDB := newDB(t)
	rules := builtinRules(t, sqlDB)
	u := newUser(t, sqlDB, "a")
	add(t, sqlDB, u, 1, "2026-11-10T00:00:00Z", "review", "")
	add(t, sqlDB, u, 1, "2026-11-12T23:59:59Z", "review", "")
	add(t, sqlDB, u, 1, "2026-11-13T00:00:00Z", "review", "")
	add(t, sqlDB, u, 1, "2026-11-09T23:59:59Z", "review", "")
	add(t, sqlDB, u, 2, "2026-11-11T10:00:00Z", "review", "")
	add(t, sqlDB, u, 1, "2026-11-11T10:00:00Z", "mystery", "")
	got := run(t, sqlDB, u, "2026-11-10", "2026-11-12", nil, rules)
	want := []stats.Cell{
		{Day: "2026-11-10", Workspace: 1, Type: "review", Points: 1, Raw: 1},
		{Day: "2026-11-11", Workspace: 2, Type: "review", Points: 1, Raw: 1},
		{Day: "2026-11-12", Workspace: 1, Type: "review", Points: 1, Raw: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("window: %+v, want %+v", got, want)
	}
	ws := int64(2)
	got = run(t, sqlDB, u, "2026-11-10", "2026-11-12", &ws, rules)
	if !reflect.DeepEqual(got, want[1:2]) {
		t.Errorf("workspace 2: %+v", got)
	}
}

// TestActivityReplacedIsolation: a replacement counts only against the
// caller's own reviews (#131). Bob's review that names Alice's review id
// voids nothing of Alice's, and Alice's replacement of her own misclick
// leaves Bob's count alone.
func TestActivityReplacedIsolation(t *testing.T) {
	sqlDB := newDB(t)
	rules := builtinRules(t, sqlDB)
	alice, bob := newUser(t, sqlDB, "a"), newUser(t, sqlDB, "b")
	const ts = "2026-11-13T08:00:00Z"
	addID(t, sqlDB, alice, 1, "01KAPZ000000000000000000A1", ts, "review", `{"cardId":"c1","mode":"vocab","grade":1}`)
	addID(t, sqlDB, alice, 1, "01KAPZ000000000000000000A2", ts, "review", `{"cardId":"c1","mode":"vocab","grade":3,"replaces":"01KAPZ000000000000000000A1"}`)
	addID(t, sqlDB, bob, 1, "01KAPZ000000000000000000B1", ts, "review", `{"cardId":"c1","mode":"vocab","grade":1}`)
	addID(t, sqlDB, bob, 1, "01KAPZ000000000000000000B2", ts, "review", `{"cardId":"c1","mode":"vocab","grade":3,"replaces":"01KAPZ000000000000000000A2"}`)
	count := func(u int64) int64 {
		var n int64
		for _, c := range run(t, sqlDB, u, "2026-11-01", "2026-11-15", nil, rules) {
			if c.Type == "review" {
				n += c.Points
			}
		}
		return n
	}
	if got := count(alice); got != 1 {
		t.Errorf("alice counts %d reviews, want 1 (her misclick replaced)", got)
	}
	if got := count(bob); got != 2 {
		t.Errorf("bob counts %d reviews, want 2 (his reference to alice's id dangles)", got)
	}
}
