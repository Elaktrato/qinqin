package update

import "testing"

func TestParseVersion(t *testing.T) {
	for _, ok := range []string{"1.2.3", "v1.2.3", "0.7.0-rc1", "1.0.0-alpha.1", "1.0.0+build.5", "v10.20.30-rc.2+x"} {
		if _, err := ParseVersion(ok); err != nil {
			t.Errorf("ParseVersion(%q) = %v, want ok", ok, err)
		}
	}
	for _, bad := range []string{"", "dev", "1.2", "1.2.3.4", "01.2.3", "1.2.3-", "1.2.3-01", "a.b.c", "1.2.x", "1.0.0-a..b"} {
		if _, err := ParseVersion(bad); err == nil {
			t.Errorf("ParseVersion(%q) parsed, want an error", bad)
		}
	}
}

func TestCompareVersions(t *testing.T) {
	// The precedence chain of semver.org 2.0.0, item 11, then the cases around it.
	chain := []string{"1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0", "10.0.0"}
	for i := range chain {
		for j := range chain {
			a, _ := ParseVersion(chain[i])
			b, _ := ParseVersion(chain[j])
			want := 0
			if i < j {
				want = -1
			} else if i > j {
				want = 1
			}
			if got := a.Compare(b); got != want {
				t.Errorf("Compare(%s, %s) = %d, want %d", chain[i], chain[j], got, want)
			}
		}
	}
	a, _ := ParseVersion("v1.2.3+one")
	b, _ := ParseVersion("1.2.3+two")
	if a.Compare(b) != 0 {
		t.Error("build metadata must not matter")
	}
	if !(Version{}).IsZero() || a.IsZero() {
		t.Error("IsZero")
	}
	if got := a.String(); got != "1.2.3" {
		t.Errorf("String = %q, want 1.2.3", got)
	}
	pre, _ := ParseVersion("v0.7.0-rc1")
	if !pre.Prerelease() || pre.String() != "0.7.0-rc1" {
		t.Errorf("prerelease = %v %q", pre.Prerelease(), pre.String())
	}
}
