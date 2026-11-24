package pack_test

import (
	"errors"
	"fmt"
	"testing"

	"qinqin/internal/pack"
)

// A domain package's not-found error keeps its own text and its own
// identity, and is a pack.ErrNotFound (#192).
func TestNotFoundIsErrNotFound(t *testing.T) {
	a, b := pack.NotFound("level scheme not found"), pack.NotFound("level scheme not found")
	if a.Error() != "level scheme not found" {
		t.Errorf("text %q", a.Error())
	}
	if !errors.Is(a, pack.ErrNotFound) || !errors.Is(fmt.Errorf("uninstall: %w", a), pack.ErrNotFound) {
		t.Error("not a pack.ErrNotFound")
	}
	if !errors.Is(fmt.Errorf("x: %w", a), a) || errors.Is(a, b) || errors.Is(pack.ErrNotFound, a) {
		t.Error("two not-found errors must stay distinct")
	}
	if errors.Is(errors.New("level scheme not found"), pack.ErrNotFound) {
		t.Error("an unrelated error is a pack.ErrNotFound")
	}
}
