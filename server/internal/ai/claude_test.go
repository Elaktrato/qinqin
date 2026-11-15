package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2/option"
)

const claudeTestKey = "sk-ant-test-SECRETKEY9999"

type captured struct {
	method, path string
	header       http.Header
	body         map[string]any
}

// serve answers every request with status and the testdata file (or raw
// body), records the last request and counts attempts. No real network.
func serve(t *testing.T, status int, file string, hdr map[string]string) (*Claude, *captured, *atomic.Int32) {
	t.Helper()
	var body []byte
	if strings.HasPrefix(file, "{") {
		body = []byte(file)
	} else if file != "" {
		b, err := os.ReadFile("testdata/claude/" + file + ".json")
		if err != nil {
			t.Fatal(err)
		}
		body = b
	}
	got := &captured{}
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		got.method, got.path, got.header = r.Method, r.URL.Path, r.Header.Clone()
		raw, _ := io.ReadAll(r.Body)
		got.body = nil
		_ = json.Unmarshal(raw, &got.body)
		for k, v := range hdr {
			w.Header().Set(k, v)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)
	return NewClaude(option.WithBaseURL(srv.URL)), got, &n
}

func creds(model string) Credentials { return Credentials{APIKey: claudeTestKey, Model: model} }

func sub(t *testing.T, m map[string]any, path ...string) map[string]any {
	t.Helper()
	for _, p := range path {
		next, ok := m[p].(map[string]any)
		if !ok {
			t.Fatalf("missing object %q in %v", p, m)
		}
		m = next
	}
	return m
}

func TestClaudeReviewRequestShape(t *testing.T) {
	c, got, _ := serve(t, 200, "review_ok", nil)
	_, err := c.Review(context.Background(), creds("claude-opus-5-5"), ReviewRequest{Language: "zh", ExplanationLanguage: "en", Guidance: "strict", Text: "我是很好。"})
	if err != nil {
		t.Fatal(err)
	}
	b := got.body
	if got.method != "POST" || !strings.HasSuffix(got.path, "/v1/messages") {
		t.Fatalf("request %s %s", got.method, got.path)
	}
	if b["model"] != "claude-opus-5-5" || b["max_tokens"] != float64(16000) {
		t.Fatalf("model/max_tokens: %v %v", b["model"], b["max_tokens"])
	}
	oc := sub(t, b, "output_config")
	if oc["effort"] != "medium" {
		t.Fatalf("effort = %v", oc["effort"])
	}
	if f := sub(t, oc, "format"); f["type"] != "json_schema" || f["schema"] == nil {
		t.Fatalf("format = %v", f)
	}
	if b["fallbacks"] != "default" {
		t.Fatalf("fallbacks = %v", b["fallbacks"])
	}
	if !strings.Contains(got.header.Get("anthropic-beta"), "server-side-fallback-2026-07-01") {
		t.Fatalf("anthropic-beta = %q", got.header.Get("anthropic-beta"))
	}
	for _, k := range []string{"thinking", "temperature", "top_p", "top_k", "tool_choice", "tools"} {
		if _, ok := b[k]; ok {
			t.Errorf("request must not carry %q", k)
		}
	}
	sys := b["system"].([]any)[0].(map[string]any)
	if sub(t, sys, "cache_control")["type"] != "ephemeral" || sys["text"] != reviewSystemPrompt {
		t.Fatalf("system block = %v", sys)
	}
	// SDK v2.9.0 WithAPIKey sends the key as a bearer token (option/requestoption.go).
	if got.header.Get("Authorization") != "Bearer "+claudeTestKey {
		t.Fatal("authorization header missing")
	}
	user := b["messages"].([]any)[0].(map[string]any)
	if user["role"] != "user" {
		t.Fatalf("role = %v", user["role"])
	}
	text := user["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "<entry_") || !strings.Contains(text, "我是很好。") || !strings.Contains(text, "<preferences_") {
		t.Fatalf("user text = %s", text)
	}
}

func TestClaudeSonnetFallsBackHaikuDoesNot(t *testing.T) {
	for model, want := range map[string]bool{"claude-sonnet-5-5": true, "claude-haiku-5-5": false} {
		c, got, _ := serve(t, 200, "review_ok", nil)
		if _, err := c.Review(context.Background(), creds(model), ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "x"}); err != nil {
			t.Fatal(err)
		}
		_, has := got.body["fallbacks"]
		beta := strings.Contains(got.header.Get("anthropic-beta"), "server-side-fallback")
		if has != want || beta != want || got.body["model"] != model {
			t.Errorf("%s: fallbacks=%v beta=%v", model, has, beta)
		}
	}
}

func TestClaudeReviewParses(t *testing.T) {
	c, _, _ := serve(t, 200, "review_ok", nil)
	r, err := c.Review(context.Background(), creds("claude-opus-5-5"), ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "我是很好。"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Annotations) != 2 || r.Annotations[1].Quote != "很好" || r.Annotations[1].ContextBefore != "天气" || r.Annotations[1].Category != "word choice" {
		t.Fatalf("annotations = %+v", r.Annotations)
	}
	if r.Overall.Summary != "Good start." || len(r.Overall.Strengths) != 1 || len(r.Overall.Focus) != 1 {
		t.Fatalf("overall = %+v", r.Overall)
	}
	if r.Model != "claude-opus-5-5" || r.Usage.InputTokens != 123 || r.Usage.OutputTokens != 45 || r.Usage.CacheReadTokens != 7 {
		t.Fatalf("model/usage = %q %+v", r.Model, r.Usage)
	}
}

func TestClaudeReviewFallbackUsesLastTextBlock(t *testing.T) {
	c, _, _ := serve(t, 200, "review_fallback", nil)
	r, err := c.Review(context.Background(), creds("claude-opus-5-5"), ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if r.Model != "claude-opus-5" || len(r.Annotations) != 2 {
		t.Fatalf("model=%q annotations=%d", r.Model, len(r.Annotations))
	}
}

func TestClaudeRefusalAndTruncation(t *testing.T) {
	for file, want := range map[string]error{"review_refusal": ErrRefused, "review_max_tokens": ErrTruncated, "bad_json": ErrBadReply} {
		c, _, _ := serve(t, 200, file, nil)
		_, err := c.Review(context.Background(), creds("claude-opus-5-5"), ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "x"})
		if !errors.Is(err, want) {
			t.Errorf("%s: err = %v, want %v", file, err, want)
		}
	}
}

func TestClaudeErrorMapping(t *testing.T) {
	const body = `{"type":"error","error":{"type":"%s","message":"detail echoing ` + claudeTestKey + `"},"request_id":"req_01"}`
	cases := []struct {
		status int
		typ    string
		hdr    map[string]string
		want   error
		after  time.Duration
	}{
		{401, "authentication_error", nil, ErrKeyRejected, 0},
		{403, "permission_error", nil, ErrKeyRejected, 0},
		{402, "billing_error", nil, ErrQuota, 0},
		{404, "not_found_error", nil, ErrModelUnavailable, 0},
		{429, "rate_limit_error", map[string]string{"retry-after": "12"}, ErrBusy, 12 * time.Second},
		{500, "api_error", nil, ErrBusy, 30 * time.Second},
		{529, "overloaded_error", nil, ErrBusy, 30 * time.Second},
		{400, "invalid_request_error", nil, ErrBadRequest, 0},
		{413, "request_too_large", nil, ErrBadRequest, 0},
	}
	for _, tc := range cases {
		c, _, _ := serve(t, tc.status, strings.Replace(body, "%s", tc.typ, 1), tc.hdr)
		c.extra = append(c.extra, option.WithMaxRetries(0))
		_, err := c.Review(context.Background(), creds("claude-opus-5-5"), ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "x"})
		if !errors.Is(err, tc.want) {
			t.Errorf("%d: err = %v, want %v", tc.status, err, tc.want)
			continue
		}
		if strings.Contains(err.Error(), claudeTestKey) || strings.Contains(err.Error(), "SECRETKEY") {
			t.Errorf("%d: error leaks the key: %v", tc.status, err)
		}
		var be *BusyError
		if tc.after != 0 && (!errors.As(err, &be) || be.RetryAfter != tc.after) {
			t.Errorf("%d: RetryAfter = %v, want %v", tc.status, be, tc.after)
		}
	}
}

func TestClaudeRetriesOnce(t *testing.T) {
	c, _, n := serve(t, 500, `{"type":"error","error":{"type":"api_error","message":"x"}}`, nil)
	_, err := c.Review(context.Background(), creds("claude-opus-5-5"), ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "x"})
	if !errors.Is(err, ErrBusy) {
		t.Fatalf("err = %v", err)
	}
	if n.Load() != 2 {
		t.Fatalf("attempts = %d, want 2 (MaxRetries 1)", n.Load())
	}
}

func TestClaudeTransportErrorIsBusy(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	c := NewClaude(option.WithBaseURL(url), option.WithMaxRetries(0))
	_, err := c.Review(context.Background(), creds("claude-opus-5-5"), ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "x"})
	var be *BusyError
	if !errors.As(err, &be) || strings.Contains(err.Error(), claudeTestKey) {
		t.Fatalf("err = %v", err)
	}
}

func TestClaudeValidateUsesModelsGet(t *testing.T) {
	c, got, _ := serve(t, 200, `{"id":"claude-opus-5-5","type":"model","display_name":"Claude Opus 5.5","created_at":"2026-01-01T00:00:00Z"}`, nil)
	if err := c.Validate(context.Background(), creds("claude-opus-5-5")); err != nil {
		t.Fatal(err)
	}
	if got.method != "GET" || !strings.HasSuffix(got.path, "/v1/models/claude-opus-5-5") {
		t.Fatalf("request %s %s", got.method, got.path)
	}
	c, _, _ = serve(t, 401, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`, nil)
	c.extra = append(c.extra, option.WithMaxRetries(0))
	if err := c.Validate(context.Background(), creds("claude-opus-5-5")); !errors.Is(err, ErrKeyRejected) {
		t.Fatalf("err = %v", err)
	}
}

func TestClaudeTranscribeSendsImage(t *testing.T) {
	c, got, _ := serve(t, 200, "transcribe_ok", nil)
	r, err := c.Transcribe(context.Background(), creds("claude-opus-5-5"), TranscribeRequest{Language: "zh", Image: []byte("\xff\xd8jpegbytes"), MediaType: "image/jpeg"})
	if err != nil {
		t.Fatal(err)
	}
	if r.Text != "今天天气很好。" || r.Unreadable {
		t.Fatalf("reply = %+v", r)
	}
	if got.body["max_tokens"] != float64(8000) || sub(t, got.body, "output_config")["effort"] != "medium" {
		t.Fatalf("max_tokens/effort: %v", got.body)
	}
	content := got.body["messages"].([]any)[0].(map[string]any)["content"].([]any)
	img, txt := content[0].(map[string]any), content[1].(map[string]any)
	src := sub(t, img, "source")
	if img["type"] != "image" || src["type"] != "base64" || src["media_type"] != "image/jpeg" || src["data"] == "" || txt["type"] != "text" {
		t.Fatalf("content = %v", content)
	}
	c, _, _ = serve(t, 200, "transcribe_unreadable", nil)
	r, err = c.Transcribe(context.Background(), creds("claude-opus-5-5"), TranscribeRequest{Language: "zh", Image: []byte("x"), MediaType: "image/jpeg"})
	if err != nil || !r.Unreadable {
		t.Fatalf("unreadable: %+v %v", r, err)
	}
}

func TestClaudeSuggestEffortLow(t *testing.T) {
	c, got, _ := serve(t, 200, "suggest_ok", nil)
	r, err := c.Suggest(context.Background(), creds("claude-opus-5-5"), SuggestRequest{Language: "zh", ExplanationLanguage: "en", Words: []string{"周末"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Items) != 1 || r.Items[0].Title != "我的周末" || r.Items[0].Words[0] != "周末" {
		t.Fatalf("items = %+v", r.Items)
	}
	if got.body["max_tokens"] != float64(4000) || sub(t, got.body, "output_config")["effort"] != "low" {
		t.Fatalf("max_tokens/effort: %v", got.body)
	}
}
