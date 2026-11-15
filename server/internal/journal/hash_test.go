package journal_test

import (
	"testing"

	"qinqin/internal/journal"
)

// The vectors are shared with the web's textHash.test.ts.
func TestTextHashVectors(t *testing.T) {
	for in, want := range map[string]string{
		"":               "fnv1a64:cbf29ce484222325",
		"a":              "fnv1a64:af63dc4c8601ec8c",
		"我今天去学校了。":       "fnv1a64:64861151b3ea2999",
		"日本語を勉強します\n二行目": "fnv1a64:b58bf112206ab312",
	} {
		if got := journal.TextHash(in); got != want {
			t.Errorf("TextHash(%q) = %s, want %s", in, got, want)
		}
	}
}
