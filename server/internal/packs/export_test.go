package packs

import (
	"context"
	"database/sql"
	"slices"
	"testing"

	"qinqin/internal/pack"
)

// SetLogfForTest swaps the logger of skipped licence files and returns a
// restore func.
func SetLogfForTest(f func(string, ...any)) (restore func()) {
	old := logf
	logf = f
	return func() { logf = old }
}

// HandlerTypes lists the types of the handler table, in its order.
func HandlerTypes() []string {
	out := make([]string, 0, len(handlers))
	for _, h := range handlers {
		out = append(out, h.typ)
	}
	return out
}

// TypeBefore reports whether List puts type a before type b.
func TypeBefore(a, b string) bool { return typeIndex(a) < typeIndex(b) }

// IncompleteHandlers lists the types whose handler lacks an import or an
// uninstall.
func IncompleteHandlers() []string {
	var out []string
	for _, h := range handlers {
		if h.importPack == nil || h.uninstall == nil {
			out = append(out, h.typ)
		}
	}
	return out
}

// AddTypeForTest adds a pack type for the rest of the test: its row of the
// pack-type table and its handler, and nothing else (#192).
func AddTypeForTest(t testing.TB, d pack.Descriptor,
	importPack func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack) (string, error),
	uninstall func(ctx context.Context, sqlDB *sql.DB, packID string) error) {
	t.Helper()
	oldAll, oldHandlers := pack.All, handlers
	t.Cleanup(func() { pack.All, handlers = oldAll, oldHandlers })
	pack.All = append(slices.Clone(pack.All), d)
	handlers = append(slices.Clone(handlers), handler{typ: d.Type,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			return importPack(ctx, sqlDB, pk)
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			return uninstall(ctx, sqlDB, packID)
		}})
}

// UninstallErrorsForTest calls every handler's uninstall for a pack that is
// not installed, with the stores given, and returns each type's error as the
// handler returned it (before Uninstall maps it).
func UninstallErrorsForTest(ctx context.Context, sqlDB *sql.DB, audioStore, fontStore string) map[string]error {
	o := options{audioStore: audioStore, fontStore: fontStore}
	out := map[string]error{}
	for _, h := range handlers {
		out[h.typ] = h.uninstall(ctx, sqlDB, "not-installed", o)
	}
	return out
}
