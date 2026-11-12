package epub

// Limits is exported to the external tests so they can lower the caps.
type Limits = limits

// SetLimits replaces the caps, returning a function that restores them.
func SetLimits(l Limits) (restore func()) {
	old := lim
	lim = l
	return func() { lim = old }
}

// DefaultLimits returns the production caps.
func DefaultLimits() Limits { return production }

var production = lim
