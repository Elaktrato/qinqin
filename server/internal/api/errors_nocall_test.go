package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"qinqin/internal/journal"
	"qinqin/internal/sentences"
)

// A provider call that ends before the provider is called wraps its cause
// beside errNoProviderCall (fmt.Errorf with two %w); the answer is the
// cause's, never a 500 (#186; the same path of the conversation turn, #185).
func TestNoProviderCallAnswersItsCause(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	cases := []struct {
		name   string
		answer func(http.ResponseWriter, *http.Request, error)
		cause  error
		status int
	}{
		{"turn: conversation gone", answerTurnError, journal.ErrNotFound, 404},
		{"turn: conversation full", answerTurnError, journal.ErrConversationFull, 409},
		{"examples: at the cap", answerExamplesError, sentences.ErrExamplesFull, 409},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		c.answer(rec, req, fmt.Errorf("%w: %w", errNoProviderCall, c.cause))
		if rec.Code != c.status {
			t.Errorf("%s: %d, want %d", c.name, rec.Code, c.status)
		}
	}
}
