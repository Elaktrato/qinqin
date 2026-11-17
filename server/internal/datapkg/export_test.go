package datapkg

// SetBatchHookForTest installs f to run after every batch a build writes
// and returns a restore func.
func SetBatchHookForTest(f func()) (restore func()) {
	old := batchHook
	batchHook = f
	return func() { batchHook = old }
}

// SetBuildHookForTest installs f to run before every package build (a
// non-nil error fails it) and returns a restore func.
func SetBuildHookForTest(f func(id string) error) (restore func()) {
	old := buildHook
	buildHook = f
	return func() { buildHook = old }
}
