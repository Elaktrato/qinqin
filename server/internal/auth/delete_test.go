package auth_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/auth"
)

// seedSQL gives one row per registry table for user ?1 (and, where the
// primary key needs it, a value derived from ?1 so two users can coexist).
var seedSQL = map[string][]string{
	"workspaces":            {`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (?1, 'zh', 'w', 't')`},
	"study_events":          {`INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES ('ev' || ?1, ?1, (SELECT id FROM workspaces WHERE user_id = ?1), 'd', 't', 'review', '{}', 't')`},
	"feature_switches":      {`INSERT INTO feature_switches (user_id, feature, enabled, updated_at) VALUES (?1, 'journal', 0, 't')`},
	"keyed_rows":            {`INSERT INTO keyed_rows (user_id, workspace_id, key, data, version, updated_at, modified_at) VALUES (?1, NULL, 'home-layout', '{}', 1, 't', 't')`},
	"user_edits":            {`INSERT INTO user_edits (user_id, entry_id, updated_at) VALUES (?1, 1, 't')`},
	"sentences":             {`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (1, 'user', ?1, 'h', 'p', 't', 't')`},
	"example_drafts":        {`INSERT INTO example_drafts (user_id, entry_id, request_id, hanzi, pinyin, translation, level, provider, model, created_at) VALUES (?1, 1, 'r', 'h', '', 't', 'beginner', 'p', 'm', 't')`},
	"example_generations":   {`INSERT INTO example_generations (user_id, entry_id, request_id, level, dropped, provider, model, created_at) VALUES (?1, 1, 'r', 'beginner', 0, 'p', 'm', 't')`},
	"picture_reports":       {`INSERT INTO picture_reports (user_id, entry_id, language, pack_id, concept, reason, created_at) VALUES (?1, 1, 'zh', 'p', 'c', 'wrong', 't')`},
	"example_reports":       {`INSERT INTO example_reports (user_id, entry_id, language, hanzi, pinyin, translation, reason, level, provider, model, created_at) VALUES (?1, 1, 'zh', 'h', '', 't', 'other', 'beginner', 'p', 'm', 't')`},
	"library_books":         {`INSERT INTO library_books (user_id, workspace_id, language, title, created_at) VALUES (?1, (SELECT id FROM workspaces WHERE user_id = ?1), 'zh', 'B', 't')`},
	"library_bookmarks":     {`INSERT INTO library_bookmarks (user_id, book_id, position, created_at) VALUES (?1, (SELECT id FROM library_books WHERE user_id = ?1), '0:0', 't')`},
	"library_highlights":    {`INSERT INTO library_highlights (user_id, book_id, chapter, paragraph, start_cp, end_cp, text, created_at, updated_at) VALUES (?1, (SELECT id FROM library_books WHERE user_id = ?1), 0, 0, 0, 1, 'x', 't', 't')`},
	"study_cards":           {`INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, created_at, version, updated_at, modified_at) VALUES (?1, (SELECT id FROM workspaces WHERE user_id = ?1), 'c', 'vocab', 1, 't', 1, 't', 't')`},
	"study_decks":           {`INSERT INTO study_decks (user_id, workspace_id, id, name, created_at, version, updated_at, modified_at) VALUES (?1, (SELECT id FROM workspaces WHERE user_id = ?1), 'd', 'n', 't', 1, 't', 't')`},
	"study_deck_settings":   {`INSERT INTO study_deck_settings (user_id, workspace_id, deck_id, version, updated_at, modified_at) VALUES (?1, (SELECT id FROM workspaces WHERE user_id = ?1), 'general', 1, 't', 't')`},
	"study_limits":          {`INSERT INTO study_limits (user_id, workspace_id, deck_id, new_set, reviews_set, version, updated_at, modified_at) VALUES (?1, (SELECT id FROM workspaces WHERE user_id = ?1), '', 0, 0, 1, 't', 't')`},
	"study_fsrs_sets":       {`INSERT INTO study_fsrs_sets (user_id, workspace_id, id, w, created_at, source, version, updated_at, modified_at) VALUES (?1, (SELECT id FROM workspaces WHERE user_id = ?1), 's', '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]', 't', 'imported', 1, 't', 't')`},
	"study_fsrs_active":     {`INSERT INTO study_fsrs_active (user_id, workspace_id, version, updated_at, modified_at) VALUES (?1, (SELECT id FROM workspaces WHERE user_id = ?1), 1, 't', 't')`},
	"library_deletions":     {`INSERT INTO library_deletions (user_id, collection, row_id, workspace_id, deleted_at) VALUES (?1, 'books', 1000 + ?1, 1, 't')`},
	"user_time_zones":       {`INSERT INTO user_time_zones (user_id, seq, zone, created_at) VALUES (?1, 0, 'UTC', 't')`},
	"journal_entries":       {`INSERT INTO journal_entries (user_id, workspace_id, id, date, title, text, source, created_at, updated_at) VALUES (?1, 1, 'e', '2026-11-19', '', 't', 'typed', 't', 't')`},
	"journal_reviews":       {`INSERT INTO journal_reviews (user_id, workspace_id, entry_id, text_hash, annotations, overall, model, dropped, created_at) VALUES (?1, 1, 'e', 'h', '[]', '{}', 'm', '{}', 't')`},
	"journal_suggestions":   {`INSERT INTO journal_suggestions (user_id, workspace_id, items, model, created_at) VALUES (?1, 1, '[]', 'm', 't')`},
	"journal_settings":      {`INSERT INTO journal_settings (user_id, workspace_id, guidance, explanation_language, updated_at) VALUES (?1, 1, '', 'en', 't')`},
	"journal_conversations": {`INSERT INTO journal_conversations (user_id, workspace_id, id, topic, level, created_at, updated_at) VALUES (?1, 1, 'c', '', 'beginner', 't', 't')`},
	"journal_messages":      {`INSERT INTO journal_messages (user_id, workspace_id, conversation_id, seq, role, text, annotations, turn_id, created_at) VALUES (?1, 1, 'c', 1, 'partner', 'x', '[]', 't1', 't')`},
	"reminder_facts":        {`INSERT INTO reminder_facts (user_id, workspace_id, as_of, data, updated_at) VALUES (?1, (SELECT id FROM workspaces WHERE user_id = ?1), 't', '{}', 't')`},
	"push_subscriptions":    {`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?1, 'https://push.example/' || ?1, 'k', 'a', 't')`},
	"reminder_deliveries":   {`INSERT INTO reminder_deliveries (user_id, channel, kind, day, sent_at, outcome) VALUES (?1, 'email', 'due', '2026-11-25', 't', 'sent')`},
	"user_avatars":          {`INSERT INTO user_avatars (user_id, hash, updated_at) VALUES (?1, printf('%032d', ?1), 't')`},
	"journal_photos":        {`INSERT INTO journal_photos (id, user_id, workspace_id, created_at, last_seen_at) VALUES ('ph' || ?1, ?1, 1, 't', 't')`},
	"ai_keys":               {`INSERT INTO ai_keys (user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at) VALUES (?1, 'anthropic', x'00', x'00', 'fp', 'h', 'm', 't')`},
	"ai_selection":          {`INSERT INTO ai_selection (user_id, provider, updated_at) VALUES (?1, 'anthropic', 't')`},
	"ai_calls":              {`INSERT INTO ai_calls (user_id, kind, model, ok, at) VALUES (?1, 'k', 'm', 1, 't')`},
	"sessions":              {`INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES ('th' || ?1, ?1, 't', 't')`},
	"access_tokens":         {`INSERT INTO access_tokens (user_id, name, token_hash, hint, scope, created_at, expires_at) VALUES (?1, 'n', 'ah' || ?1, 'abcdef', 'read', 't', '9999')`},
	"password_resets":       {`INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES ('rh' || ?1, ?1, 't', 't')`},
	"mfa_totp":              {`INSERT INTO mfa_totp (user_id, secret_ct, secret_nonce, secret_fp, confirmed_at, created_at) VALUES (?1, x'00', x'00', 'fp', 't', 't')`},
	"mfa_recovery_codes":    {`INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?1, 'rc' || ?1)`},
	"auth_challenges":       {`INSERT INTO auth_challenges (token_hash, kind, user_id, expires_at, created_at) VALUES ('ch' || ?1, 'mfa', ?1, 't', 't')`},
	"invites":               {`INSERT INTO invites (token_hash, max_uses, created_by, created_at) VALUES ('ih' || ?1, 1, ?1, 't')`},
}

// refColumns are the columns that point at a user; a table with one of
// them must be in the deletion or the kept registry.
var refColumns = []string{"user_id", "created_by", "updated_by", "actor_id", "target_id", "workspace_id"}

func TestSchemaGuardEveryUserTableIsListed(t *testing.T) {
	sqlDB, _ := usersFixture(t)
	known := map[string][]string{}
	for _, tb := range auth.UserTables() {
		if _, dup := known[tb.Name]; dup {
			t.Errorf("%s is listed twice", tb.Name)
		}
		known[tb.Name] = tb.Columns
		if tb.Export == auth.ExportUnset {
			t.Errorf("%s has no export decision", tb.Name)
		}
		if tb.Export == auth.ExportSkip && tb.ExportReason == "" {
			t.Errorf("%s is skipped from export without a reason", tb.Name)
		}
	}
	rows, err := sqlDB.Query(`SELECT m.name, p.name FROM sqlite_master m, pragma_table_info(m.name) p
		WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	found := map[string][]string{}
	for rows.Next() {
		var table, col string
		rows.Scan(&table, &col)
		if slices.Contains(refColumns, col) {
			found[table] = append(found[table], col)
		}
	}
	for table, cols := range found {
		listed, ok := known[table]
		if !ok {
			t.Errorf("table %s references a user (%v) but is in neither userTables nor keptTables", table, cols)
			continue
		}
		for _, c := range cols {
			if !slices.Contains(listed, c) {
				t.Errorf("table %s column %s is not named by its registry entry %v", table, c, listed)
			}
		}
	}
	for table := range known {
		if _, ok := found[table]; !ok {
			t.Errorf("registry lists %s, which has no user reference column (stale entry)", table)
		}
	}
	// the registry must include the tables other work added
	for _, must := range []string{"user_time_zones", "sessions", "auth_audit", "password_resets", "invites"} {
		if _, ok := known[must]; !ok {
			t.Errorf("%s missing from the registry", must)
		}
	}
	for _, tb := range auth.UserTables() {
		if _, ok := seedSQL[tb.Name]; !ok && len(tb.Statements) > 0 && !slices.Contains([]string{"ai_custom_providers", "auth_settings", "smtp_settings"}, tb.Name) {
			t.Errorf("no seed row for %s: extend seedSQL so the deletion test covers it", tb.Name)
		}
	}
}

func seedUser(t *testing.T, sqlDB *sql.DB, id int64) {
	t.Helper()
	// workspaces first (others read it)
	order := []string{"workspaces"}
	for _, tb := range auth.UserTables() {
		if tb.Name != "workspaces" {
			order = append(order, tb.Name)
		}
	}
	for _, name := range order {
		for _, q := range seedSQL[name] {
			if _, err := sqlDB.Exec(q, id); err != nil {
				t.Fatalf("seed %s: %v", name, err)
			}
		}
	}
	sqlDB.Exec(`INSERT INTO ai_custom_providers (id, name, base_url, default_model, vision, structured, key_required, created_by, created_at) VALUES ('custom-'||?1, 'n', 'u', 'm', 0, 'none', 0, ?1, 't')`, id)
}

func countFor(t *testing.T, sqlDB *sql.DB, table string, id int64) int {
	t.Helper()
	col := "user_id"
	if table == "invites" {
		col = "created_by"
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE `+col+` = ?`, id).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func TestDeleteUserRemovesEverythingPersonal(t *testing.T) {
	sqlDB, users := usersFixture(t)
	ctx := context.Background()
	admin := mkUser(t, sqlDB, "alice", true)
	a := mkUser(t, sqlDB, "doomed", false)
	b := mkUser(t, sqlDB, "stays", false)
	seedUser(t, sqlDB, a)
	seedUser(t, sqlDB, b)
	data := t.TempDir()
	for _, dir := range auth.UserDirs {
		for _, id := range []int64{a, b} {
			p := filepath.Join(data, dir, strconv.FormatInt(id, 10))
			os.MkdirAll(p, 0o755)
			os.WriteFile(filepath.Join(p, "f"), []byte("x"), 0o644)
		}
	}
	auth.Audit(ctx, sqlDB, auth.AuditEvent{Action: "sessions_revoked", ActorID: a, TargetID: &admin, Detail: map[string]any{"scope": "all"}})
	auth.Audit(ctx, sqlDB, auth.AuditEvent{Action: "reset_link_issued", ActorID: admin, TargetID: &a})
	sqlDB.Exec(`UPDATE auth_settings SET updated_by = ?`, a)

	prev, err := auth.DeletionPreview(ctx, sqlDB, a)
	want := auth.Preview{Workspaces: 1, StudyEvents: 1, KeyedRows: 1, Cards: 1, Books: 1, JournalEntries: 1, JournalConversations: 1, JournalPhotos: 1, AIKeys: 1, Sessions: 1, Overlays: 1, Sentences: 1, ExampleReports: 1, PictureReports: 1, AccessTokens: 1, Avatar: 1}
	if err != nil || prev != want {
		t.Fatalf("preview = %+v (%v), want %+v", prev, err, want)
	}
	if err := users.DeleteUser(ctx, admin, a, data); err != nil {
		t.Fatal(err)
	}
	for _, tb := range auth.UserTables() {
		if len(seedSQL[tb.Name]) == 0 {
			continue
		}
		if n := countFor(t, sqlDB, tb.Name, a); n != 0 {
			t.Errorf("%s: %d rows left for the deleted user", tb.Name, n)
		}
		if n := countFor(t, sqlDB, tb.Name, b); n != 1 {
			t.Errorf("%s: %d rows for the other user, want 1 (untouched)", tb.Name, n)
		}
	}
	var one int
	if err := sqlDB.QueryRow(`SELECT 1 FROM users WHERE id = ?`, a).Scan(&one); !errors.Is(err, sql.ErrNoRows) {
		t.Error("the users row is still there")
	}
	for _, dir := range auth.UserDirs {
		if _, err := os.Stat(filepath.Join(data, dir, strconv.FormatInt(a, 10))); !os.IsNotExist(err) {
			t.Errorf("%s/%d still exists", dir, a)
		}
		if _, err := os.Stat(filepath.Join(data, dir, strconv.FormatInt(b, 10), "f")); err != nil {
			t.Errorf("%s/%d of the other user is gone: %v", dir, b, err)
		}
	}
	var by int64
	sqlDB.QueryRow(`SELECT created_by FROM ai_custom_providers WHERE id = 'custom-' || ?`, a).Scan(&by)
	if by != 0 {
		t.Errorf("custom provider created_by = %d, want 0 (kept, shared)", by)
	}
	var upd sql.NullInt64
	sqlDB.QueryRow(`SELECT updated_by FROM auth_settings`).Scan(&upd)
	if upd.Valid {
		t.Errorf("auth_settings.updated_by = %v, want NULL", upd)
	}
	rows, _ := sqlDB.Query(`SELECT action, actor_name, target_name FROM auth_audit ORDER BY id`)
	defer rows.Close()
	gone := "deleted user #" + strconv.FormatInt(a, 10)
	seen := 0
	for rows.Next() {
		var action, actor, target string
		rows.Scan(&action, &actor, &target)
		if strings.Contains(actor, "doomed") || strings.Contains(target, "doomed") {
			t.Errorf("audit row %s still names the user: %q %q", action, actor, target)
		}
		if actor == gone || target == gone {
			seen++
		}
	}
	if seen != 3 { // sessions_revoked (actor), reset_link_issued (target), user_deleted (target)
		t.Errorf("anonymised audit rows = %d, want 3", seen)
	}
}

func TestDeleteLastActiveAdminRefused(t *testing.T) {
	sqlDB, users := usersFixture(t)
	ctx := context.Background()
	a := mkUser(t, sqlDB, "alice", true)
	seedUser(t, sqlDB, a)
	if err := users.DeleteUser(ctx, a, a, t.TempDir()); !errors.Is(err, auth.ErrLastAdmin) {
		t.Fatalf("err = %v, want ErrLastAdmin", err)
	}
	if n := countFor(t, sqlDB, "workspaces", a); n != 1 {
		t.Error("data deleted despite the refusal")
	}
	if err := users.DeleteUser(ctx, a, 9999, t.TempDir()); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("unknown user = %v", err)
	}
}

func TestDeleteUserRollsBackOnFailure(t *testing.T) {
	sqlDB, users := usersFixture(t)
	ctx := context.Background()
	admin := mkUser(t, sqlDB, "alice", true)
	a := mkUser(t, sqlDB, "doomed", false)
	seedUser(t, sqlDB, a)
	data := t.TempDir()
	os.MkdirAll(filepath.Join(data, "books", strconv.FormatInt(a, 10)), 0o755)
	if _, err := sqlDB.Exec(`CREATE TRIGGER boom BEFORE DELETE ON library_books BEGIN SELECT RAISE(ABORT, 'boom'); END`); err != nil {
		t.Fatal(err)
	}
	if err := users.DeleteUser(ctx, admin, a, data); err == nil {
		t.Fatal("delete succeeded despite the failing trigger")
	}
	for _, tb := range auth.UserTables() {
		if len(seedSQL[tb.Name]) == 0 {
			continue
		}
		if n := countFor(t, sqlDB, tb.Name, a); n != 1 {
			t.Errorf("%s: %d rows after the failed delete, want 1", tb.Name, n)
		}
	}
	var one int
	if err := sqlDB.QueryRow(`SELECT 1 FROM users WHERE id = ?`, a).Scan(&one); err != nil {
		t.Errorf("the users row is gone: %v", err)
	}
	if _, err := os.Stat(filepath.Join(data, "books", strconv.FormatInt(a, 10))); err != nil {
		t.Errorf("files removed although the transaction failed: %v", err)
	}
	if n := countFor(t, sqlDB, "sessions", a); n != 1 {
		t.Error("sessions removed by a failed delete")
	}
}

func TestSweepOrphanUserDirs(t *testing.T) {
	sqlDB, _ := usersFixture(t)
	live := mkUser(t, sqlDB, "alice", true)
	data := t.TempDir()
	mk := func(dir, name string) string {
		p := filepath.Join(data, dir, name)
		os.MkdirAll(p, 0o755)
		os.WriteFile(filepath.Join(p, "f"), []byte("x"), 0o644)
		return p
	}
	keep := []string{mk("books", strconv.FormatInt(live, 10)), mk("journal", strconv.FormatInt(live, 10)), mk("books", "notanumber"), mk("books", "007")}
	gone := []string{mk("books", "9999"), mk("journal", "9998")}
	n, err := auth.SweepOrphanUserDirs(context.Background(), sqlDB, data)
	if err != nil || n != 2 {
		t.Fatalf("removed %d (%v), want 2", n, err)
	}
	for _, p := range keep {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s was removed", p)
		}
	}
	for _, p := range gone {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s survived", p)
		}
	}
	if n, err := auth.SweepOrphanUserDirs(context.Background(), sqlDB, t.TempDir()); err != nil || n != 0 {
		t.Errorf("empty data dir: %d %v", n, err)
	}
}

// TestExportAndRestoreDecisionsPerTable pins the backup decision of every
// user table: data the learner made is exported and replaced on restore;
// security and account state is never exported and never touched.
func TestExportAndRestoreDecisionsPerTable(t *testing.T) {
	rows := map[string]bool{"workspaces": true, "study_events": true, "keyed_rows": true, "feature_switches": true,
		"user_edits": true, "sentences": true, "library_books": true, "library_bookmarks": true,
		"library_highlights": true, "user_time_zones": true, "study_cards": true, "study_decks": true,
		"study_deck_settings": true, "study_limits": true, "study_fsrs_sets": true, "study_fsrs_active": true,
		"journal_entries": true, "journal_reviews": true, "journal_suggestions": true, "journal_settings": true,
		"journal_conversations": true, "journal_messages": true, "user_avatars": true}
	for _, tb := range auth.UserTables() {
		if tb.Restore == auth.RestoreUnset {
			t.Errorf("%s has no restore decision", tb.Name)
		}
		switch {
		case rows[tb.Name]:
			if tb.Export != auth.ExportRows || tb.Restore != auth.RestoreReplace {
				t.Errorf("%s must be exported and replaced", tb.Name)
			}
		case tb.Name == "library_deletions":
			if tb.Export != auth.ExportSkip || tb.Restore != auth.RestoreDrop {
				t.Errorf("library_deletions: skip export (sync bookkeeping), drop on restore")
			}
		case tb.Name == "journal_photos":
			if tb.Export != auth.ExportSkip || tb.Restore != auth.RestoreDrop {
				t.Errorf("journal_photos: skip export, drop on restore")
			}
		case tb.Name == "example_drafts" || tb.Name == "example_generations":
			if tb.Export != auth.ExportSkip || tb.Restore != auth.RestoreDrop {
				t.Errorf("%s: skip export (undecided AI output, retry bookkeeping), drop on restore", tb.Name)
			}
		default:
			if tb.Export != auth.ExportSkip || tb.Restore != auth.RestoreKeep {
				t.Errorf("%s must be skipped from export and kept on restore (security or instance data)", tb.Name)
			}
		}
	}
	if !slices.Contains(auth.UserDirs, "backups/pre-restore") {
		t.Errorf("UserDirs %v lacks the safety export directory", auth.UserDirs)
	}
	if !slices.Contains(auth.UserDirs, "avatars") {
		t.Errorf("UserDirs %v lacks the profile pictures (#189)", auth.UserDirs)
	}
}

func TestDeleteUserRemovesSafetyExports(t *testing.T) {
	sqlDB, users := usersFixture(t)
	mkUser(t, sqlDB, "alice", true)
	b := mkUser(t, sqlDB, "bobby", false)
	data := t.TempDir()
	dir := filepath.Join(data, "backups", "pre-restore", strconv.FormatInt(b, 10))
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "x.zip"), []byte("z"), 0o644)
	if err := users.DeleteUser(context.Background(), b, b, data); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("safety export directory survived the deletion: %v", err)
	}
}
