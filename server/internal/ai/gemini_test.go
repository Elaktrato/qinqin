package ai

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func gemReply(text, finish string) string {
	return `{"candidates":[{"content":{"role":"model","parts":[{"text":` + mustJSON(text) + `}]},"finishReason":"` + finish + `"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5},"modelVersion":"gem-served-1"}`
}

func gemRig(t *testing.T, h func(n int, w http.ResponseWriter, r *http.Request, rec seenReq)) (*Gemini, *oaRig, Credentials) {
	t.Helper()
	rig := newOARig(t, h)
	g := &Gemini{HTTP: NewBuiltinClient(nil), BaseURL: rig.srv.URL + "/v1beta"}
	return g, rig, Credentials{APIKey: oaKey, Model: "gemini-3.8-flash", Provider: "gemini"}
}

func TestGeminiRequestShape(t *testing.T) {
	var rawQuery string
	g, rig, cr := gemRig(t, func(n int, w http.ResponseWriter, r *http.Request, rec seenReq) {
		rawQuery = r.URL.RawQuery
		if strings.Contains(string(rec.Raw), "inlineData") {
			writeJSON200(w, gemReply(goodTrans, "STOP"))
			return
		}
		writeJSON200(w, gemReply(goodReview, "STOP"))
	})
	rep, err := g.Review(context.Background(), cr, reviewReq())
	if err != nil {
		t.Fatal(err)
	}
	r := rig.requests()[0]
	if r.Method != "POST" || r.Path != "/v1beta/models/gemini-3.8-flash:generateContent" {
		t.Errorf("%s %s", r.Method, r.Path)
	}
	if r.Auth != oaKey {
		t.Errorf("x-goog-api-key = %q", r.Auth)
	}
	if rawQuery != "" || strings.Contains(r.Path, oaKey) {
		t.Errorf("key in URL: %q %q", rawQuery, r.Path)
	}
	si := r.Body["systemInstruction"].(map[string]any)["parts"].([]any)[0].(map[string]any)["text"]
	if si != reviewSystemPrompt {
		t.Error("system instruction differs from the shared prompt")
	}
	gc := r.Body["generationConfig"].(map[string]any)
	if gc["responseMimeType"] != "application/json" || gc["maxOutputTokens"] != float64(16000) || gc["responseJsonSchema"] == nil {
		t.Errorf("generationConfig = %v", gc)
	}
	schema := gc["responseJsonSchema"].(map[string]any)
	if schema["type"] != "object" || schema["additionalProperties"] != false {
		t.Errorf("schema = %v", schema)
	}
	contents := r.Body["contents"].([]any)
	if len(contents) != 1 {
		t.Fatalf("contents = %v", contents)
	}
	parts := contents[0].(map[string]any)["parts"].([]any)
	if contents[0].(map[string]any)["role"] != "user" || len(parts) != 1 || strings.Contains(string(r.Raw), "inlineData") {
		t.Errorf("review parts = %v", parts)
	}
	if rep.Model != "gem-served-1" || rep.Usage.InputTokens != 10 || len(rep.Calls) != 1 {
		t.Errorf("reply = %+v", rep)
	}
	tr, err := g.Transcribe(context.Background(), cr, TranscribeRequest{Language: "zh", Image: []byte("\xff\xd8x"), MediaType: "image/jpeg"})
	if err != nil || tr.Text != "你好" {
		t.Fatalf("transcribe = %+v, %v", tr, err)
	}
	parts = rig.requests()[1].Body["contents"].([]any)[0].(map[string]any)["parts"].([]any)
	inl, _ := parts[0].(map[string]any)["inlineData"].(map[string]any)
	if len(parts) != 2 || inl["mimeType"] != "image/jpeg" || inl["data"] == "" {
		t.Errorf("transcribe parts = %v", parts)
	}
	if rig.requests()[1].Body["generationConfig"].(map[string]any)["maxOutputTokens"] != float64(8000) {
		t.Error("transcribe budget")
	}
	if _, err := g.Transcribe(context.Background(), cr, TranscribeRequest{Image: []byte("x"), MediaType: "image/png"}); !errors.Is(err, ErrBadRequest) {
		t.Errorf("png = %v", err)
	}
	if _, err := g.Suggest(context.Background(), cr, SuggestRequest{Language: "zh"}); !errors.Is(err, ErrBadReply) {
		t.Errorf("suggest with a review-shaped reply = %v, want ErrBadReply", err)
	}
}

func TestGeminiReplyMapping(t *testing.T) {
	fx, _ := os.ReadFile("testdata/gemini/generate_review.json")
	g, _, cr := gemRig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) { writeJSON200(w, string(fx)) })
	rep, err := g.Review(context.Background(), cr, reviewReq())
	if err != nil || len(rep.Annotations) != 1 || rep.Overall.Summary != "Good." || rep.Model != "gemini-3.8-flash-001" {
		t.Fatalf("fixture = %+v, %v", rep, err)
	}
	if rep.Usage.CacheReadTokens != 100 || rep.Usage.InputTokens != 20 || rep.Usage.OutputTokens != 40 {
		t.Errorf("usage = %+v", rep.Usage)
	}
	cases := []struct {
		name, body string
		want       error
	}{
		{"max tokens", gemReply(`{"annot`, "MAX_TOKENS"), ErrTruncated},
		{"SAFETY", gemReply("", "SAFETY"), ErrRefused},
		{"RECITATION", gemReply("", "RECITATION"), ErrRefused},
		{"BLOCKLIST", gemReply("", "BLOCKLIST"), ErrRefused},
		{"PROHIBITED_CONTENT", gemReply("", "PROHIBITED_CONTENT"), ErrRefused},
		{"SPII", gemReply("", "SPII"), ErrRefused},
		{"IMAGE_SAFETY", gemReply("", "IMAGE_SAFETY"), ErrRefused},
		{"block reason", `{"promptFeedback":{"blockReason":"PROHIBITED_CONTENT"}}`, ErrRefused},
		{"no candidates", `{"candidates":[]}`, ErrBadReply},
		{"empty object", `{}`, ErrBadReply},
		{"not json", `nope`, ErrBadReply},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g, rig, cr := gemRig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) { writeJSON200(w, c.body) })
			if _, err := g.Review(context.Background(), cr, reviewReq()); !errors.Is(err, c.want) {
				t.Errorf("err = %v, want %v", err, c.want)
			}
			if len(rig.requests()) != 1 {
				t.Errorf("%d requests, want 1", len(rig.requests()))
			}
		})
	}
}

func TestGeminiRepair(t *testing.T) {
	g, rig, cr := gemRig(t, func(n int, w http.ResponseWriter, _ *http.Request, _ seenReq) {
		if n == 1 {
			writeJSON200(w, gemReply("```json\n"+goodReview+"\n```extra", "STOP"))
			return
		}
		writeJSON200(w, gemReply(goodReview, "STOP"))
	})
	rep, err := g.Review(context.Background(), cr, reviewReq())
	if err != nil {
		t.Fatal(err)
	}
	contents := rig.requests()[1].Body["contents"].([]any)
	if len(contents) != 3 || contents[1].(map[string]any)["role"] != "model" || contents[2].(map[string]any)["role"] != "user" {
		t.Errorf("repair contents = %v", contents)
	}
	if len(rep.Calls) != 2 || rep.Calls[1].Kind != "review-repair" {
		t.Errorf("Calls = %+v", rep.Calls)
	}
	g, rig, cr = gemRig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) {
		writeJSON200(w, gemReply("{}", "STOP"))
	})
	rep, err = g.Review(context.Background(), cr, reviewReq())
	if !errors.Is(err, ErrBadReply) || len(rig.requests()) != 2 || len(rep.Calls) != 2 {
		t.Errorf("two bad replies: %v, %d requests, %d calls", err, len(rig.requests()), len(rep.Calls))
	}
}

func TestGeminiErrorMapping(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		hdr    map[string]string
		want   error
		retry  time.Duration
	}{
		{"400 key invalid", 400, `{"error":{"code":400,"status":"INVALID_ARGUMENT","details":[{"@type":"x","reason":"API_KEY_INVALID"}]}}`, nil, ErrKeyRejected, 0},
		{"403", 403, `{"error":{"code":403,"status":"PERMISSION_DENIED"}}`, nil, ErrKeyRejected, 0},
		{"401", 401, ``, nil, ErrKeyRejected, 0},
		{"404", 404, `{"error":{"code":404,"status":"NOT_FOUND"}}`, nil, ErrModelUnavailable, 0},
		{"429", 429, `{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}`, map[string]string{"Retry-After": "9"}, ErrBusy, 9 * time.Second},
		{"500", 500, ``, nil, ErrBusy, defaultRetryAfter},
		{"503", 503, `{"error":{"status":"UNAVAILABLE"}}`, nil, ErrBusy, defaultRetryAfter},
		{"plain 400", 400, `{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"bad schema"}}`, nil, ErrBadRequest, 0},
		{"302", 302, ``, map[string]string{"Location": "http://127.0.0.1:1/"}, ErrBadRequest, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g, rig, cr := gemRig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) {
				for k, v := range c.hdr {
					w.Header().Set(k, v)
				}
				w.WriteHeader(c.status)
				_, _ = io.WriteString(w, c.body)
			})
			_, err := g.Review(context.Background(), cr, reviewReq())
			if !errors.Is(err, c.want) {
				t.Fatalf("err = %v, want %v", err, c.want)
			}
			var be *BusyError
			if c.retry > 0 && (!errors.As(err, &be) || be.RetryAfter != c.retry) {
				t.Errorf("retry = %v", err)
			}
			if len(rig.requests()) != 1 {
				t.Errorf("%d requests", len(rig.requests()))
			}
		})
	}
	g, rig, cr := gemRig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) {})
	rig.srv.Close()
	if _, err := g.Review(context.Background(), cr, reviewReq()); !errors.Is(err, ErrBusy) {
		t.Errorf("refused = %v", err)
	}
}

func TestGeminiModelPathEscape(t *testing.T) {
	g, rig, cr := gemRig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) {
		writeJSON200(w, gemReply(goodReview, "STOP"))
	})
	for _, m := range []string{"../x", "a/b", "models/../x", "x/models/y", "..", "a?b=c", "a#b", "a b", ""} {
		cr.Model = m
		if _, err := g.Review(context.Background(), cr, reviewReq()); !errors.Is(err, ErrBadRequest) {
			t.Errorf("model %q: err = %v, want ErrBadRequest", m, err)
		}
		if err := g.Validate(context.Background(), cr); !errors.Is(err, ErrBadRequest) {
			t.Errorf("validate model %q: err = %v", m, err)
		}
	}
	if n := len(rig.requests()); n != 0 {
		t.Errorf("%d requests were sent for rejected models", n)
	}
	cr.Model = "models/gemini-3.8-flash"
	if _, err := g.Review(context.Background(), cr, reviewReq()); err != nil {
		t.Fatal(err)
	}
	if p := rig.requests()[0].Path; p != "/v1beta/models/gemini-3.8-flash:generateContent" {
		t.Errorf("path = %q", p)
	}
}

func TestGeminiValidate(t *testing.T) {
	g, rig, cr := gemRig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) {
		writeJSON200(w, `{"name":"models/gemini-3.8-flash"}`)
	})
	if err := g.Validate(context.Background(), cr); err != nil {
		t.Fatal(err)
	}
	if r := rig.requests()[0]; r.Method != "GET" || r.Path != "/v1beta/models/gemini-3.8-flash" || r.Auth != oaKey {
		t.Errorf("request = %+v", r)
	}
	for status, want := range map[int]error{400: ErrBadRequest, 403: ErrKeyRejected, 404: ErrModelUnavailable} {
		g, _, cr := gemRig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) { w.WriteHeader(status) })
		if err := g.Validate(context.Background(), cr); !errors.Is(err, want) {
			t.Errorf("status %d: %v", status, err)
		}
	}
}

func TestGeminiNoKeyInErrors(t *testing.T) {
	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	for _, status := range []int{400, 401, 403, 404, 429, 500} {
		g, _, cr := gemRig(t, func(_ int, w http.ResponseWriter, _ *http.Request, rec seenReq) {
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"error":{"message":"API key not valid: `+oaKey+` for `+string(rec.Raw)+`","details":[{"reason":"`+oaKey+`"}]}}`)
		})
		for _, err := range []error{
			func() error { _, err := g.Review(context.Background(), cr, reviewReq()); return err }(),
			g.Validate(context.Background(), cr),
		} {
			if err == nil || strings.Contains(err.Error(), oaKey) || strings.Contains(err.Error(), "SECRET-ENTRY-TEXT") {
				t.Errorf("status %d: error = %v", status, err)
			}
		}
	}
	g, rig, cr := gemRig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) {
		writeJSON200(w, gemReply("key "+oaKey, "STOP"))
	})
	_, err := g.Review(context.Background(), cr, reviewReq())
	if err == nil || strings.Contains(err.Error(), oaKey) {
		t.Errorf("echo reply: %v", err)
	}
	rig.srv.Close()
	_, err = g.Review(context.Background(), cr, reviewReq())
	if err == nil || strings.Contains(err.Error(), oaKey) {
		t.Errorf("transport: %v", err)
	}
	for _, bad := range []string{oaKey, "sk-fake", "SECRET-ENTRY-TEXT", "API key not valid"} {
		if strings.Contains(logs.String(), bad) {
			t.Errorf("logs contain %q", bad)
		}
	}
	if !strings.Contains(logs.String(), "provider=gemini") {
		t.Errorf("logs lack the provider id:\n%s", logs.String())
	}
}
