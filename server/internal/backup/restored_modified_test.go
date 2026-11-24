package backup

import "testing"

// Review fix (phase A, 9): the edit time a restored typed row keeps is
// clamped to the restore time. An archive edited by hand (or written on a
// server with a clock far ahead) must not carry an edit time in the future,
// which would make the row win every later last-write-wins comparison.
func TestRestoredModifiedIsClampedToTheRestoreTime(t *testing.T) {
	now := "2026-11-16T12:30:00Z"
	future, past, bad := "2099-01-01T00:00:00Z", "2026-11-10T08:00:00.750Z", "yesterday"
	for _, c := range []struct {
		name     string
		modified *string
		updated  string
		want     string
	}{
		{"a past edit time is kept (seconds)", &past, "2026-11-12T00:00:00Z", "2026-11-10T08:00:00Z"},
		{"an edit time in the future is the restore time", &future, "2026-11-12T00:00:00Z", now},
		{"no edit time: the updatedAt, clamped too", nil, future, now},
		{"unreadable stamps: the restore time", &bad, "never", now},
	} {
		if got := restoredModified(Row{ModifiedAt: c.modified, UpdatedAt: c.updated}, now); got != c.want {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}
}
