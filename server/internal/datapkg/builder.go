package datapkg

import (
	"context"
	"sync"
)

// Builder owns the one goroutine that builds packages. Kicks queue package
// ids; a burst of kicks of one id before its build starts coalesces into
// one build (a kick during the build queues one more, since the build's
// snapshot may predate the change). Builds never overlap, so at most one
// long read transaction is open on the server database at a time.
type Builder struct {
	reg  Registry
	logf func(string, ...any)

	mu        sync.Mutex
	queue     []string
	queued    map[string]bool
	reconcile bool
	running   bool
	wake      chan struct{}
	idle      []chan struct{}
}

// NewBuilder returns a builder of r's packages; logf hears failed builds.
// Nothing is built until Run.
func NewBuilder(r Registry, logf func(string, ...any)) *Builder {
	if logf == nil {
		logf = func(string, ...any) {}
	}
	return &Builder{reg: r, logf: logf, queued: map[string]bool{}, wake: make(chan struct{}, 1)}
}

// Registry returns the builder's registry with Busy wired to the builder,
// so its catalogue says building while work is queued or running.
func (b *Builder) Registry() Registry {
	r := b.reg
	r.Busy = b.Busy
	return r
}

// Kick queues package ids for a build; strings that are not package ids
// are ignored.
func (b *Builder) Kick(ids ...string) {
	b.mu.Lock()
	for _, id := range ids {
		if _, _, err := ParseID(id); err != nil || b.queued[id] {
			continue
		}
		b.queued[id] = true
		b.queue = append(b.queue, id)
	}
	b.mu.Unlock()
	b.signal()
}

// KickReconcile queues a Registry.Reconcile (run before queued ids).
func (b *Builder) KickReconcile() {
	b.mu.Lock()
	b.reconcile = true
	b.mu.Unlock()
	b.signal()
}

// PackChanged kicks the packages of a changed pack (AffectedIDs); it is the
// hook for packs.WithOnChange.
func (b *Builder) PackChanged(typ, packID, language string) {
	b.Kick(AffectedIDs(context.Background(), b.reg.DB, typ, packID, language)...)
}

func (b *Builder) signal() {
	select {
	case b.wake <- struct{}{}:
	default:
	}
}

// Busy reports whether work is queued or running.
func (b *Builder) Busy() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.busyLocked()
}

func (b *Builder) busyLocked() bool { return b.running || b.reconcile || len(b.queue) > 0 }

// Run builds queued work until ctx ends. Call it once.
func (b *Builder) Run(ctx context.Context) {
	for {
		b.mu.Lock()
		reconcile, id := b.reconcile, ""
		switch {
		case reconcile:
			b.reconcile = false
		case len(b.queue) > 0:
			id = b.queue[0]
			b.queue = b.queue[1:]
			delete(b.queued, id)
		}
		b.running = reconcile || id != ""
		if !b.running {
			for _, ch := range b.idle {
				close(ch)
			}
			b.idle = nil
		}
		b.mu.Unlock()

		switch {
		case reconcile:
			if err := b.reg.Reconcile(ctx); err != nil {
				b.logf("packages: reconcile: %v", err)
			}
		case id != "":
			if err := b.build(ctx, id); err != nil {
				b.logf("packages: %v", err)
			}
		default:
			select {
			case <-ctx.Done():
				b.mu.Lock()
				b.running = false
				b.mu.Unlock()
				return
			case <-b.wake:
			}
		}
		if ctx.Err() != nil {
			b.mu.Lock()
			b.running = false
			b.mu.Unlock()
			return
		}
	}
}

func (b *Builder) build(ctx context.Context, id string) error {
	specs, err := Plan(ctx, b.reg.DB)
	if err != nil {
		return err
	}
	return b.reg.build(ctx, id, specs)
}

// Wait returns once the builder is idle with nothing queued, or when ctx
// ends. It needs Run to be running (or to start) to return early.
func (b *Builder) Wait(ctx context.Context) error {
	b.mu.Lock()
	if !b.busyLocked() {
		b.mu.Unlock()
		return nil
	}
	ch := make(chan struct{})
	b.idle = append(b.idle, ch)
	b.mu.Unlock()
	select {
	case <-ch:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
