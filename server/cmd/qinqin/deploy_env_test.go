package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// Every variable the wiki's "Server variables" table (docs/wiki/
// Admin-environment-variables.md) documents for operators must reach the
// container: passed (uncommented) by docker-compose.yml, the single file for
// plain compose and Portainer. The stack variables are read by Compose itself.
func TestDocumentedEnvReachesTheStack(t *testing.T) {
	page := readRepoFile(t, "docs/wiki/Admin-environment-variables.md")
	compose := readRepoFile(t, "docker-compose.yml")
	_, section, ok := strings.Cut(page, "\n## Server variables\n")
	if !ok {
		t.Fatal(`docs/wiki/Admin-environment-variables.md has no "## Server variables" section`)
	}
	section, _, _ = strings.Cut(section, "\n## ")
	rows := regexp.MustCompile("(?m)^\\| `(QINQIN_[A-Z_]+)` \\|").FindAllStringSubmatch(section, -1)
	if len(rows) < 6 {
		t.Fatalf("found %d documented server variables in the wiki table, want at least 6", len(rows))
	}
	for _, m := range rows {
		name := m[1]
		if !regexp.MustCompile("(?m)^\\s+" + name + ":").MatchString(compose) {
			t.Errorf("%s is in the wiki's server variables table but docker-compose.yml does not pass it", name)
		}
	}
	for _, name := range []string{"QINQIN_IMAGE", "QINQIN_PORT", "QINQIN_DATA_VOLUME"} {
		if !strings.Contains(page, "| `"+name+"` |") || !strings.Contains(compose, "${"+name+":-") {
			t.Errorf("stack variable %s must be in the wiki table and used by docker-compose.yml", name)
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

// docker stop sends SIGTERM and kills after the stop grace period. serve
// needs httpGrace for requests in flight plus backgroundGrace for the
// workers (#170); the compose file must allow both with a margin.
func TestComposeAllowsTheShutdown(t *testing.T) {
	compose := readRepoFile(t, "docker-compose.yml")
	// The qinqin service's own block: from "  qinqin:" to the next line at
	// the same or a lower indent.
	block := regexp.MustCompile(`(?ms)^  qinqin:\n(.*?)(?:^\S|^  \S|\z)`).FindStringSubmatch(compose)
	if block == nil {
		t.Fatal("docker-compose.yml has no qinqin service")
	}
	m := regexp.MustCompile(`(?m)^    stop_grace_period:\s*(\d+)s\s*$`).FindStringSubmatch(block[1])
	if m == nil {
		t.Fatal("docker-compose.yml sets no stop_grace_period (Docker's default 10 s kills serve mid-shutdown)")
	}
	var secs int
	for _, c := range m[1] {
		secs = secs*10 + int(c-'0')
	}
	if need := int((httpGrace + backgroundGrace).Seconds()) + 5; secs < need {
		t.Errorf("stop_grace_period %ds, want at least %ds", secs, need)
	}
}
