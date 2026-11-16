package api_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Every error code the backup contract names exists in the one catalogue,
// and every backup route is declared.
func TestBackupContractCodesAreCatalogued(t *testing.T) {
	cat := map[string]json.RawMessage{}
	raw, err := os.ReadFile(filepath.Join(contractDir, "errors.json"))
	if err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(raw, &cat)
	rejectRaw, err := os.ReadFile("../../../docs/contracts/backup/reject.json")
	if err != nil {
		t.Fatal(err)
	}
	var rej struct {
		Cases []struct{ Code string } `json:"cases"`
	}
	json.Unmarshal(rejectRaw, &rej)
	if len(rej.Cases) == 0 {
		t.Fatal("reject.json has no cases")
	}
	codes := []string{"export_running", "restore_running", "backup_running", "stage_not_ready", "unresolved_entries",
		"backup_too_large", "backup_invalid", "backup_version_unsupported", "insufficient_storage", "unsupported_media_type"}
	for _, c := range rej.Cases {
		codes = append(codes, c.Code)
	}
	for _, c := range codes {
		if _, ok := cat[c]; !ok {
			t.Errorf("error code %q is not in errors.json", c)
		}
	}
	src, _ := os.ReadFile("api.go")
	for _, p := range []string{
		"POST /api/account/export", "GET /api/account/export/{ticket}", "POST /api/account/restore",
		"GET /api/account/restore/{token}", "DELETE /api/account/restore/{token}", "POST /api/account/restore/{token}",
		"POST /api/account/restore/safety-export", "GET /api/account/restore/safety-export/{ticket}",
		"POST /api/admin/backup", "GET /api/admin/backup/{ticket}",
	} {
		if !strings.Contains(string(src), `"`+p+`"`) {
			t.Errorf("route %s is not declared", p)
		}
	}
	readme, _ := os.ReadFile("../../../docs/contracts/README.md")
	if !strings.Contains(string(readme), "backup/") {
		t.Error("docs/contracts/README.md has no backup row")
	}
}
