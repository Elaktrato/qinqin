package pack

import (
	"encoding/json"
	"os"
	"testing"
)

// noticeVectors are shared with scripts/check-sources.test.mjs: the
// repository check mirrors this validator, and both must agree on every
// vector.
const noticeVectors = "../../../scripts/testdata/notice-vectors.json"

// TestNoticeVectors runs the shared vectors through the manifest path
// (normalize, then Validate), as a pack load does.
func TestNoticeVectors(t *testing.T) {
	data, err := os.ReadFile(noticeVectors)
	if err != nil {
		t.Fatal(err)
	}
	var vectors []struct {
		Name   string `json:"name"`
		Notice string `json:"notice"`
		OK     bool   `json:"ok"`
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, v := range vectors {
		m := Manifest{ID: "x", Name: "x", Version: "1", Type: TypeLevels, Language: "zh",
			License: "L", Attribution: "A", Format: FormatJSON, Notice: v.Notice}
		m.Normalize()
		err := m.Validate()
		if (err == nil) != v.OK {
			t.Errorf("%s: Validate = %v, want ok=%v", v.Name, err, v.OK)
		}
	}
}
