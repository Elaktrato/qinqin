package study_test

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"qinqin/internal/model"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

func legacy(ws *int64, key, data string, deleted bool) model.PluginData {
	r := model.PluginData{PluginID: rows.Namespace, Key: key, WorkspaceID: ws, Data: json.RawMessage(data), UpdatedAt: time.Now().UTC()}
	if deleted {
		at := r.UpdatedAt
		r.DeletedAt = &at
	}
	return r
}

func TestApplyLegacyAndLegacyRows(t *testing.T) {
	sqlDB := openDB(t)
	ctx := context.Background()
	ws := int64(7)
	cardData := `{"id":"c1","kind":"vocab","entryId":5,"deckIds":["general"],"createdAt":"t","note":"kept"}`
	if ok, err := study.ApplyLegacy(ctx, sqlDB, 1, legacy(&ws, "card:c1", cardData, false), time.Now()); err != nil || !ok {
		t.Fatalf("ApplyLegacy = %v, %v", ok, err)
	}
	if _, err := study.ApplyLegacy(ctx, sqlDB, 1, legacy(nil, "card:c2", cardData, false), time.Now()); !errors.Is(err, rows.ErrUnreadable) {
		t.Errorf("user-global typed row err = %v, want ErrUnreadable", err)
	}
	if _, err := study.ApplyLegacy(ctx, sqlDB, 1, legacy(&ws, "card:c3", `{"id":"c3"}`, false), time.Now()); !errors.Is(err, rows.ErrUnreadable) {
		t.Errorf("unreadable row err = %v, want ErrUnreadable", err)
	}
	if _, err := study.ApplyLegacy(ctx, sqlDB, 1, legacy(&ws, "card:none", `null`, true), time.Now()); !errors.Is(err, study.ErrNoTypedRow) {
		t.Errorf("deleting an absent key err = %v, want ErrNoTypedRow", err)
	}
	// user 2 cannot delete user 1's row through the legacy view
	if _, err := study.ApplyLegacy(ctx, sqlDB, 2, legacy(&ws, "card:c1", `null`, true), time.Now()); !errors.Is(err, study.ErrNoTypedRow) {
		t.Errorf("user 2 deleting user 1's card err = %v, want ErrNoTypedRow", err)
	}
	list, err := study.LegacyRows(ctx, sqlDB, 1, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Key != "card:c1" || list[0].PluginID != rows.Namespace || *list[0].WorkspaceID != 7 || list[0].Version != 1 {
		t.Fatalf("LegacyRows = %+v", list)
	}
	var got, want any
	json.Unmarshal(list[0].Data, &got)
	json.Unmarshal([]byte(cardData), &want)
	if !jsonEqual(got, want) {
		t.Errorf("legacy data %s, want %s", list[0].Data, cardData)
	}
	if ok, err := study.ApplyLegacy(ctx, sqlDB, 1, legacy(&ws, "card:c1", `null`, true), time.Now().Add(time.Second)); err != nil || !ok {
		t.Fatalf("legacy delete = %v, %v", ok, err)
	}
	if list, _ := study.LegacyRows(ctx, sqlDB, 1, time.Time{}); len(list) != 0 {
		t.Errorf("zero-cursor LegacyRows shipped a tombstone: %+v", list)
	}
	if list, _ := study.LegacyRows(ctx, sqlDB, 1, time.Unix(0, 0)); len(list) != 1 || list[0].DeletedAt == nil {
		t.Errorf("1970 LegacyRows = %+v, want the tombstone", list)
	}
	if list, _ := study.LegacyRows(ctx, sqlDB, 2, time.Unix(0, 0)); len(list) != 0 {
		t.Errorf("user 2 LegacyRows = %+v", list)
	}
}

func jsonEqual(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

// One storage: raw SQL writes to plugin_data live only in the plugin store,
// the backup restore and the migrations; every other writer goes through
// plugins.PutData*/DeleteData*, which the legacy view routes first.
func TestOnlyKnownCodeWritesPluginData(t *testing.T) {
	allowed := map[string]bool{
		"internal/plugins/plugins.go": true,
		"internal/backup/restore.go":  true,
	}
	writes := regexp.MustCompile(`(?i)(INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+plugin_data\b`)
	root := "../.."
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if writes.Match(raw) && !allowed[rel] && !strings.HasPrefix(rel, "internal/db/") && !strings.HasPrefix(rel, "internal/auth/") {
			t.Errorf("%s writes plugin_data directly", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// LegacyKeySQL selects exactly the keys FamilyOf gives a family.
func TestLegacyKeySQLMatchesFamilyOf(t *testing.T) {
	sqlDB := openDB(t)
	keys := []string{"card:x", "card:", "CARD:x", "cards:x", "deck:x", "decks", "deckcfg:x", "deckcfg:", "limits:workspace", "limits:workspaces",
		"limits:deck:x", "limits:deck:", "limits:other", "fsrs:set:x", "fsrs:active", "fsrs:activeX", "fsrs:other", "known:5", "goals:workspace", "vacation:x", "x"}
	for _, k := range keys {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM (SELECT ? AS key) WHERE `+study.LegacyKeySQL, k).Scan(&n); err != nil {
			t.Fatal(err)
		}
		_, typed := rows.FamilyOf(k)
		if (n == 1) != typed {
			t.Errorf("%q: SQL %v, FamilyOf %v", k, n == 1, typed)
		}
	}
}
