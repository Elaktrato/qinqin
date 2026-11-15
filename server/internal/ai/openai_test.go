package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	oaKey      = "sk-fake-good-key-0001"
	goodReview = `{"annotations":[{"quote":"你好","context_before":"","correction":"您好","explanation":"polite","category":"grammar"}],"overall":{"summary":"ok","strengths":["a"],"focus":["b"]}}`
	goodSugg   = `{"items":[{"title":"T","prompt":"P","words":["w"]}]}`
	goodTrans  = `{"text":"你好","unreadable":false}`
)

type seenReq struct {
	Method, Path, Auth string
	Body               map[string]any
	Raw                []byte
}

type oaRig struct {
	srv  *httptest.Server
	mu   sync.Mutex
	seen []seenReq
}

func (r *oaRig) requests() []seenReq {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]seenReq(nil), r.seen...)
}

func newOARig(t *testing.T, h func(n int, w http.ResponseWriter, r *http.Request, rec seenReq)) *oaRig {
	t.Helper()
	rig := &oaRig{}
	rig.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		rec := seenReq{Method: r.Method, Path: r.URL.Path, Auth: r.Header.Get("Authorization"), Raw: raw}
		_ = json.Unmarshal(raw, &rec.Body)
		rig.mu.Lock()
		rig.seen = append(rig.seen, rec)
		n := len(rig.seen)
		rig.mu.Unlock()
		h(n, w, r, rec)
	}))
	t.Cleanup(rig.srv.Close)
	return rig
}

func chatJSON(content, finish string) string {
	b, _ := json.Marshal(map[string]any{
		"model":   "served-model-1",
		"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}, "finish_reason": finish}},
		"usage":   map[string]any{"prompt_tokens": 10, "completion_tokens": 5},
	})
	return string(b)
}

func writeJSON200(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, body)
}

func specFor(id, base string) ProviderSpec {
	for _, b := range Builtins() {
		if b.ID == id {
			b.BaseURL = base
			return b
		}
	}
	return ProviderSpec{ID: id, Name: "Local", Kind: KindOpenAI, Custom: true, BaseURL: base, DefaultModel: "m",
		Structured: StructuredObject, TokenField: "max_tokens", ValidateBy: "models", Vision: true}
}

func oaAdapter(rig *oaRig, mut func(*ProviderSpec)) (*OpenAICompat, ProviderSpec) {
	return oaAdapterFor(rig, "openai", mut)
}

func oaAdapterFor(rig *oaRig, id string, mut func(*ProviderSpec)) (*OpenAICompat, ProviderSpec) {
	sp := specFor(id, rig.srv.URL)
	if mut != nil {
		mut(&sp)
	}
	c := NewBuiltinClient(nil)
	return &OpenAICompat{HTTP: c, CustomHTTP: c, Spec: func(_ context.Context, pid string) (ProviderSpec, error) {
		if pid != sp.ID {
			return ProviderSpec{}, ErrUnknownProvider
		}
		return sp, nil
	}}, sp
}

func oaCreds(sp ProviderSpec, model string) Credentials {
	if model == "" {
		model = sp.DefaultModel
	}
	return Credentials{APIKey: oaKey, Model: model, BaseURL: sp.BaseURL, Provider: sp.ID}
}

func reviewReq() ReviewRequest {
	return ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "你好 世界 SECRET-ENTRY-TEXT"}
}

func replyWith(content string) func(int, http.ResponseWriter, *http.Request, seenReq) {
	return func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) {
		writeJSON200(w, chatJSON(content, "stop"))
	}
}

func TestOpenAIRequestShape(t *testing.T) {
	cases := []struct {
		id         string
		mut        func(*ProviderSpec)
		tokenField string
		tokens     float64 // 0 = none
		rfType     string  // "" = no response_format
		strict     bool
		openrouter bool
		noAuth     bool
	}{
		{id: "openai", tokenField: "max_completion_tokens", tokens: 16000, rfType: "json_schema", strict: true},
		{id: "deepseek", tokenField: "max_tokens", tokens: 16000, rfType: "json_object"},
		{id: "mistral", tokenField: "max_tokens", tokens: 16000, rfType: "json_schema"},
		{id: "groq", tokenField: "max_tokens", tokens: 16000, rfType: "json_schema"},
		{id: "openrouter", tokenField: "max_tokens", tokens: 16000, rfType: "json_schema", openrouter: true},
		{id: "custom-aaaaaaaaaa", tokenField: "max_tokens", tokens: 0, rfType: "json_object"},
		{id: "custom-aaaaaaaaaa", mut: func(s *ProviderSpec) { s.MaxOutputTokens = 2000 }, tokenField: "max_tokens", tokens: 2000, rfType: "json_object"},
		{id: "custom-aaaaaaaaaa", mut: func(s *ProviderSpec) { s.Structured = StructuredPrompt; s.KeyRequired = false }, tokenField: "max_tokens", rfType: ""},
		{id: "custom-aaaaaaaaaa", mut: func(s *ProviderSpec) { s.Structured = StructuredSchema }, tokenField: "max_tokens", rfType: "json_schema"},
	}
	for _, c := range cases {
		t.Run(c.id+"/"+string(specFor(c.id, "").Structured), func(t *testing.T) {
			rig := newOARig(t, replyWith(goodReview))
			ad, sp := oaAdapterFor(rig, c.id, c.mut)
			if _, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq()); err != nil {
				t.Fatal(err)
			}
			rq := rig.requests()
			if len(rq) != 1 {
				t.Fatalf("%d requests", len(rq))
			}
			r := rq[0]
			if r.Method != http.MethodPost || r.Path != "/chat/completions" {
				t.Errorf("%s %s", r.Method, r.Path)
			}
			if r.Auth != "Bearer "+oaKey {
				t.Errorf("Authorization = %q", r.Auth)
			}
			if r.Body["model"] != sp.DefaultModel {
				t.Errorf("model = %v", r.Body["model"])
			}
			rf, _ := r.Body["response_format"].(map[string]any)
			if c.rfType == "" {
				if rf != nil {
					t.Errorf("response_format = %v, want none", rf)
				}
			} else {
				if rf["type"] != c.rfType {
					t.Errorf("response_format.type = %v, want %s", rf["type"], c.rfType)
				}
				if c.rfType == "json_schema" {
					js, _ := rf["json_schema"].(map[string]any)
					if js["strict"] != c.strict || js["name"] != "review" || js["schema"] == nil {
						t.Errorf("json_schema = %v", js)
					}
				}
			}
			for _, f := range []string{"max_tokens", "max_completion_tokens"} {
				v, has := r.Body[f]
				switch {
				case f == c.tokenField && c.tokens > 0:
					if v != c.tokens {
						t.Errorf("%s = %v, want %v", f, v, c.tokens)
					}
				case has:
					t.Errorf("unexpected %s = %v", f, v)
				}
			}
			prov, hasProv := r.Body["provider"].(map[string]any)
			if c.openrouter != hasProv || (hasProv && prov["require_parameters"] != true) {
				t.Errorf("provider = %v", r.Body["provider"])
			}
			msgs, _ := r.Body["messages"].([]any)
			if len(msgs) != 2 {
				t.Fatalf("messages = %v", msgs)
			}
			sys := msgs[0].(map[string]any)
			wantSys := systemPrompt("review", sp.Structured)
			if sys["role"] != "system" || sys["content"] != wantSys {
				t.Errorf("system message differs from systemPrompt")
			}
			if u := msgs[1].(map[string]any); u["role"] != "user" || !strings.Contains(u["content"].(string), "SECRET-ENTRY-TEXT") {
				t.Errorf("user message = %v", u)
			}
		})
	}
}

func TestOpenAIKeylessCustomSendsNoAuthorization(t *testing.T) {
	rig := newOARig(t, replyWith(goodReview))
	ad, sp := oaAdapterFor(rig, "custom-aaaaaaaaaa", nil)
	cr := oaCreds(sp, "")
	cr.APIKey = ""
	if _, err := ad.Review(context.Background(), cr, reviewReq()); err != nil {
		t.Fatal(err)
	}
	if got := rig.requests()[0].Auth; got != "" {
		t.Errorf("Authorization = %q, want none", got)
	}
}

func TestOpenAISuggestAndTranscribeShape(t *testing.T) {
	rig := newOARig(t, func(n int, w http.ResponseWriter, r *http.Request, rec seenReq) {
		if strings.Contains(string(rec.Raw), "image_url") {
			writeJSON200(w, chatJSON(goodTrans, "stop"))
			return
		}
		writeJSON200(w, chatJSON(goodSugg, "stop"))
	})
	ad, sp := oaAdapter(rig, nil)
	s, err := ad.Suggest(context.Background(), oaCreds(sp, ""), SuggestRequest{Language: "zh", ExplanationLanguage: "en", Words: []string{"w"}})
	if err != nil || len(s.Items) != 1 || s.Model != "served-model-1" || s.Usage.InputTokens != 10 || s.Usage.OutputTokens != 5 {
		t.Fatalf("suggest = %+v, %v", s, err)
	}
	if rig.requests()[0].Body["max_completion_tokens"] != float64(4000) {
		t.Errorf("suggest budget = %v", rig.requests()[0].Body["max_completion_tokens"])
	}
	tr, err := ad.Transcribe(context.Background(), oaCreds(sp, ""), TranscribeRequest{Language: "zh", Image: []byte("\xff\xd8jpeg"), MediaType: "image/jpeg"})
	if err != nil || tr.Text != "你好" {
		t.Fatalf("transcribe = %+v, %v", tr, err)
	}
	r := rig.requests()[1]
	if r.Body["max_completion_tokens"] != float64(8000) {
		t.Errorf("transcribe budget = %v", r.Body["max_completion_tokens"])
	}
	msgs := r.Body["messages"].([]any)
	parts, _ := msgs[1].(map[string]any)["content"].([]any)
	if len(parts) != 2 {
		t.Fatalf("user content = %v", msgs[1])
	}
	img := parts[0].(map[string]any)
	url, _ := img["image_url"].(map[string]any)["url"].(string)
	if img["type"] != "image_url" || !strings.HasPrefix(url, "data:image/jpeg;base64,") || parts[1].(map[string]any)["type"] != "text" {
		t.Errorf("image part = %v", parts)
	}
	if _, err := ad.Transcribe(context.Background(), oaCreds(sp, ""), TranscribeRequest{Image: []byte("x"), MediaType: "image/png"}); !errors.Is(err, ErrBadRequest) {
		t.Errorf("png = %v, want ErrBadRequest", err)
	}
}

func TestOpenAIReplyMapping(t *testing.T) {
	cases := []struct {
		name string
		body string
		want error
	}{
		{"refusal", `{"model":"m","choices":[{"message":{"content":null,"refusal":"I can't help"},"finish_reason":"stop"}]}`, ErrRefused},
		{"content_filter", `{"model":"m","choices":[{"message":{"content":""},"finish_reason":"content_filter"}]}`, ErrRefused},
		{"length", `{"model":"m","choices":[{"message":{"content":"{\"annot"},"finish_reason":"length"}]}`, ErrTruncated},
		{"no choices", `{"model":"m","choices":[]}`, ErrBadReply},
		{"not json", `<html>`, ErrBadReply},
		{"null content", `{"model":"m","choices":[{"message":{"content":null},"finish_reason":"stop"}]}`, ErrBadReply},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rig := newOARig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) { writeJSON200(w, c.body) })
			ad, sp := oaAdapter(rig, nil)
			_, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq())
			if !errors.Is(err, c.want) {
				t.Errorf("err = %v, want %v", err, c.want)
			}
			if c.want != ErrBadReply && len(rig.requests()) != 1 {
				t.Errorf("%d requests, want 1 (no repair for %s)", len(rig.requests()), c.name)
			}
		})
	}
	// Cached tokens, both spellings.
	for name, usage := range map[string]string{
		"openai":   `{"prompt_tokens":120,"completion_tokens":40,"prompt_tokens_details":{"cached_tokens":100}}`,
		"deepseek": `{"prompt_tokens":120,"completion_tokens":40,"prompt_cache_hit_tokens":100}`,
	} {
		body := `{"model":"m","choices":[{"message":{"content":` + mustJSON(goodReview) + `},"finish_reason":"stop"}],"usage":` + usage + `}`
		rig := newOARig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) { writeJSON200(w, body) })
		ad, sp := oaAdapter(rig, nil)
		rep, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq())
		if err != nil || rep.Usage.CacheReadTokens != 100 || rep.Usage.InputTokens != 20 || rep.Usage.OutputTokens != 40 {
			t.Errorf("%s: %+v, %v", name, rep.Usage, err)
		}
	}
	// The fixture file shaped like the docs' example.
	fx, err := os.ReadFile("testdata/openai/chat_review.json")
	if err != nil {
		t.Fatal(err)
	}
	rig := newOARig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) { writeJSON200(w, string(fx)) })
	ad, sp := oaAdapter(rig, nil)
	rep, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq())
	if err != nil || rep.Model != "gpt-6-astra-2026-11-01" || len(rep.Annotations) != 1 || rep.Annotations[0].Correction != "您好" || rep.Overall.Summary != "Good." {
		t.Fatalf("fixture reply = %+v, %v", rep, err)
	}
	if len(rep.Calls) != 1 || rep.Calls[0].Kind != "review" {
		t.Errorf("Calls = %+v", rep.Calls)
	}
}

func mustJSON(s string) string { b, _ := json.Marshal(s); return string(b) }

func TestOpenAIErrorMapping(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		hdr    map[string]string
		want   error
		retry  time.Duration
	}{
		{"401", 401, `{"error":{"message":"bad key"}}`, nil, ErrKeyRejected, 0},
		{"403", 403, ``, nil, ErrKeyRejected, 0},
		{"402", 402, `{"error":{"message":"Insufficient Balance"}}`, nil, ErrQuota, 0},
		{"429 quota", 429, `{"error":{"code":"insufficient_quota","type":"insufficient_quota"}}`, nil, ErrQuota, 0},
		{"429 other", 429, `{"error":{"code":"rate_limit_exceeded"}}`, map[string]string{"Retry-After": "12"}, ErrBusy, 12 * time.Second},
		{"429 no header", 429, `{}`, nil, ErrBusy, defaultRetryAfter},
		{"404", 404, `{"error":{"code":"model_not_found"}}`, nil, ErrModelUnavailable, 0},
		{"500", 500, `oops`, nil, ErrBusy, defaultRetryAfter},
		{"503", 503, ``, map[string]string{"Retry-After": "7"}, ErrBusy, 7 * time.Second},
		{"302", 302, ``, map[string]string{"Location": "http://127.0.0.1:1/x"}, ErrBadRequest, 0},
		{"400", 400, `{"error":{"message":"unsupported parameter"}}`, nil, ErrBadRequest, 0},
		{"422", 422, `x`, nil, ErrBadRequest, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rig := newOARig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) {
				for k, v := range c.hdr {
					w.Header().Set(k, v)
				}
				w.WriteHeader(c.status)
				_, _ = io.WriteString(w, c.body)
			})
			ad, sp := oaAdapter(rig, nil)
			_, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq())
			if !errors.Is(err, c.want) {
				t.Fatalf("err = %v, want %v", err, c.want)
			}
			var be *BusyError
			if c.retry > 0 && (!errors.As(err, &be) || be.RetryAfter != c.retry) {
				t.Errorf("retry-after = %v, want %v", err, c.retry)
			}
			if len(rig.requests()) != 1 {
				t.Errorf("%d requests, want 1", len(rig.requests()))
			}
		})
	}
	// Connection refused is busy, not a crash.
	rig := newOARig(t, replyWith(goodReview))
	ad, sp := oaAdapter(rig, nil)
	rig.srv.Close()
	if _, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq()); !errors.Is(err, ErrBusy) {
		t.Errorf("refused = %v, want ErrBusy", err)
	}
}

func TestOpenAIBlockedEndpointIsReported(t *testing.T) {
	sp := specFor("custom-aaaaaaaaaa", "https://llm.example.com/v1")
	dns := newDNS(t, fixed("169.254.169.254"))
	ad := &OpenAICompat{CustomHTTP: NewGuardedClient(GuardPolicy{AllowPrivate: true}, dns.resolver()),
		Spec: func(context.Context, string) (ProviderSpec, error) { return sp, nil }}
	_, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq())
	if !errors.Is(err, ErrEndpointBlocked) || Code(err) != "endpoint_blocked" {
		t.Errorf("err = %v (%q)", err, Code(err))
	}
}

func TestRepairOnce(t *testing.T) {
	bad := "```json\n" + strings.TrimSuffix(goodReview, "}") + `,"note":"extra"}` + "\n```"
	rig := newOARig(t, func(n int, w http.ResponseWriter, _ *http.Request, _ seenReq) {
		if n == 1 {
			writeJSON200(w, chatJSON(bad, "stop"))
			return
		}
		writeJSON200(w, chatJSON(goodReview, "stop"))
	})
	ad, sp := oaAdapter(rig, nil)
	rep, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq())
	if err != nil {
		t.Fatal(err)
	}
	rq := rig.requests()
	if len(rq) != 2 {
		t.Fatalf("%d requests", len(rq))
	}
	msgs := rq[1].Body["messages"].([]any)
	if len(msgs) != 4 {
		t.Fatalf("repair messages = %d, want 4", len(msgs))
	}
	if a := msgs[2].(map[string]any); a["role"] != "assistant" || a["content"] != bad {
		t.Errorf("assistant turn = %v", a)
	}
	if u := msgs[3].(map[string]any); u["role"] != "user" || !strings.Contains(u["content"].(string), "note") {
		t.Errorf("repair turn = %v", u)
	}
	if len(rep.Calls) != 2 || rep.Calls[0].Kind != "review" || rep.Calls[1].Kind != "review-repair" {
		t.Errorf("Calls = %+v", rep.Calls)
	}
	if rep.Usage.InputTokens != 20 || rep.Usage.OutputTokens != 10 {
		t.Errorf("usage = %+v, want the sum of both calls", rep.Usage)
	}
	if len(rep.Annotations) != 1 {
		t.Errorf("annotations = %+v", rep.Annotations)
	}
}

func TestRepairFailsOnce(t *testing.T) {
	rig := newOARig(t, replyWith(`{"annotations":[]}`))
	ad, sp := oaAdapter(rig, nil)
	rep, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq())
	if !errors.Is(err, ErrBadReply) {
		t.Fatalf("err = %v, want ErrBadReply", err)
	}
	if len(rig.requests()) != 2 {
		t.Errorf("%d requests, want exactly 2", len(rig.requests()))
	}
	if len(rep.Calls) != 2 {
		t.Errorf("both paid calls must be reported even on failure: %+v", rep.Calls)
	}
}

func TestDeepSeekWhitespaceContent(t *testing.T) {
	rig := newOARig(t, func(n int, w http.ResponseWriter, _ *http.Request, _ seenReq) {
		if n == 1 {
			writeJSON200(w, chatJSON("   \n ", "stop"))
			return
		}
		writeJSON200(w, chatJSON(goodReview, "stop"))
	})
	ad, sp := oaAdapterFor(rig, "deepseek", nil)
	if _, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq()); err != nil {
		t.Fatal(err)
	}
	if len(rig.requests()) != 2 {
		t.Errorf("%d requests, want a repair after whitespace content", len(rig.requests()))
	}
}

func TestOpenAIValidate(t *testing.T) {
	models, _ := os.ReadFile("testdata/openai/models.json")
	handler := func(status int) func(int, http.ResponseWriter, *http.Request, seenReq) {
		return func(_ int, w http.ResponseWriter, r *http.Request, rec seenReq) {
			if r.URL.Path == "/models" && r.Method == http.MethodGet {
				if status != 200 {
					w.WriteHeader(status)
					return
				}
				writeJSON200(w, string(models))
				return
			}
			writeJSON200(w, chatJSON("pong", "length"))
		}
	}
	t.Run("models lists the model", func(t *testing.T) {
		rig := newOARig(t, handler(200))
		ad, sp := oaAdapter(rig, nil)
		if err := ad.Validate(context.Background(), oaCreds(sp, "gpt-6-luna")); err != nil {
			t.Fatal(err)
		}
		rq := rig.requests()
		if len(rq) != 1 || rq[0].Method != "GET" || rq[0].Path != "/models" || rq[0].Auth != "Bearer "+oaKey {
			t.Errorf("requests = %+v", rq)
		}
	})
	t.Run("model not listed", func(t *testing.T) {
		rig := newOARig(t, handler(200))
		ad, sp := oaAdapter(rig, nil)
		if err := ad.Validate(context.Background(), oaCreds(sp, "gpt-nope")); !errors.Is(err, ErrModelUnavailable) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("bad key", func(t *testing.T) {
		rig := newOARig(t, handler(401))
		ad, sp := oaAdapter(rig, nil)
		if err := ad.Validate(context.Background(), oaCreds(sp, "")); !errors.Is(err, ErrKeyRejected) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("builtin 404 on models is not papered over", func(t *testing.T) {
		rig := newOARig(t, handler(404))
		ad, sp := oaAdapter(rig, nil)
		if err := ad.Validate(context.Background(), oaCreds(sp, "")); !errors.Is(err, ErrModelUnavailable) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("custom 404 falls back to one chat call", func(t *testing.T) {
		rig := newOARig(t, handler(404))
		ad, sp := oaAdapterFor(rig, "custom-aaaaaaaaaa", nil)
		if err := ad.Validate(context.Background(), oaCreds(sp, "")); err != nil {
			t.Fatal(err)
		}
		rq := rig.requests()
		if len(rq) != 2 || rq[1].Method != "POST" || rq[1].Path != "/chat/completions" || rq[1].Body["max_tokens"] != float64(1) {
			t.Errorf("requests = %+v", rq)
		}
	})
	t.Run("custom models without the model is fine", func(t *testing.T) {
		rig := newOARig(t, handler(200))
		ad, sp := oaAdapterFor(rig, "custom-aaaaaaaaaa", nil)
		if err := ad.Validate(context.Background(), oaCreds(sp, "my-local-model")); err != nil {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("openrouter validates with a chat call", func(t *testing.T) {
		rig := newOARig(t, handler(200))
		ad, sp := oaAdapterFor(rig, "openrouter", nil)
		if err := ad.Validate(context.Background(), oaCreds(sp, "")); err != nil {
			t.Fatal(err)
		}
		rq := rig.requests()
		if len(rq) != 1 || rq[0].Method != "POST" || rq[0].Body["max_tokens"] != float64(1) {
			t.Errorf("requests = %+v", rq)
		}
	})
	t.Run("chat 401", func(t *testing.T) {
		rig := newOARig(t, func(_ int, w http.ResponseWriter, _ *http.Request, _ seenReq) { w.WriteHeader(401) })
		ad, sp := oaAdapterFor(rig, "openrouter", nil)
		if err := ad.Validate(context.Background(), oaCreds(sp, "")); !errors.Is(err, ErrKeyRejected) {
			t.Errorf("err = %v", err)
		}
	})
}

func TestOpenAINoKeyInErrors(t *testing.T) {
	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	echo := func(status int, ct string) func(int, http.ResponseWriter, *http.Request, seenReq) {
		return func(_ int, w http.ResponseWriter, r *http.Request, rec seenReq) {
			// A provider that echoes the request: key, headers and the entry text.
			w.Header().Set("Content-Type", ct)
			w.Header().Set("X-Echo", rec.Auth)
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"error":{"message":"Incorrect API key provided: `+oaKey+` in `+string(rec.Raw)+`","code":"`+oaKey+`","type":"`+oaKey+`"}}`)
		}
	}
	for _, status := range []int{400, 401, 402, 403, 404, 429, 500, 503} {
		rig := newOARig(t, echo(status, "application/json"))
		ad, sp := oaAdapter(rig, nil)
		for _, call := range []func() error{
			func() error { _, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq()); return err },
			func() error { return ad.Validate(context.Background(), oaCreds(sp, "")) },
		} {
			err := call()
			if err == nil {
				t.Fatalf("status %d: no error", status)
			}
			if s := err.Error(); strings.Contains(s, oaKey) || strings.Contains(s, "SECRET-ENTRY-TEXT") || strings.Contains(s, "sk-fake") {
				t.Errorf("status %d: error leaks: %q", status, s)
			}
		}
	}
	// A 200 whose content echoes the key (and is therefore unusable).
	rig := newOARig(t, replyWith("my key is "+oaKey))
	ad, sp := oaAdapter(rig, nil)
	_, err := ad.Review(context.Background(), oaCreds(sp, ""), reviewReq())
	if err == nil || strings.Contains(err.Error(), oaKey) {
		t.Errorf("echoing reply: %v", err)
	}
	// Transport failure.
	rig.srv.Close()
	_, err = ad.Review(context.Background(), oaCreds(sp, ""), reviewReq())
	if err == nil || strings.Contains(err.Error(), oaKey) || strings.Contains(err.Error(), "SECRET") {
		t.Errorf("transport: %v", err)
	}
	out := logs.String()
	for _, bad := range []string{oaKey, "sk-fake", "SECRET-ENTRY-TEXT", "Incorrect API key"} {
		if strings.Contains(out, bad) {
			t.Errorf("log output contains %q:\n%s", bad, out)
		}
	}
	if !strings.Contains(out, "provider=openai") {
		t.Errorf("log lacks the provider id:\n%s", out)
	}
}

func TestPromptsProviderNeutral(t *testing.T) {
	for task, base := range map[string]string{"review": reviewSystemPrompt, "suggest": suggestSystemPrompt, "transcribe": transcribeSystemPrompt} {
		if got := systemPrompt(task, StructuredSchema); got != base {
			t.Errorf("%s: schema mode changed the base prompt", task)
		}
		for _, m := range []Structured{StructuredObject, StructuredPrompt} {
			got := systemPrompt(task, m)
			if !strings.HasPrefix(got, base+"\n\nReply with one JSON object (json)") || !strings.HasSuffix(got, taskSchema(task)) {
				t.Errorf("%s/%s: suffix wrong", task, m)
			}
		}
	}
	// The Anthropic adapter sends exactly the same base constants (claude.go).
	src, err := os.ReadFile("claude.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []string{"reviewSystemPrompt", "suggestSystemPrompt", "transcribeSystemPrompt"} {
		if !strings.Contains(string(src), c) {
			t.Errorf("claude.go does not use %s", c)
		}
	}
}
