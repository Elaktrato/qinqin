package freq

// SetLimits lowers the importer's input caps for a test and returns the
// function that restores them.
func SetLimits(index, member int64, rows int) (restore func()) {
	i, m, r := maxIndexBytes, maxMemberBytes, maxRows
	maxIndexBytes, maxMemberBytes, maxRows = index, member, rows
	return func() { maxIndexBytes, maxMemberBytes, maxRows = i, m, r }
}
