//go:build !unix

package datapkg

import (
	"os"
	"sync"
)

// Without flock the lock covers this process only: registries of one
// process still take turns (the server never runs on such a system in the
// supported setups; run qinqin seed with the server stopped there).
var (
	otherMu   sync.Mutex
	otherHeld = map[string]bool{}
)

func tryLockFile(f *os.File) (bool, error) {
	otherMu.Lock()
	defer otherMu.Unlock()
	if otherHeld[f.Name()] {
		return false, nil
	}
	otherHeld[f.Name()] = true
	return true, nil
}

func unlockFile(f *os.File) error {
	otherMu.Lock()
	defer otherMu.Unlock()
	delete(otherHeld, f.Name())
	return nil
}
