package backup

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

// The phone navigation (docs/contracts/settings/nav-layout.json) is the
// user-global qinqin-core row "nav-layout": a personal backup carries the
// live row and a restore brings it back unchanged and still user-global.
// Pinning test: the generic plugin-row path, no nav-layout code.
func TestNavLayoutRowSurvivesExportAndRestore(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/settings/nav-layout.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Row json.RawMessage `json:"row"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	src := newWorld(t)
	tg := newTarget(t, nil)
	exec(t, src.DB, `INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
		VALUES ('qinqin-core', ?, NULL, 'nav-layout', ?, 1, '2026-11-17T08:00:00Z', '2026-11-17T08:00:00Z', NULL)`,
		src.AliceUID, string(fixture.Row))

	data, _ := exportBytes(t, src, src.AliceUID)
	files, _ := unzipAll(t, data)
	var lines []string
	for name, body := range files {
		for _, line := range bytes.Split(body, []byte("\n")) {
			if bytes.Contains(line, []byte(`"nav-layout"`)) {
				if !strings.HasPrefix(name, "plugin-data/") {
					t.Errorf("nav-layout in %s", name)
				}
				lines = append(lines, string(line))
			}
		}
	}
	if len(lines) != 1 || !strings.Contains(lines[0], `"workspaceId":null`) {
		t.Fatalf("exported nav-layout lines %v, want one user-global row", lines)
	}

	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, openExport(t, src, src.AliceUID), Options{DropUnresolved: true}); err != nil {
		t.Fatal(err)
	}
	var body string
	var ws any
	if err := tg.DB.QueryRow(`SELECT data, workspace_id FROM plugin_data WHERE user_id = ? AND pack_id = 'qinqin-core' AND key = 'nav-layout' AND deleted_at IS NULL`,
		tg.UID).Scan(&body, &ws); err != nil {
		t.Fatal(err)
	}
	var got, want any
	json.Unmarshal([]byte(body), &got)
	json.Unmarshal(fixture.Row, &want)
	if ws != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("restored nav-layout %s (workspace %v), want %s user-global", body, ws, fixture.Row)
	}
}
