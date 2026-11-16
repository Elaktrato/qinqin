package auth_test

import (
	"errors"
	"testing"

	"qinqin/internal/auth"
)

func TestNormalizeEmailIDNA(t *testing.T) {
	d1, n1, err1 := auth.NormalizeEmail("Anna@bücher.de")
	d2, n2, err2 := auth.NormalizeEmail("anna@XN--BCHER-KVA.de")
	if err1 != nil || err2 != nil {
		t.Fatalf("errors: %v %v", err1, err2)
	}
	if n1 != n2 || n1 != "anna@xn--bcher-kva.de" {
		t.Errorf("norm %q vs %q: the two spellings of one domain must collide", n1, n2)
	}
	if d1 != "Anna@xn--bcher-kva.de" || d2 != "anna@xn--bcher-kva.de" {
		t.Errorf("display forms %q %q: stored ASCII only", d1, d2)
	}
}

func TestNormalizeEmailRejectsNonASCIILocalParts(t *testing.T) {
	_, _, err := auth.NormalizeEmail("jörg@example.org")
	if !errors.Is(err, auth.ErrInvalidEmail) || !errors.Is(err, auth.ErrEmailLocalNotASCII) {
		t.Errorf("err = %v, want the non-ASCII local part refusal", err)
	}
	for _, bad := range []string{"a@b", "a@b..de", "a b@example.org", "a@@example.org", "<a@example.org>", "A <a@example.org>", "a@exa mple.org", ""} {
		if _, _, err := auth.NormalizeEmail(bad); !errors.Is(err, auth.ErrInvalidEmail) {
			t.Errorf("%q accepted (%v)", bad, err)
		}
	}
	if _, _, err := auth.NormalizeEmail("a@​example.org"); err == nil {
		t.Error("a zero-width space in the domain was accepted")
	}
}
