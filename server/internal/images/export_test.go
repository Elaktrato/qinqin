package images

import "testing"

// SetMaxReportsForTest lowers MaxReportsPerUser for one test.
func SetMaxReportsForTest(t *testing.T, n int) {
	old := MaxReportsPerUser
	MaxReportsPerUser = n
	t.Cleanup(func() { MaxReportsPerUser = old })
}
