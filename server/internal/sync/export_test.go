package sync

import "time"

// SetLegacyClock sets the legacy pull's clock for a test; the returned
// func restores it.
func SetLegacyClock(now func() time.Time) func() {
	old := legacyNow
	legacyNow = now
	return func() { legacyNow = old }
}

// SetLegacyScanHook runs hook for every row the legacy pull scans; the
// returned func removes it.
func SetLegacyScanHook(hook func()) func() {
	old := legacyScanHook
	legacyScanHook = hook
	return func() { legacyScanHook = old }
}
