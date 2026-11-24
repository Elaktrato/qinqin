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

// The widget options (docs/contracts/settings/widget-options.json) are the
// user-global qinqin-core row "widget-options": a personal backup carries the
// live row and a restore brings it back unchanged and still user-global.
// Pinning test: the generic plugin-row path, no widget-options code.
func TestWidgetOptionsRowSurvivesExportAndRestore(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/settings/widget-options.json")
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
	exec(t, src.DB, `INSERT INTO keyed_rows (user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
		VALUES (?, NULL, 'widget-options', ?, 1, '2026-11-17T08:00:00Z', '2026-11-17T08:00:00Z', NULL)`,
		src.AliceUID, string(fixture.Row))

	data, _ := exportBytes(t, src, src.AliceUID)
	files, _ := unzipAll(t, data)
	var lines []string
	for name, body := range files {
		for _, line := range bytes.Split(body, []byte("\n")) {
			if bytes.Contains(line, []byte(`"widget-options"`)) {
				if !strings.HasPrefix(name, "rows/") {
					t.Errorf("widget-options in %s", name)
				}
				lines = append(lines, string(line))
			}
		}
	}
	if len(lines) != 1 || !strings.Contains(lines[0], `"workspaceId":null`) {
		t.Fatalf("exported widget-options lines %v, want one user-global row", lines)
	}

	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, openExport(t, src, src.AliceUID), Options{DropUnresolved: true}); err != nil {
		t.Fatal(err)
	}
	var body string
	var ws any
	if err := tg.DB.QueryRow(`SELECT data, workspace_id FROM keyed_rows WHERE user_id = ? AND key = 'widget-options' AND deleted_at IS NULL`,
		tg.UID).Scan(&body, &ws); err != nil {
		t.Fatal(err)
	}
	var got, want any
	json.Unmarshal([]byte(body), &got)
	json.Unmarshal(fixture.Row, &want)
	if ws != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("restored widget-options %s (workspace %v), want %s user-global", body, ws, fixture.Row)
	}
}
