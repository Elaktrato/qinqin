package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// Every variable the README's environment table documents for operators
// must reach the container: passed by the Portainer stack and offered
// (commented or not) in docker-compose.yml.
func TestDocumentedEnvReachesTheStack(t *testing.T) {
	readme := readRepoFile(t, "README.md")
	stack := readRepoFile(t, "deploy/portainer-stack.yml")
	compose := readRepoFile(t, "docker-compose.yml")
	rows := regexp.MustCompile("(?m)^\\| `(QINQIN_[A-Z_]+)` \\|").FindAllStringSubmatch(readme, -1)
	if len(rows) < 6 {
		t.Fatalf("found %d documented variables in the README table, want at least 6", len(rows))
	}
	for _, m := range rows {
		name := m[1]
		if !regexp.MustCompile("(?m)^\\s+" + name + ":").MatchString(stack) {
			t.Errorf("%s is in the README table but deploy/portainer-stack.yml does not pass it", name)
		}
		if !strings.Contains(compose, name+":") {
			t.Errorf("%s is in the README table but docker-compose.yml does not offer it", name)
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
