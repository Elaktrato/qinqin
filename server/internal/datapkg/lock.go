package datapkg

import (
	"context"
	"os"
	"path/filepath"
	"time"
)

// lockFileName is the lock file under Registry.Dir. Every build and every
// reconcile holds it, so two processes on one data directory (qinqin seed
// next to a running qinqin serve) never build at once: they would share
// temporary file names, and a reconcile's purge of stray .tmp files would
// delete the other's build in flight.
const lockFileName = ".lock"

// lockPoll is how often a waiting registry retries the lock.
const lockPoll = 50 * time.Millisecond

// lock takes the registry's exclusive lock, waiting until it is free or ctx
// ends, and returns its release.
func (r Registry) lock(ctx context.Context) (unlock func(), err error) {
	if err := os.MkdirAll(r.Dir, 0o755); err != nil {
		return nil, err
	}
	// Read-only: flock needs no write access, so a lock file another user
	// (root) created still works.
	path := filepath.Join(r.Dir, lockFileName)
	f, err := os.OpenFile(path, os.O_RDONLY|os.O_CREATE, 0o644)
	if err != nil {
		if f, err = os.Open(path); err != nil {
			return nil, err
		}
	}
	for {
		held, err := tryLockFile(f)
		if err != nil {
			f.Close()
			return nil, err
		}
		if held {
			return func() {
				unlockFile(f)
				f.Close()
			}, nil
		}
		select {
		case <-ctx.Done():
			f.Close()
			return nil, ctx.Err()
		case <-time.After(lockPoll):
		}
	}
}
