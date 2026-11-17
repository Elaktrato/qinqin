package datapkg

// SetBatchHookForTest installs f to run after every batch a build writes
// and returns a restore func.
func SetBatchHookForTest(f func()) (restore func()) {
	old := batchHook
	batchHook = f
	return func() { batchHook = old }
}
