package packs

// SetLogfForTest swaps the logger of skipped licence files and returns a
// restore func.
func SetLogfForTest(f func(string, ...any)) (restore func()) {
	old := logf
	logf = f
	return func() { logf = old }
}
