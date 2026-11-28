package backup

import (
	"fmt"
	"testing"
)

// A mistake-notebook mark of a card item (#227, docs/contracts/notebook/) names the card's entry in
// refs/entries.json, as a review of a deleted card does, so a restore can follow the entry.
func TestExportNotebookCardMarkNamesItsEntry(t *testing.T) {
	w := newWorld(t)
	horse := mkEntry(t, w.DB, "zh", "word", "cc-ma", "马")
	other := mkEntry(t, w.DB, "zh", "word", "cc-qu", "去")
	exec(t, w.DB, `INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES
		('01JD00000000000000NOTEBK01', ?, ?, 'web', '2026-11-20T10:00:00Z', 'notebook', ?, '2026-11-20T10:00:00Z'),
		('01JD00000000000000NOTEBK02', ?, ?, 'web', '2026-11-20T10:01:00Z', 'notebook', ?, '2026-11-20T10:01:00Z')`,
		w.AliceUID, w.Alice.WS1, fmt.Sprintf(`{"action":"remove","item":"card:c-vocab-%d"}`, horse),
		w.AliceUID, w.Alice.WS1, fmt.Sprintf(`{"action":"remove","item":"drill.measure-words:%d"}`, other))
	data, _ := exportBytes(t, w, w.AliceUID)
	files, _ := unzipAll(t, data)
	refs := refEntryIDs(t, files)
	if !refs[horse] {
		t.Errorf("the card mark's entry %d is not in refs/entries.json: %v", horse, refs)
	}
	if refs[other] {
		t.Errorf("a drill item added a ref (drill items are not remapped): %v", refs)
	}
}
