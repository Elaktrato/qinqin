package backup

import (
	"context"
	"encoding/json"
	"testing"
)

// account.json carries the interface language (#73): exported always
// (also ''), restored when present and valid; an archive without the key
// (every v1 archive before #73) leaves the current value, and an invalid
// value is ignored without failing the restore.
func TestInterfaceLanguageExportAndRestore(t *testing.T) {
	src := newWorld(t)
	exec(t, src.DB, `UPDATE users SET interface_language = 'zh-Hant' WHERE id = ?`, src.AliceUID)
	data, _ := exportBytes(t, src, src.AliceUID)
	files, _ := unzipAll(t, data)
	var acc map[string]any
	if err := json.Unmarshal(files[NameAccount], &acc); err != nil {
		t.Fatal(err)
	}
	if acc["interfaceLanguage"] != "zh-Hant" {
		t.Errorf("exported interfaceLanguage %v", acc["interfaceLanguage"])
	}

	tg := newTarget(t, nil)
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, openExport(t, src, src.AliceUID), Options{DropUnresolved: true}); err != nil {
		t.Fatal(err)
	}
	if got := interfaceLanguageOf(t, tg.baseWorld, tg.UID); got != "zh-Hant" {
		t.Errorf("restored %q, want zh-Hant", got)
	}

	// '' is exported as '' and restores as ''.
	exec(t, src.DB, `UPDATE users SET interface_language = '' WHERE id = ?`, src.AliceUID)
	data, _ = exportBytes(t, src, src.AliceUID)
	files, _ = unzipAll(t, data)
	acc = nil
	json.Unmarshal(files[NameAccount], &acc)
	if v, ok := acc["interfaceLanguage"]; !ok || v != "" {
		t.Errorf("exported %v (present %v), want ''", v, ok)
	}
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, openExport(t, src, src.AliceUID), Options{DropUnresolved: true}); err != nil {
		t.Fatal(err)
	}
	if got := interfaceLanguageOf(t, tg.baseWorld, tg.UID); got != "" {
		t.Errorf("restored %q, want ''", got)
	}
}

func TestInterfaceLanguageAbsentOrInvalidKeepsTheCurrentValue(t *testing.T) {
	for name, edit := range map[string]func(acc map[string]any){
		"absent":     func(acc map[string]any) { delete(acc, "interfaceLanguage") },
		"invalid":    func(acc map[string]any) { acc["interfaceLanguage"] = "EN_us" },
		"null":       func(acc map[string]any) { acc["interfaceLanguage"] = nil },
	} {
		t.Run(name, func(t *testing.T) {
			files := sampleFiles(t)
			var acc map[string]any
			if err := json.Unmarshal(files[NameAccount], &acc); err != nil {
				t.Fatal(err)
			}
			edit(acc)
			files[NameAccount], _ = json.Marshal(acc)
			a, err := Open(writeZip(t, files, zopts{}))
			if err != nil {
				t.Fatalf("Open: %v", err)
			}
			defer a.Close()
			tg, _ := sampleTarget(t)
			exec(t, tg.DB, `UPDATE users SET interface_language = 'pt-BR' WHERE id = ?`, tg.UID)
			if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{}); err != nil {
				t.Fatalf("Restore: %v", err)
			}
			if got := interfaceLanguageOf(t, tg.baseWorld, tg.UID); got != "pt-BR" {
				t.Errorf("after restore %q, want pt-BR kept", got)
			}
		})
	}
}

// The committed v1 sample carries the field.
func TestSampleAccountHasInterfaceLanguage(t *testing.T) {
	var acc Account
	strictDecode(t, readSample(t, NameAccount), &acc)
	if acc.InterfaceLanguage == nil || *acc.InterfaceLanguage != "en" {
		t.Errorf("sample interfaceLanguage %v", acc.InterfaceLanguage)
	}
}

func interfaceLanguageOf(t *testing.T, w *baseWorld, uid int64) string {
	t.Helper()
	var lang string
	if err := w.DB.QueryRow(`SELECT interface_language FROM users WHERE id = ?`, uid).Scan(&lang); err != nil {
		t.Fatal(err)
	}
	return lang
}
