//go:build race

package lexicon_test

// raceEnabled relaxes timing assertions under the race detector, which
// slows the pure-Go SQLite driver several times over.
const raceEnabled = true
