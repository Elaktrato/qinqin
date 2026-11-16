package components

// SetMaxBytesForTest lowers the per-file cap and returns the restore func.
func SetMaxBytesForTest(n int64) func() {
	old := maxBytes
	maxBytes = n
	return func() { maxBytes = old }
}
