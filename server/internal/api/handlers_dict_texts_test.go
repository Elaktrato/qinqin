package api_test

import (
	"context"
	"net/http"
	"strconv"
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/packs"
)

// The legacy dictionary routes install and uninstall through the pack
// system like an upload does (#192 review): the licence texts are stored
// with the dictionary and go with it.
func TestLegacyDictionaryRoutesKeepTheLicenceTexts(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB, _ := newServerWithDir(t)
	admin := registerUser(t, ts.URL, "admin", "")
	resp := postPack(t, ts.URL, admin, "pack", zipDirToBytes(t, dictFixture))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("install: %d", resp.StatusCode)
	}
	var installed dictionaryBody
	decodeJSON(t, resp, &installed)
	if ok, err := packs.TextsStored(context.Background(), sqlDB, "dictionary", "mkgloss"); !ok || err != nil {
		t.Errorf("licence texts stored after the install: %v, %v", ok, err)
	}
	if resp := doJSON(t, http.MethodDelete, ts.URL, "/api/admin/dictionaries/"+strconv.FormatInt(installed.ID, 10), admin, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("uninstall: %d", resp.StatusCode)
	}
	if ok, _ := packs.TextsStored(context.Background(), sqlDB, "dictionary", "mkgloss"); ok {
		t.Error("licence texts kept after the uninstall")
	}
	if resp := doJSON(t, http.MethodDelete, ts.URL, "/api/admin/dictionaries/"+strconv.FormatInt(installed.ID, 10), admin, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("second uninstall: %d", resp.StatusCode)
	}
}
