package lemma_test

import (
	"slices"
	"testing"

	"qinqin/internal/lemma"
)

func TestBuiltinTables(t *testing.T) {
	if got := lemma.Languages(); !slices.Contains(got, "ja") {
		t.Fatalf("Languages() = %v, want ja", got)
	}
	ja := lemma.For("JA")
	if ja == nil || ja.Language != "ja" || len(ja.Rules) == 0 {
		t.Fatalf("For(JA) = %+v", ja)
	}
	if lemma.For("zz") != nil {
		t.Error("For(zz) != nil")
	}
	raw, err := lemma.BuiltinFile("ja")
	if err != nil || len(raw) == 0 {
		t.Fatalf("BuiltinFile(ja) = %d bytes, %v", len(raw), err)
	}
}

func TestRegister(t *testing.T) {
	tb := parse(t, toyTable)
	lemma.Register(tb)
	if lemma.For("xx") != tb || !slices.Contains(lemma.Languages(), "xx") {
		t.Errorf("registered table not found")
	}
}
