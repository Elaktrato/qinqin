package api_test

import (
	"encoding/json"
	"testing"
)

// errorCode returns the error code of a {error, message} body ("" when the
// body is not one), so tests compare codes, never message wording.
func errorCode(t *testing.T, body []byte) string {
	t.Helper()
	var e struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &e); err != nil || e.Message == "" {
		return ""
	}
	return e.Error
}
