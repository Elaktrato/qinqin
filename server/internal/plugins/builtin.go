package plugins

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"sort"
)

// builtinFS holds the manifests of the feature plugins this build
// ships. The web build imports the same files (the $builtin alias), so
// the rules the server checks and the rules the web runs are one copy.
//
//go:embed builtin/*.json
var builtinFS embed.FS

// builtinFiles is the fixed registration order of the built-ins.
var builtinFiles = []string{"core", "flashcards", "reader", "journal", "grammar"}

// Builtin returns the embedded manifests in a fixed order: core,
// flashcards, reader, journal, grammar.
func Builtin() [][]byte {
	out := make([][]byte, 0, len(builtinFiles))
	for _, name := range builtinFiles {
		raw, err := builtinFS.ReadFile("builtin/" + name + ".json")
		if err != nil {
			// The files are embedded at build time; a miss is a build bug.
			panic(fmt.Sprintf("plugins: embedded manifest %s: %v", name, err))
		}
		out = append(out, raw)
	}
	return out
}

// BuiltinIDs returns the ids of Builtin, in the same order.
func BuiltinIDs() []string {
	raws := Builtin()
	ids := make([]string, 0, len(raws))
	for _, raw := range raws {
		m, err := ParseManifest(raw)
		if err != nil {
			panic(fmt.Sprintf("plugins: embedded manifest: %v", err))
		}
		ids = append(ids, m.ID)
	}
	return ids
}

// RegisterBuiltin parses and upserts a built-in manifest without the
// event-type ownership check: a built-in wins a conflict, so an admin
// row can never stop the server from starting. It returns the sorted
// ids of other parsable non-built-in rows that claim one of the
// built-in's event types, for the caller to warn about.
func RegisterBuiltin(ctx context.Context, sqlDB *sql.DB, raw []byte) (conflicts []string, err error) {
	m, err := ParseManifest(raw)
	if err != nil {
		return nil, err
	}
	tx, err := beginImmediate(ctx, sqlDB)
	if err != nil {
		return nil, fmt.Errorf("plugins: register %s: %w", m.ID, err)
	}
	defer tx.rollback()
	owners, err := eventOwners(ctx, tx.conn, m.ID)
	if err != nil {
		return nil, err
	}
	// Another built-in's row is never a conflict: a stale row of an older
	// build (v0.3.0's flashcards owned review, its reader read; both moved
	// into the core) is replaced in the same start-up.
	seen := map[string]bool{}
	for _, id := range BuiltinIDs() {
		seen[id] = true
	}
	for _, e := range m.Events {
		if owner, ok := owners[e.Type]; ok && !seen[owner] {
			seen[owner] = true
			conflicts = append(conflicts, owner)
		}
	}
	sort.Strings(conflicts)
	if err := upsert(ctx, tx.conn, m.ID, raw); err != nil {
		return nil, err
	}
	if err := tx.commit(ctx); err != nil {
		return nil, fmt.Errorf("plugins: register %s: %w", m.ID, err)
	}
	return conflicts, nil
}
