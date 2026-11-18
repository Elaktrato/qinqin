package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// ErrNeedsRepair marks a reply that failed strict decoding; the adapter turns
// it into one repair request and, when that fails too, into ErrBadReply.
type ErrNeedsRepair struct {
	Bad string
	Err error
}

func (e *ErrNeedsRepair) Error() string { return "ai: reply needs repair: " + e.Err.Error() }
func (e *ErrNeedsRepair) Unwrap() error { return e.Err }

// stripFence removes one surrounding ``` or ```json fence.
func stripFence(s string) string {
	if !strings.HasPrefix(s, "```") || !strings.HasSuffix(s, "```") || len(s) < 6 {
		return s
	}
	inner := strings.TrimSuffix(strings.TrimPrefix(s, "```"), "```")
	inner = strings.TrimPrefix(inner, "json")
	return strings.TrimSpace(inner)
}

// decodeStrict decodes one JSON object into dst: no unknown fields, no
// trailing data, every required top-level key present and not null. It trims
// whitespace and one markdown fence; whitespace-only text is an error.
func decodeStrict(text string, dst any, required []string) error {
	s := stripFence(strings.TrimSpace(text))
	if s == "" {
		return errors.New("empty reply")
	}
	var keys map[string]json.RawMessage
	if err := json.Unmarshal([]byte(s), &keys); err != nil {
		return fmt.Errorf("not a JSON object: %v", err)
	}
	for _, k := range required {
		v, ok := keys[k]
		if !ok {
			return fmt.Errorf("missing field %q", k)
		}
		if bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
			return fmt.Errorf("field %q is null", k)
		}
	}
	dec := json.NewDecoder(strings.NewReader(s))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return errors.New("data after the JSON object")
	}
	return nil
}

// repairMessage asks for a corrected reply: up to 2,000 characters of the bad
// output and the decode error's words.
func repairMessage(bad string, err error) string {
	r := []rune(bad)
	if len(r) > 2000 {
		r = r[:2000]
	}
	return "Your previous reply could not be used (" + err.Error() + "). Reply again with only the JSON object that matches the schema: no markdown fence, no other text, no extra fields.\n\nPrevious reply:\n" + string(r)
}

// Wire shapes shared by the JSON-text adapters; they mirror the schemas.
type reviewWire struct {
	Annotations []struct {
		Quote         string `json:"quote"`
		ContextBefore string `json:"context_before"`
		Correction    string `json:"correction"`
		Explanation   string `json:"explanation"`
		Category      string `json:"category"`
		Kind          string `json:"kind"`
	} `json:"annotations"`
	Overall Overall `json:"overall"`
}

type suggestWire struct {
	Items []SuggestionItem `json:"items"`
}

type transcribeWire struct {
	Text       string `json:"text"`
	Unreadable bool   `json:"unreadable"`
}
