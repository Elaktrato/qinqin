package packs

// SetLogfForTest swaps the logger of skipped licence files and returns a
// restore func.
func SetLogfForTest(f func(string, ...any)) (restore func()) {
	old := logf
	logf = f
	return func() { logf = old }
}

// HandlerTypes lists the types of the handler table, in its order.
func HandlerTypes() []string {
	out := make([]string, 0, len(handlers))
	for _, h := range handlers {
		out = append(out, h.typ)
	}
	return out
}

// TypeBefore reports whether List puts type a before type b.
func TypeBefore(a, b string) bool { return typeIndex(a) < typeIndex(b) }

// IncompleteHandlers lists the types whose handler lacks an import or an
// uninstall.
func IncompleteHandlers() []string {
	var out []string
	for _, h := range handlers {
		if h.importPack == nil || h.uninstall == nil {
			out = append(out, h.typ)
		}
	}
	return out
}
