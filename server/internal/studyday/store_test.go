package studyday

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"qinqin/internal/db"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "q.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

var t0 = time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)

func TestSetFirstWritesSeqZeroWithNullFrom(t *testing.T) {
	sqlDB := openDB(t)
	ch, err := Set(context.Background(), sqlDB, 1, "Europe/Berlin", false, t0.Add(123*time.Millisecond))
	if err != nil {
		t.Fatal(err)
	}
	if len(ch) != 1 || ch[0].Zone != "Europe/Berlin" || ch[0].From != nil {
		t.Fatalf("changes = %+v", ch)
	}
	var seq int
	var from sql.NullString
	if err := sqlDB.QueryRow(`SELECT seq, effective_from FROM user_time_zones WHERE user_id = 1`).Scan(&seq, &from); err != nil {
		t.Fatal(err)
	}
	if seq != 0 || from.Valid {
		t.Errorf("seq %d from %v", seq, from)
	}
}

func TestSetUTCFirstIsAZone(t *testing.T) {
	ch, err := Set(context.Background(), openDB(t), 1, "UTC", false, t0)
	if err != nil || len(ch) != 1 || ch[0].Zone != "UTC" {
		t.Fatalf("%+v %v", ch, err)
	}
}

func TestSetSameZoneAndIfUnsetAddNoRow(t *testing.T) {
	sqlDB := openDB(t)
	ctx := context.Background()
	Set(ctx, sqlDB, 1, "Asia/Tokyo", false, t0)
	for _, c := range []struct {
		zone    string
		ifUnset bool
	}{{"Asia/Tokyo", false}, {"Asia/Tokyo", true}, {"America/New_York", true}} {
		ch, err := Set(ctx, sqlDB, 1, c.zone, c.ifUnset, t0.Add(time.Hour))
		if err != nil || len(ch) != 1 || ch[0].Zone != "Asia/Tokyo" {
			t.Errorf("%+v: %+v %v", c, ch, err)
		}
	}
}

func TestSetSecondZoneFromNowTruncated(t *testing.T) {
	sqlDB := openDB(t)
	ctx := context.Background()
	Set(ctx, sqlDB, 1, "Asia/Tokyo", false, t0)
	ch, err := Set(ctx, sqlDB, 1, "America/New_York", false, t0.Add(time.Hour+999*time.Millisecond))
	if err != nil || len(ch) != 2 {
		t.Fatal(ch, err)
	}
	if want := t0.Add(time.Hour); ch[1].From == nil || !ch[1].From.Equal(want) {
		t.Errorf("from = %v, want %v", ch[1].From, want)
	}
	var raw string
	sqlDB.QueryRow(`SELECT effective_from FROM user_time_zones WHERE user_id = 1 AND seq = 1`).Scan(&raw)
	if raw != "2026-11-15T11:00:00Z" {
		t.Errorf("stored %q", raw)
	}
}

func TestSetSameSecondGetsPlusOneSecond(t *testing.T) {
	sqlDB := openDB(t)
	ctx := context.Background()
	Set(ctx, sqlDB, 1, "Asia/Tokyo", false, t0)
	Set(ctx, sqlDB, 1, "America/New_York", false, t0.Add(time.Hour))
	ch, _ := Set(ctx, sqlDB, 1, "Europe/Berlin", false, t0.Add(time.Hour+200*time.Millisecond))
	if !ch[2].From.Equal(t0.Add(time.Hour + time.Second)) {
		t.Errorf("third from = %v", ch[2].From)
	}
	// a clock that went backwards still increases
	ch, _ = Set(ctx, sqlDB, 1, "Asia/Tokyo", false, t0)
	if !ch[3].From.Equal(t0.Add(time.Hour + 2*time.Second)) {
		t.Errorf("fourth from = %v", ch[3].From)
	}
	if _, err := New(ch); err != nil {
		t.Errorf("history invalid: %v", err)
	}
}

func TestSetFromAfterFirstEvenAtSeqZero(t *testing.T) {
	// seq 0 has no from; the second row just takes now.
	sqlDB := openDB(t)
	Set(context.Background(), sqlDB, 1, "Asia/Tokyo", false, t0)
	ch, _ := Set(context.Background(), sqlDB, 1, "UTC", false, t0)
	if !ch[1].From.Equal(t0) {
		t.Errorf("from = %v", ch[1].From)
	}
}

func TestSetTooManyChanges(t *testing.T) {
	sqlDB := openDB(t)
	ctx := context.Background()
	zones := []string{"Asia/Tokyo", "Europe/Berlin"}
	for i := 0; i < MaxChanges; i++ {
		if _, err := Set(ctx, sqlDB, 1, zones[i%2], false, t0.Add(time.Duration(i)*time.Minute)); err != nil {
			t.Fatalf("change %d: %v", i, err)
		}
	}
	if _, err := Set(ctx, sqlDB, 1, "Europe/Paris", false, t0.Add(24*time.Hour)); !errors.Is(err, ErrTooManyChanges) {
		t.Errorf("501st: %v", err)
	}
	// the same zone as the current one is not a change
	if _, err := Set(ctx, sqlDB, 1, zones[(MaxChanges-1)%2], false, t0.Add(24*time.Hour)); err != nil {
		t.Errorf("same zone at the cap: %v", err)
	}
	// another user is unaffected
	if _, err := Set(ctx, sqlDB, 2, "Europe/Paris", false, t0); err != nil {
		t.Errorf("user 2: %v", err)
	}
}

func TestSetInvalidNames(t *testing.T) {
	sqlDB := openDB(t)
	long := ""
	for i := 0; i < 65; i++ {
		long += "A"
	}
	for _, name := range []string{"", "Mars/Base", "Local", "Factory", "posixrules", "posix/Europe/Berlin", "right/Europe/Berlin", long, "Europe/Berlin\n", "../etc/passwd", "Europe/Berlin ", "europe/berlin", "Europe/"} {
		if _, err := Set(context.Background(), sqlDB, 1, name, false, t0); !errors.Is(err, ErrUnknownZone) {
			t.Errorf("%q: %v", name, err)
		}
		if ValidZone(name) {
			t.Errorf("ValidZone(%q)", name)
		}
	}
	for _, name := range []string{"UTC", "Europe/Berlin", "Etc/GMT-9", "America/Argentina/Buenos_Aires", "Asia/Kolkata", "Pacific/Kiritimati"} {
		if !ValidZone(name) {
			t.Errorf("ValidZone(%q) = false", name)
		}
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM user_time_zones`).Scan(&n)
	if n != 0 {
		t.Errorf("%d rows after rejected names", n)
	}
}

func TestUsersAreIsolated(t *testing.T) {
	sqlDB := openDB(t)
	ctx := context.Background()
	Set(ctx, sqlDB, 1, "Asia/Tokyo", false, t0)
	Set(ctx, sqlDB, 2, "Europe/Berlin", false, t0)
	Set(ctx, sqlDB, 2, "UTC", false, t0.Add(time.Hour))
	h1, c1, err := Load(ctx, sqlDB, 1)
	if err != nil || len(c1) != 1 || h1.Zone() != "Asia/Tokyo" {
		t.Errorf("user 1: %+v %v", c1, err)
	}
	h2, c2, _ := Load(ctx, sqlDB, 2)
	if len(c2) != 2 || h2.Zone() != "UTC" {
		t.Errorf("user 2: %+v", c2)
	}
	h3, c3, err := Load(ctx, sqlDB, 3)
	if err != nil || c3 != nil || h3.Zone() != "UTC" {
		t.Errorf("user 3: %+v %v", c3, err)
	}
	if got := h3.DayOf(time.Date(2026, 1, 1, 23, 30, 0, 0, time.UTC)).String(); got != "2026-01-01" {
		t.Errorf("no rows is UTC, got %s", got)
	}
}

func TestLoadOrdersBySeq(t *testing.T) {
	sqlDB := openDB(t)
	ctx := context.Background()
	for i, z := range []string{"Asia/Tokyo", "Europe/Berlin", "America/New_York", "UTC"} {
		Set(ctx, sqlDB, 1, z, false, t0.Add(time.Duration(i)*time.Hour))
	}
	h, ch, err := Load(ctx, sqlDB, 1)
	if err != nil || len(ch) != 4 || ch[0].Zone != "Asia/Tokyo" || ch[3].Zone != "UTC" || h.Zone() != "UTC" {
		t.Fatalf("%+v %v", ch, err)
	}
	for i := 2; i < len(ch); i++ {
		if !ch[i].From.After(*ch[i-1].From) {
			t.Errorf("from not increasing at %d", i)
		}
	}
}

func TestLoadRejectsCorruptRows(t *testing.T) {
	sqlDB := openDB(t)
	sqlDB.Exec(`INSERT INTO user_time_zones (user_id, seq, zone, effective_from, created_at) VALUES (1, 0, 'Mars/Base', NULL, 'x')`)
	if _, _, err := Load(context.Background(), sqlDB, 1); err == nil {
		t.Error("corrupt zone accepted")
	}
}

func TestConcurrentSetsKeepConsecutiveSeqs(t *testing.T) {
	sqlDB := openDB(t)
	ctx := context.Background()
	Set(ctx, sqlDB, 1, "UTC", false, t0)
	zones := []string{"Asia/Tokyo", "Europe/Berlin", "America/New_York", "Australia/Sydney", "Asia/Kolkata", "Europe/London"}
	var wg sync.WaitGroup
	errs := make(chan error, len(zones))
	for _, z := range zones {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := Set(ctx, sqlDB, 1, z, false, t0.Add(time.Hour))
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("concurrent set: %v", err)
		}
	}
	rows, _ := sqlDB.Query(`SELECT seq FROM user_time_zones WHERE user_id = 1 ORDER BY seq`)
	defer rows.Close()
	want := 0
	for rows.Next() {
		var s int
		rows.Scan(&s)
		if s != want {
			t.Errorf("seq %d, want %d", s, want)
		}
		want++
	}
	if want < 2 || want > len(zones)+1 {
		t.Errorf("%d rows", want)
	}
	_, ch, err := Load(ctx, sqlDB, 1)
	if err != nil || len(ch) != want {
		t.Errorf("load: %d changes, err %v", len(ch), err)
	}
}
