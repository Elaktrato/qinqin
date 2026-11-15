package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"
)

const maxErrorBody = 64 << 10

// OpenAICompat speaks Chat Completions to OpenAI and every compatible API
// (DeepSeek, Mistral, xAI, Groq, OpenRouter, custom endpoints). Spec resolves
// a provider id to its registry entry; HTTP serves the built-ins and
// CustomHTTP (the SSRF-guarded client) serves custom endpoints.
type OpenAICompat struct {
	HTTP       *http.Client
	CustomHTTP *http.Client
	Spec       func(ctx context.Context, providerID string) (ProviderSpec, error)
}

func (o *OpenAICompat) client(spec ProviderSpec) *http.Client {
	if spec.Custom && o.CustomHTTP != nil {
		return o.CustomHTTP
	}
	if o.HTTP != nil {
		return o.HTTP
	}
	return NewBuiltinClient(nil)
}

func baseOf(spec ProviderSpec, cr Credentials) string {
	if cr.BaseURL != "" {
		return cr.BaseURL
	}
	return spec.BaseURL
}

// do sends one request and returns the capped body of a 200 answer; any
// other outcome is one of our errors. Nothing from the request or the
// provider's body reaches the error text or the log beyond kind, provider id,
// status and our code.
func (o *OpenAICompat) do(ctx context.Context, kind string, spec ProviderSpec, cr Credentials, method, path string, body any) ([]byte, int, error) {
	var rdr *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, ErrBadRequest
		}
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, baseOf(spec, cr)+path, rdr)
	if err != nil {
		return nil, 0, ErrBadRequest
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cr.APIKey != "" || spec.KeyRequired {
		req.Header.Set("Authorization", "Bearer "+cr.APIKey)
	}
	resp, err := o.client(spec).Do(req)
	if err != nil {
		if errors.Is(err, ErrEndpointBlocked) {
			log.Printf("ai: %s provider=%s endpoint blocked", kind, spec.ID)
			return nil, 0, ErrEndpointBlocked
		}
		// url.Error text carries the URL; never pass it on.
		log.Printf("ai: %s provider=%s transport error", kind, spec.ID)
		return nil, 0, &BusyError{RetryAfter: defaultRetryAfter}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		eb, _ := readCapped(resp.Body, maxErrorBody)
		return nil, resp.StatusCode, mapOpenAIError(kind, spec.ID, resp.StatusCode, eb, resp.Header)
	}
	b, err := readCapped(resp.Body, MaxResponseBytes)
	if err != nil {
		log.Printf("ai: %s provider=%s status=200 code=%s", kind, spec.ID, Code(err))
		return nil, 200, err
	}
	return b, 200, nil
}

// mapOpenAIError maps an HTTP status (and the error code of the body, which
// is never logged or returned) to our errors.
func mapOpenAIError(kind, provider string, status int, body []byte, h http.Header) error {
	var parsed struct {
		Error struct {
			Code any    `json:"code"`
			Type string `json:"type"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &parsed)
	code, _ := parsed.Error.Code.(string)
	var err error
	switch {
	case (status == 403 || status == 404) && code == "model_not_found":
		err = ErrModelUnavailable
	case status == 403 && (code == "insufficient_permissions" || code == "permission_denied" || code == "access_terminated"):
		err = ErrNoAccess // the key is fine; it may not use this model or action
	case status == 401 || status == 403:
		err = ErrKeyRejected
	case status == 402:
		err = ErrQuota
	case status == 429 && (code == "insufficient_quota" || parsed.Error.Type == "insufficient_quota"):
		err = ErrQuota
	case status == 429 || status >= 500:
		err = &BusyError{RetryAfter: retryAfterHeader(h)}
	case status == 404:
		err = ErrModelUnavailable
	default: // 3xx (never followed), other 4xx
		err = ErrBadRequest
	}
	log.Printf("ai: %s provider=%s status=%d code=%s", kind, provider, status, Code(err))
	return err
}

// maxRetryAfter caps what a provider may ask us to tell the learner to wait.
const maxRetryAfter = time.Hour

func retryAfterHeader(h http.Header) time.Duration {
	if n, err := strconv.Atoi(h.Get("Retry-After")); err == nil && n > 0 {
		return min(time.Duration(n)*time.Second, maxRetryAfter)
	}
	return defaultRetryAfter
}

type chatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

func (o *OpenAICompat) request(spec ProviderSpec, cr Credentials, task string, msgs []chatMessage, budget int) map[string]any {
	body := map[string]any{"model": cr.Model, "messages": msgs}
	switch spec.Structured {
	case StructuredSchema:
		body["response_format"] = map[string]any{"type": "json_schema", "json_schema": map[string]any{
			"name": task, "schema": json.RawMessage(taskSchema(task)), "strict": spec.Strict}}
	case StructuredObject:
		body["response_format"] = map[string]any{"type": "json_object"}
	}
	if spec.TokenField != "" {
		n := budget
		if spec.MaxOutputTokens > 0 && spec.MaxOutputTokens < n {
			n = spec.MaxOutputTokens
		}
		if !spec.Custom || spec.MaxOutputTokens > 0 {
			body[spec.TokenField] = n
		}
	}
	for k, v := range spec.Extra {
		body[k] = v
	}
	return body
}

type chatReply struct {
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content *string `json:"content"`
			Refusal *string `json:"refusal"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int64 `json:"prompt_tokens"`
		CompletionTokens int64 `json:"completion_tokens"`
		Details          struct {
			Cached int64 `json:"cached_tokens"`
		} `json:"prompt_tokens_details"`
		DeepSeekHit int64 `json:"prompt_cache_hit_tokens"`
	} `json:"usage"`
}

// chatOnce sends one chat request and returns the message text, the model
// and the usage; refusals and truncation are errors here.
func (o *OpenAICompat) chatOnce(ctx context.Context, kind string, spec ProviderSpec, cr Credentials, task string, msgs []chatMessage, budget int) (string, string, Usage, error) {
	raw, _, err := o.do(ctx, kind, spec, cr, http.MethodPost, "/chat/completions", o.request(spec, cr, task, msgs, budget))
	if err != nil {
		return "", "", Usage{}, err
	}
	var rep chatReply
	if err := json.Unmarshal(raw, &rep); err != nil || len(rep.Choices) == 0 {
		return "", "", Usage{}, ErrBadReply
	}
	cached := rep.Usage.Details.Cached
	if rep.Usage.DeepSeekHit > cached {
		cached = rep.Usage.DeepSeekHit
	}
	usage := Usage{InputTokens: rep.Usage.PromptTokens - cached, OutputTokens: rep.Usage.CompletionTokens, CacheReadTokens: cached}
	ch := rep.Choices[0]
	switch {
	case ch.Message.Refusal != nil && *ch.Message.Refusal != "":
		log.Printf("ai: %s provider=%s refused", kind, spec.ID)
		return "", rep.Model, usage, ErrRefused
	case ch.FinishReason == "content_filter":
		log.Printf("ai: %s provider=%s content filter", kind, spec.ID)
		return "", rep.Model, usage, ErrRefused
	case ch.FinishReason == "length":
		return "", rep.Model, usage, ErrTruncated
	case ch.Message.Content == nil:
		return "", rep.Model, usage, ErrBadReply
	}
	return *ch.Message.Content, rep.Model, usage, nil
}

func (u *Usage) add(o Usage) {
	u.InputTokens += o.InputTokens
	u.OutputTokens += o.OutputTokens
	u.CacheReadTokens += o.CacheReadTokens
}

// run performs one task: a request, strict decoding of the text into dst and,
// when decoding fails, exactly one repair request. calls lists every call
// made (also on failure) so each gets a row.
func (o *OpenAICompat) run(ctx context.Context, task string, cr Credentials, user any, userText string, budget int, dst any, required []string) (model string, total Usage, calls []CallUsage, err error) {
	spec, err := o.Spec(ctx, cr.Provider)
	if err != nil {
		return "", Usage{}, nil, err
	}
	msgs := []chatMessage{{"system", systemPrompt(task, spec.Structured)}, {"user", user}}
	text, model, usage, err := o.chatOnce(ctx, task, spec, cr, task, msgs, budget)
	total = usage
	if model != "" || usage != (Usage{}) {
		calls = append(calls, CallUsage{Kind: task, Usage: usage})
	}
	if err != nil {
		return model, total, calls, err
	}
	derr := decodeStrict(text, dst, required)
	if derr == nil {
		return model, total, calls, nil
	}
	repairKind := task + "-repair"
	// The repair turn is text only: the photo is not sent a second time.
	msgs = []chatMessage{msgs[0], {"user", userText}, {"assistant", text}, {"user", repairMessage(text, derr)}}
	text, m2, usage, err := o.chatOnce(ctx, repairKind, spec, cr, task, msgs, budget)
	total.add(usage)
	calls = append(calls, CallUsage{Kind: repairKind, Usage: usage})
	if m2 != "" {
		model = m2
	}
	if err != nil {
		return model, total, calls, err
	}
	if derr := decodeStrict(text, dst, required); derr != nil {
		log.Printf("ai: %s provider=%s code=bad_reply after repair", task, spec.ID)
		return model, total, calls, ErrBadReply
	}
	return model, total, calls, nil
}

func (o *OpenAICompat) Review(ctx context.Context, cr Credentials, r ReviewRequest) (ReviewReply, error) {
	var out reviewWire
	msgR := reviewUserMessage(r, newNonce())
	model, usage, calls, err := o.run(ctx, "review", cr, msgR, msgR, 16000, &out, []string{"annotations", "overall"})
	rep := ReviewReply{Overall: out.Overall, Model: model, Usage: usage, Calls: calls}
	if err != nil {
		return rep, err
	}
	for _, a := range out.Annotations {
		rep.Annotations = append(rep.Annotations, RawAnnotation{Quote: a.Quote, ContextBefore: a.ContextBefore, Correction: a.Correction, Explanation: a.Explanation, Category: a.Category})
	}
	return rep, nil
}

func (o *OpenAICompat) Suggest(ctx context.Context, cr Credentials, r SuggestRequest) (SuggestReply, error) {
	var out suggestWire
	msgS := suggestUserMessage(r, newNonce())
	model, usage, calls, err := o.run(ctx, "suggest", cr, msgS, msgS, 4000, &out, []string{"items"})
	return SuggestReply{Items: out.Items, Model: model, Usage: usage, Calls: calls}, err
}

func (o *OpenAICompat) Transcribe(ctx context.Context, cr Credentials, r TranscribeRequest) (TranscribeReply, error) {
	if r.MediaType != "image/jpeg" {
		return TranscribeReply{}, ErrBadRequest
	}
	user := []any{
		map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(r.Image)}},
		map[string]any{"type": "text", "text": transcribeUserMessage(r)},
	}
	var out transcribeWire
	model, usage, calls, err := o.run(ctx, "transcribe", cr, user, transcribeUserMessage(r), 8000, &out, []string{"text", "unreadable"})
	return TranscribeReply{Text: out.Text, Unreadable: out.Unreadable, Model: model, Usage: usage, Calls: calls}, err
}

// Validate checks the key (and the model) without a paid call where the
// provider allows it; see ProviderSpec.ValidateBy.
func (o *OpenAICompat) Validate(ctx context.Context, cr Credentials) error {
	_, err := o.ValidateCounted(ctx, cr)
	return err
}

// ValidateCounted is Validate that also reports how many provider calls it
// made (a custom endpoint without /models falls back to a chat call).
func (o *OpenAICompat) ValidateCounted(ctx context.Context, cr Credentials) (int, error) {
	spec, err := o.Spec(ctx, cr.Provider)
	if err != nil {
		return 0, err
	}
	if spec.ValidateBy == "chat" {
		return 1, o.validateChat(ctx, spec, cr)
	}
	raw, status, err := o.do(ctx, "validate", spec, cr, http.MethodGet, "/models", nil)
	if err != nil {
		if spec.Custom && status == http.StatusNotFound {
			return 2, o.validateChat(ctx, spec, cr)
		}
		return 1, err
	}
	if spec.Custom {
		return 1, nil // gateways list models unreliably; the key is accepted
	}
	var list struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return 1, ErrBadReply
	}
	for _, m := range list.Data {
		if m.ID == cr.Model {
			return 1, nil
		}
	}
	return 1, ErrModelUnavailable
}
func (o *OpenAICompat) validateChat(ctx context.Context, spec ProviderSpec, cr Credentials) error {
	body := map[string]any{"model": cr.Model, "messages": []chatMessage{{"user", "ping"}}}
	field := spec.TokenField
	if field == "" {
		field = "max_tokens"
	}
	body[field] = 1
	for k, v := range spec.Extra {
		body[k] = v
	}
	_, _, err := o.do(ctx, "validate", spec, cr, http.MethodPost, "/chat/completions", body)
	return err
}
