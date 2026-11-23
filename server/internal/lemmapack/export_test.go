package lemmapack

import "context"

// SetReloadForTest swaps the reload Import and Uninstall run after their
// commit and returns a restore func.
func SetReloadForTest(f func(ctx context.Context, q Querier) error) (restore func()) {
	old := reload
	reload = f
	return func() { reload = old }
}
