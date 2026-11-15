package plugins

import (
	"errors"
	"testing"
)

// TestDataPluginReturnsMarshalError: a manifest that cannot be encoded is
// an error the listing returns, not a panic.
func TestDataPluginReturnsMarshalError(t *testing.T) {
	orig := marshalManifest
	t.Cleanup(func() { marshalManifest = orig })
	boom := errors.New("boom")
	marshalManifest = func(any) ([]byte, error) { return nil, boom }

	if _, err := dataPlugin(dataManifest{ID: "x"}); !errors.Is(err, boom) {
		t.Errorf("dataPlugin err = %v, want the marshal error", err)
	}
}
