package packs

// SetLogfForTest swaps the logger of skipped licence files and returns a
// restore func.
func SetLogfForTest(f func(string, ...any)) (restore func()) {
	old := logf
	logf = f
	return func() { logf = old }
}

// OperationTypes lists the pack types that have an importer and an
// uninstaller.
func OperationTypes() []string {
	out := make([]string, 0, len(operations))
	for typ := range operations {
		out = append(out, typ)
	}
	return out
}

// TypeBefore reports whether List puts type a before type b.
func TypeBefore(a, b string) bool { return typeIndex(a) < typeIndex(b) }
