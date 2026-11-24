package workspaces_test

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"sort"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/workspaces"
)

// workspaceTables lists every table of the migrated schema with a
// workspace_id column.
func workspaceTables(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query(`SELECT m.name FROM sqlite_master m, pragma_table_info(m.name) p
		WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND p.name = 'workspace_id' ORDER BY m.name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		out = append(out, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestEveryWorkspaceTableHasADeleteRule is the schema guard of record
// 0003: a new table with a workspace_id column fails here until Delete has
// a rule for it (it empties the table, or keeps it for a stated reason).
func TestEveryWorkspaceTableHasADeleteRule(t *testing.T) {
	db := dbtest.Open(t)
	tables := workspaceTables(t, db)
	if len(tables) < 10 {
		t.Fatalf("found only %v: the schema query is broken", tables)
	}
	ruled := map[string]workspaces.Rule{}
	for _, r := range workspaces.Rules() {
		if _, dup := ruled[r.Table]; dup {
			t.Errorf("%s has two rules", r.Table)
		}
		ruled[r.Table] = r
	}
	for _, table := range tables {
		if _, ok := ruled[table]; !ok {
			t.Errorf("table %s has a workspace_id column but no rule in the workspace delete (internal/workspaces): delete its rows, or keep them with a reason", table)
		}
	}
	for name := range ruled {
		if !slices.Contains(tables, name) {
			t.Errorf("the workspace delete has a rule for %s, which has no workspace_id column (stale rule)", name)
		}
	}
}

// seedSQL gives one row per workspace table for workspace ?2 of user ?1;
// ?3 is a number distinct per workspace, for keys.
var seedSQL = map[string][]string{
	"study_events":        {`INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES ('ev' || ?3, ?1, ?2, 'd', 't', 'review', '{}', 't')`},
	"keyed_rows":          {`INSERT INTO keyed_rows (user_id, workspace_id, key, data, version, updated_at, modified_at) VALUES (?1, ?2, 'notecfg', '{}', 1, 't', 't')`},
	"library_books":       {`INSERT INTO library_books (user_id, workspace_id, language, title, source, source_id, created_at) VALUES (?1, ?2, 'zh', 'B', 'upload', 's' || ?3, 't')`},
	"study_cards":         {`INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, created_at, version, updated_at, modified_at) VALUES (?1, ?2, 'c', 'vocab', 1, 't', 1, 't', 't')`},
	"study_decks":         {`INSERT INTO study_decks (user_id, workspace_id, id, name, created_at, version, updated_at, modified_at) VALUES (?1, ?2, 'd', 'n', 't', 1, 't', 't')`},
	"study_deck_settings": {`INSERT INTO study_deck_settings (user_id, workspace_id, deck_id, version, updated_at, modified_at) VALUES (?1, ?2, 'general', 1, 't', 't')`},
	"study_limits":        {`INSERT INTO study_limits (user_id, workspace_id, deck_id, new_set, reviews_set, version, updated_at, modified_at) VALUES (?1, ?2, '', 0, 0, 1, 't', 't')`},
	"study_fsrs_sets":     {`INSERT INTO study_fsrs_sets (user_id, workspace_id, id, w, created_at, source, version, updated_at, modified_at) VALUES (?1, ?2, 's', '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]', 't', 'imported', 1, 't', 't')`},
	"study_fsrs_active":   {`INSERT INTO study_fsrs_active (user_id, workspace_id, version, updated_at, modified_at) VALUES (?1, ?2, 1, 't', 't')`},
	"library_deletions":   {`INSERT INTO library_deletions (user_id, collection, row_id, workspace_id, deleted_at) VALUES (?1, 'books', 1000 + ?3, ?2, 't')`},
	"journal_entries":     {`INSERT INTO journal_entries (user_id, workspace_id, id, date, title, text, source, created_at, updated_at) VALUES (?1, ?2, 'e' || ?3, '2026-11-19', '', 't', 'typed', 't', 't')`},
	"journal_reviews":     {`INSERT INTO journal_reviews (user_id, workspace_id, entry_id, text_hash, annotations, overall, model, dropped, created_at) VALUES (?1, ?2, 'e' || ?3, 'h', '[]', '{}', 'm', '{}', 't')`},
	"journal_suggestions": {`INSERT INTO journal_suggestions (user_id, workspace_id, items, model, created_at) VALUES (?1, ?2, '[]', 'm', 't')`},
	"journal_settings":    {`INSERT INTO journal_settings (user_id, workspace_id, guidance, explanation_language, updated_at) VALUES (?1, ?2, '', 'en', 't')`},
	"grammar_progress":    {`INSERT INTO grammar_progress (user_id, workspace_id, pack_id, lesson_id, completed_at, best, total, updated_at) VALUES (?1, ?2, 'p', 'l' || ?3, 't', 1, 2, 't')`},
	"journal_photos":      {`INSERT INTO journal_photos (id, user_id, workspace_id, created_at, last_seen_at) VALUES ('ph' || ?3, ?1, ?2, 't', 't')`},
	"access_tokens":       {`INSERT INTO access_tokens (user_id, workspace_id, name, token_hash, hint, scope, created_at, expires_at) VALUES (?1, ?2, 'n', 'ah' || ?3, 'abcdef', 'read', 't', '9999')`},
}

// childSeeds seed, for workspace ?2 of user ?1, one row of every child
// table: a table without a workspace_id whose rows hang off a row of a
// workspace table (childTables).
var childSeeds = map[string]string{
	"library_bookmarks":  `INSERT INTO library_bookmarks (user_id, book_id, position, created_at) VALUES (?1, (SELECT id FROM library_books WHERE workspace_id = ?2), '0:0', 't')`,
	"library_highlights": `INSERT INTO library_highlights (user_id, book_id, chapter, paragraph, start_cp, end_cp, text, created_at, updated_at) VALUES (?1, (SELECT id FROM library_books WHERE workspace_id = ?2), 0, 0, 0, 1, 'x', 't', 't')`,
}

// child is a table whose column points at the id of a workspace table.
type child struct{ table, column, parent string }

// childTables lists, from the migrated schema, the tables without a
// workspace_id that point at a workspace table: by a foreign key, or by a
// book_id column (a row of library_books).
func childTables(t *testing.T, db *sql.DB, workspaceTables []string) []child {
	t.Helper()
	found := map[string]child{}
	rows, err := db.Query(`SELECT m.name, f."from", f."table" FROM sqlite_master m, pragma_foreign_key_list(m.name) f
		WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var c child
		if err := rows.Scan(&c.table, &c.column, &c.parent); err != nil {
			t.Fatal(err)
		}
		if slices.Contains(workspaceTables, c.parent) && !slices.Contains(workspaceTables, c.table) {
			found[c.table] = c
		}
	}
	rows.Close()
	rows, err = db.Query(`SELECT m.name FROM sqlite_master m, pragma_table_info(m.name) p
		WHERE m.type = 'table' AND p.name = 'book_id' ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		if _, ok := found[name]; !ok && !slices.Contains(workspaceTables, name) {
			found[name] = child{name, "book_id", "library_books"}
		}
	}
	rows.Close()
	var out []child
	for _, c := range found {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].table < out[j].table })
	return out
}

func countIn(t *testing.T, db *sql.DB, table string, ws int64) int {
	t.Helper()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE workspace_id = ?`, ws).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func countChildren(t *testing.T, db *sql.DB, c child, ws int64) int {
	t.Helper()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM `+c.table+` x JOIN `+c.parent+` p ON p.id = x.`+c.column+` WHERE p.workspace_id = ?`, ws).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", c.table, err)
	}
	return n
}

// TestDeleteEmptiesEveryWorkspaceTable seeds a row in every table with a
// workspace_id and in every child table (childTables) for two workspaces of one user
// and one of another, deletes one, and checks every table of the schema:
// nothing of the deleted workspace is left except in a kept table, and the
// other workspaces keep every row.
func TestDeleteEmptiesEveryWorkspaceTable(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := dbtest.User(t, db, "alice"), dbtest.User(t, db, "bob")
	gone, kept := dbtest.Workspace(t, db, alice, "zh"), dbtest.Workspace(t, db, alice, "ja")
	other := dbtest.Workspace(t, db, bob, "zh")
	tables := workspaceTables(t, db)
	for _, table := range tables {
		if _, ok := seedSQL[table]; !ok {
			t.Fatalf("no seed row for %s: extend seedSQL so this test covers its delete rule", table)
		}
	}
	children := childTables(t, db, tables)
	if len(children) < 2 {
		t.Fatalf("found only the child tables %v: the schema query is broken", children)
	}
	for _, c := range children {
		if _, ok := childSeeds[c.table]; !ok {
			t.Fatalf("no seed row for %s (a child of %s): extend childSeeds, and make the workspace delete remove its rows", c.table, c.parent)
		}
	}
	for i, ws := range []struct{ user, id int64 }{{alice, gone}, {alice, kept}, {bob, other}} {
		for _, table := range tables {
			for _, q := range seedSQL[table] {
				if _, err := db.Exec(q, ws.user, ws.id, i); err != nil {
					t.Fatalf("seed %s: %v", table, err)
				}
			}
		}
		for _, c := range children {
			if _, err := db.Exec(childSeeds[c.table], ws.user, ws.id); err != nil {
				t.Fatalf("seed %s: %v", c.table, err)
			}
		}
	}
	var bookID int64
	if err := db.QueryRow(`SELECT id FROM library_books WHERE workspace_id = ?`, gone).Scan(&bookID); err != nil {
		t.Fatal(err)
	}
	// The parent rows of the deleted workspace, to find orphans afterwards.
	goneParents := map[string]string{}
	for _, c := range children {
		var ids string
		if err := db.QueryRow(`SELECT COALESCE(group_concat(id), '') FROM `+c.parent+` WHERE workspace_id = ?`, gone).Scan(&ids); err != nil {
			t.Fatal(err)
		}
		goneParents[c.parent] = ids
	}

	del, err := workspaces.Delete(ctx, db, alice, gone)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(del.Books, []int64{bookID}) || !slices.Equal(del.Photos, []string{"ph0"}) {
		t.Errorf("Delete = %+v, want book %d and photo ph0", del, bookID)
	}
	keep := map[string]string{}
	for _, r := range workspaces.Rules() {
		if r.Keep != "" {
			keep[r.Table] = r.Keep
		}
	}
	for _, table := range tables {
		if n := countIn(t, db, table, gone); n != 0 && keep[table] == "" {
			t.Errorf("%s: %d rows of the deleted workspace remain", table, n)
		}
		for _, ws := range []int64{kept, other} {
			if n := countIn(t, db, table, ws); n != len(seedSQL[table]) {
				t.Errorf("%s: workspace %d has %d rows, want its %d", table, ws, n, len(seedSQL[table]))
			}
		}
	}
	for _, c := range children {
		if n := countChildren(t, db, c, gone); n != 0 {
			t.Errorf("%s: %d rows of the deleted workspace's %s remain", c.table, n, c.parent)
		}
		if ids := goneParents[c.parent]; ids != "" {
			var orphans int
			db.QueryRow(`SELECT COUNT(*) FROM ` + c.table + ` WHERE ` + c.column + ` IN (` + ids + `)`).Scan(&orphans)
			if orphans != 0 {
				t.Errorf("%s: %d rows of the deleted %s rows remain", c.table, orphans, c.parent)
			}
		}
		if n := countChildren(t, db, c, kept); n != 1 {
			t.Errorf("%s: the kept workspace has %d rows, want 1", c.table, n)
		}
	}
	var ws int
	db.QueryRow(`SELECT COUNT(*) FROM workspaces WHERE id = ?`, gone).Scan(&ws)
	if ws != 0 {
		t.Error("the workspaces row remains")
	}
	// The kept library log gained the deleted book and its two children.
	var logged []string
	rows, err := db.Query(`SELECT collection FROM library_deletions WHERE workspace_id = ? ORDER BY collection`, gone)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var c string
		rows.Scan(&c)
		logged = append(logged, c)
	}
	rows.Close()
	sort.Strings(logged)
	if !slices.Equal(logged, []string{"bookmarks", "books", "books", "highlights"}) {
		t.Errorf("library_deletions of the deleted workspace = %v, want the seeded row and the book with its bookmark and highlight", logged)
	}
	// The workspace-limited token went, audited.
	var audits int
	db.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'token_revoked' AND actor_id = ?`, alice).Scan(&audits)
	if audits != 1 {
		t.Errorf("token revocation audited %d times, want 1", audits)
	}
}

func TestDeleteRefusals(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := dbtest.User(t, db, "alice"), dbtest.User(t, db, "bob")
	only := dbtest.Workspace(t, db, alice, "zh")
	bobs := dbtest.Workspace(t, db, bob, "zh")
	dbtest.Workspace(t, db, bob, "ja")
	if _, err := workspaces.Delete(ctx, db, alice, only); !errors.Is(err, workspaces.ErrLastWorkspace) {
		t.Errorf("last workspace: %v", err)
	}
	if _, err := workspaces.Delete(ctx, db, alice, bobs); !errors.Is(err, workspaces.ErrNotFound) {
		t.Errorf("foreign workspace: %v", err)
	}
	if _, err := workspaces.Delete(ctx, db, alice, 999); !errors.Is(err, workspaces.ErrNotFound) {
		t.Errorf("unknown workspace: %v", err)
	}
	// Without a token row nothing is audited.
	if _, err := workspaces.Delete(ctx, db, bob, bobs); err != nil {
		t.Fatal(err)
	}
	var audits int
	db.QueryRow(`SELECT COUNT(*) FROM auth_audit`).Scan(&audits)
	if audits != 0 {
		t.Errorf("%d audit rows, want none", audits)
	}
}
