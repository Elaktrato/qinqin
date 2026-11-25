package fonts

// SetAfterStoreHookForTest runs f after Import stored a pack's slices and
// before its transaction; it returns a restore func.
func SetAfterStoreHookForTest(f func()) (restore func()) {
	old := afterStoreHook
	afterStoreHook = f
	return func() { afterStoreHook = old }
}
