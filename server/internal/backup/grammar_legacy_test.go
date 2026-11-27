package backup

import (
	"context"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
)

// #277: grammar lesson runs are events, so an export carries them with the
// other events and writes no grammar rows; a backup from before #277 carries
// the progress as keyed rows grammar:progress:<packId>:<lessonId>, which a
// restore turns into one grammar event each (grammar/runs.json, legacy) and
// counts as restored rows, as the dry run predicts. A row the conversion
// refuses is dropped and counted.
func TestRestoreTurnsOldGrammarProgressIntoEvents(t *testing.T) {
	src := newWorld(t)
	uid, ws := src.AliceUID, src.Alice.WS1
	// The old export wrote these rows; a keyed row of any key exports verbatim.
	exec(t, src.DB, `INSERT INTO keyed_rows (user_id, workspace_id, key, data, version, updated_at, modified_at) VALUES
		(?, ?, 'grammar:progress:zh-grammar:le-change', '{"completedAt":"2026-11-19T09:00:00.700+01:00","best":3,"total":4}', 1, '2026-11-20T10:00:00Z', '2026-11-20T10:00:00Z'),
		(?, ?, 'grammar:progress:zh-grammar:shi', '{"completedAt":"yesterday","best":1,"total":2}', 1, '2026-11-20T10:00:00Z', '2026-11-20T10:00:00Z'),
		(?, ?, 'grammar:progress:zh-grammar:Bad Id', '{"completedAt":"2026-11-19T08:00:00Z","best":1,"total":2}', 1, '2026-11-20T10:00:00Z', '2026-11-20T10:00:00Z')`,
		uid, ws, uid, ws, uid, ws)
	// A run recorded since #277 is an ordinary event.
	exec(t, src.DB, `INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES
		('01KA00000000000000000000G1', ?, ?, 'web', '2026-11-21T08:00:00Z', 'grammar', '{"point":"zh-grammar:ba","mode":"lesson","score":2,"total":2}', '2026-11-21T08:00:00Z')`, uid, ws)

	tg := newTarget(t, nil)
	base, _, err := Plan(context.Background(), newTarget(t, nil).DB, openExport(t, newWorld(t), uid), tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	a := openExport(t, src, uid)
	rep, _, err := Plan(context.Background(), tg.DB, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	res, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	// The plan's row count includes the two convertible rows; the bad one is dropped.
	if rep.Restores.Rows != base.Restores.Rows+2 || rep.Unresolved.DroppedRows != base.Unresolved.DroppedRows+1 {
		t.Errorf("plan: rows %d (base %d), dropped %d (base %d)", rep.Restores.Rows, base.Restores.Rows, rep.Unresolved.DroppedRows, base.Unresolved.DroppedRows)
	}
	if res.Restored.Rows != rep.Restores.Rows {
		t.Errorf("restored rows %d, the plan said %d", res.Restored.Rows, rep.Restores.Rows)
	}
	rows, err := tg.DB.Query(`SELECT id, ts, payload, device FROM study_events WHERE user_id = ? AND type = 'grammar' ORDER BY ts`, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	type ev struct{ id, ts, payload, device string }
	var got []ev
	for rows.Next() {
		var e ev
		rows.Scan(&e.id, &e.ts, &e.payload, &e.device)
		got = append(got, e)
	}
	want := []struct{ ts, payload, device string }{
		{"2026-11-19T08:00:00Z", `{"point":"zh-grammar:le-change","mode":"lesson","score":3,"total":4}`, "restore"},
		{"2026-11-20T10:00:00Z", `{"point":"zh-grammar:shi","mode":"lesson","score":1,"total":2}`, "restore"},
		{"2026-11-21T08:00:00Z", `{"point":"zh-grammar:ba","mode":"lesson","score":2,"total":2}`, "web"},
	}
	if len(got) != len(want) {
		t.Fatalf("grammar events %+v, want %d", got, len(want))
	}
	for i, w := range want {
		if got[i].ts != w.ts || got[i].payload != w.payload || got[i].device != w.device {
			t.Errorf("event %d = %+v, want %+v", i, got[i], w)
		}
		id, err := ulid.ParseStrict(got[i].id)
		at, _ := time.Parse(time.RFC3339, w.ts)
		if err != nil || (w.device == "restore" && !ulid.Time(id.Time()).Equal(at)) {
			t.Errorf("event %d id %s: %v", i, got[i].id, err)
		}
	}
	var keyed int
	tg.DB.QueryRow(`SELECT COUNT(*) FROM keyed_rows WHERE user_id = ? AND key LIKE 'grammar:%'`, tg.UID).Scan(&keyed)
	if keyed != 0 {
		t.Errorf("%d grammar keyed rows restored verbatim", keyed)
	}
}
