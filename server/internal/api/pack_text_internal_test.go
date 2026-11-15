package api

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"qinqin/internal/dict"
)

func TestPackErrorTextReplacesOnlyFullPathPrefixes(t *testing.T) {
	err := fmt.Errorf("%w: read /srv/data/packs/.stage-abc/manifest.json of /srv/data: license is required (see /srv/database and /srv/data.txt)", dict.ErrInvalidPack)
	got := packErrorText(err, "/srv/data/packs/.stage-abc", "/srv/data")
	if strings.Contains(got, "/srv/data/") || strings.Contains(got, ".stage-abc") {
		t.Errorf("path leaked: %q", got)
	}
	if !strings.Contains(got, "/srv/database") || !strings.Contains(got, "/srv/data.txt") {
		t.Errorf("a longer name that merely starts with the data dir was mangled: %q", got)
	}
	if !errors.Is(err, dict.ErrInvalidPack) {
		t.Fatal("setup")
	}
}
