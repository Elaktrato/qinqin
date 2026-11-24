package workspaces

import "testing"

// TestARuleKeepsExactlyWhenItDeletesNothing: a rule either deletes the
// workspace's rows or keeps them with a reason, never both and never
// neither.
func TestARuleKeepsExactlyWhenItDeletesNothing(t *testing.T) {
	for _, r := range rules() {
		if (r.Keep == "") == (r.del == nil) {
			t.Errorf("rule %s: Keep %q with a delete statement %v: want a reason exactly when it deletes nothing", r.Table, r.Keep, r.del != nil)
		}
	}
}
