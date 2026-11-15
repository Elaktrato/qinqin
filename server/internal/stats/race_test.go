//go:build race

package stats_test

// raceEnabled: the race detector slows SQLite scans by two orders of
// magnitude, so the wall-clock bound is not asserted under it.
const raceEnabled = true
