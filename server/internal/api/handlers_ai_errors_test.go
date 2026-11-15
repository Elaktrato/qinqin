package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"qinqin/internal/ai"
)

func TestWriteAIErrorTable(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
		retry  string
	}{
		{ai.ErrNoKey, 409, "no_key", ""},
		{ai.ErrKeyUndecryptable, 409, "key_undecryptable", ""},
		{ai.ErrInFlight, 409, "in_flight", ""},
		{ai.ErrNoSelection, 409, "no_selection", ""},
		{ai.ErrProviderDisabled, 409, "provider_disabled", ""},
		{ai.ErrUnknownProvider, 404, "unknown_provider", ""},
		{fmt.Errorf("x: %w", ai.ErrEndpointBlocked), 422, "endpoint_blocked", ""},
		{errNoVision("deepseek-v4-pro", "DeepSeek"), 409, "no_vision", ""},
		{errForbidden, 403, "forbidden", ""},
		{errInvalidEndpoint("name is taken"), 422, "invalid_endpoint", ""},
		{errAIDisabled("no_secret"), 409, "ai_disabled", ""},
		{&ai.RateLimitedError{RetryAfter: 90 * time.Second}, 429, "rate_limited", "90"},
		{&ai.BusyError{RetryAfter: 12 * time.Second}, 503, "busy", "12"},
		{errTooLong, 413, "too_long", ""},
		{ai.ErrKeyRejected, 422, "key_rejected", ""},
		{fmt.Errorf("wrapped: %w", ai.ErrQuota), 422, "quota", ""},
		{ai.ErrRefused, 422, "refused", ""},
		{ai.ErrTruncated, 422, "truncated", ""},
		{ai.ErrBadReply, 422, "bad_reply", ""},
		{ai.ErrBadRequest, 422, "bad_request", ""},
		{ai.ErrModelUnavailable, 422, "model_unavailable", ""},
		{errInvalidModel, 422, "invalid_model", ""},
		{errors.New("boom"), 500, "", ""},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		writeAIError(rec, tc.err)
		if rec.Code != tc.status || rec.Code == http.StatusUnauthorized {
			t.Errorf("%v: status %d, want %d", tc.err, rec.Code, tc.status)
		}
		if tc.retry != "" && rec.Header().Get("Retry-After") != tc.retry {
			t.Errorf("%v: Retry-After %q, want %q", tc.err, rec.Header().Get("Retry-After"), tc.retry)
		}
		if tc.code != "" {
			var e struct{ Error, Message string }
			if err := json.Unmarshal(rec.Body.Bytes(), &e); err != nil || e.Error != tc.code || e.Message == "" {
				t.Errorf("%v: body %s", tc.err, rec.Body.String())
			}
		}
	}
}
