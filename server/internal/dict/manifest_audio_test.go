package dict_test

import (
	"strings"
	"testing"

	"qinqin/internal/dict"
)

func TestManifestAcceptsAudioPacks(t *testing.T) {
	m := fixtureManifest
	m.Type, m.Format = dict.TypeAudio, dict.FormatAudioIndex
	if err := m.Validate(); err != nil {
		t.Errorf("audio/audio-index: Validate = %v, want nil", err)
	}
	m.Type = "nope"
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "audio") {
		t.Errorf("unknown type error = %v, want it to list audio", err)
	}
	m = fixtureManifest
	m.Type, m.Format = dict.TypeAudio, "nope"
	if err := m.Validate(); err == nil || !strings.Contains(err.Error(), "audio-index") {
		t.Errorf("unknown format error = %v, want it to list audio-index", err)
	}
}
