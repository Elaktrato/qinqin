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

// SetRenameHookForTest replaces the rename that moves a built file into
// place and returns a restore func.
func SetRenameHookForTest(f func(oldPath, newPath string) error) (restore func()) {
	old := renameFile
	renameFile = f
	return func() { renameFile = old }
}

// IDPatternForTest is the package id grammar.
func IDPatternForTest() string { return idPattern.String() }

// PlanSourceForTest is the pack type each package type (other than the
// lexicon) is planned from, with its optional and requires-lexicon flags.
func PlanSourceForTest() map[Type]struct {
	PackType                  string
	Optional, RequiresLexicon bool
} {
	out := map[Type]struct {
		PackType                  string
		Optional, RequiresLexicon bool
	}{}
	for _, r := range registries {
		out[r.typ] = struct {
			PackType                  string
			Optional, RequiresLexicon bool
		}{r.packType, r.optional, r.requiresLexicon}
	}
	return out
}
