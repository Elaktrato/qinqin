//go:build unix

package datapkg

import (
	"errors"
	"os"
	"syscall"
)

// tryLockFile takes an exclusive flock on f without blocking; held reports
// false when another open file description holds it (another process, or
// another Registry of this one).
func tryLockFile(f *os.File) (held bool, err error) {
	err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if errors.Is(err, syscall.EWOULDBLOCK) {
		return false, nil
	}
	return err == nil, err
}

// unlockFile releases the flock (closing f would too).
func unlockFile(f *os.File) error { return syscall.Flock(int(f.Fd()), syscall.LOCK_UN) }
