package api_test

import (
	"encoding/json"
	"testing"
)

// errorText renders a {error, message} body as "code: message" and any
// other body as it is, so a test can check the code and the wording.
func errorText(body []byte) string {
	var e struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &e); err != nil || e.Error == "" {
		return string(body)
	}
	return e.Error + ": " + e.Message
}

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
