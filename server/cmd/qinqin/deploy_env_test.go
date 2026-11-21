package main

import (
	"os"
	"regexp"
	"testing"
)

// Every variable the README's environment table documents for operators
// must reach the container: passed (uncommented) by docker-compose.yml,
// the single file for plain compose and Portainer.
func TestDocumentedEnvReachesTheStack(t *testing.T) {
	readme := readRepoFile(t, "README.md")
	compose := readRepoFile(t, "docker-compose.yml")
	rows := regexp.MustCompile("(?m)^\\| `(QINQIN_[A-Z_]+)` \\|").FindAllStringSubmatch(readme, -1)
	if len(rows) < 6 {
		t.Fatalf("found %d documented variables in the README table, want at least 6", len(rows))
	}
	for _, m := range rows {
		name := m[1]
		if !regexp.MustCompile("(?m)^\\s+" + name + ":").MatchString(compose) {
			t.Errorf("%s is in the README table but docker-compose.yml does not pass it", name)
		}
	}
}

func readRepoFile(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile("../../../" + rel)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
