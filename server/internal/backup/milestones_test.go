package backup

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// The seen milestones (docs/contracts/milestones/README.md) are ordinary
// qinqin-flashcards rows `milestone:<id>`: a live row is exported and restored
// into the remapped workspace with its key and data unchanged; a tombstone is
// not exported. Pinning test: the generic plugin-row path, no milestone code.
func TestSeenMilestonesSurviveExportAndRestore(t *testing.T) {
	src := newWorld(t)
	tg := newTarget(t, nil)
	put := func(ws int64, key, data string, deleted any) {
		exec(t, src.DB, `INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
			VALUES ('qinqin-flashcards', ?, ?, ?, ?, 1, '2026-11-17T08:00:00Z', '2026-11-17T08:00:00Z', ?)`,
			src.AliceUID, ws, key, data, deleted)
	}
	reviews := `{"version":1,"id":"reviews:1000","seenAt":"2026-11-17T08:00:00.000Z","reachedDay":"2026-11-03"}`
	level := `{"version":1,"id":"level-complete:d-lvl-hsk-words-b06fd2ac","seenAt":"2026-11-17T08:00:00.000Z","reachedDay":"2026-11-05","x":[1]}`
	put(src.Alice.WS1, "milestone:reviews:1000", reviews, nil)
	put(src.Alice.WS1, "milestone:streak:7", `{"version":1,"id":"streak:7"}`, "2026-11-17T09:00:00Z")
	put(src.Alice.WS2, "milestone:level-complete:d-lvl-hsk-words-b06fd2ac", level, nil)

	data, _ := exportBytes(t, src, src.AliceUID)
	files, _ := unzipAll(t, data)
	var exported []string
	for name, body := range files {
		if !strings.HasPrefix(name, "plugin-data/") {
			continue
		}
		for _, line := range bytes.Split(body, []byte("\n")) {
			if bytes.Contains(line, []byte(`"milestone:`)) {
				exported = append(exported, string(line))
			}
		}
	}
	if len(exported) != 2 || strings.Contains(strings.Join(exported, "\n"), "streak:7") {
		t.Fatalf("exported milestone lines %v, want the two live rows and no tombstone", exported)
	}

	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, openExport(t, src, src.AliceUID), Options{DropUnresolved: true}); err != nil {
		t.Fatal(err)
	}
	rs, err := tg.DB.Query(`SELECT p.key, p.data, w.language, p.deleted_at IS NULL FROM plugin_data p JOIN workspaces w ON w.id = p.workspace_id
		WHERE p.user_id = ? AND w.user_id = ? AND p.pack_id = 'qinqin-flashcards' AND p.key LIKE 'milestone:%' ORDER BY p.key`, tg.UID, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	type got struct {
		lang string
		data any
	}
	rows := map[string]got{}
	for rs.Next() {
		var key, body, lang string
		var live bool
		if err := rs.Scan(&key, &body, &lang, &live); err != nil {
			t.Fatal(err)
		}
		if !live {
			t.Errorf("%s restored as a tombstone", key)
		}
		var v any
		if err := json.Unmarshal([]byte(body), &v); err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		rows[key] = got{lang, v}
	}
	want := map[string]got{}
	for key, w := range map[string][2]string{
		"milestone:reviews:1000":                            {"zh", reviews},
		"milestone:level-complete:d-lvl-hsk-words-b06fd2ac": {"ja", level},
	} {
		var v any
		_ = json.Unmarshal([]byte(w[1]), &v)
		want[key] = got{w[0], v}
	}
	if !reflect.DeepEqual(rows, want) {
		t.Errorf("restored milestone rows %v\nwant %v", rows, want)
	}
}
