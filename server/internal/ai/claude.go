package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
)

const (
	requestTimeout    = 150 * time.Second
	defaultRetryAfter = 30 * time.Second
)

// Claude is the Provider that calls the Anthropic API with the learner's key
// through the official Go SDK.
type Claude struct{ extra []option.RequestOption }

// NewClaude returns the provider; tests pass option.WithBaseURL(httptest URL).
func NewClaude(extra ...option.RequestOption) *Claude { return &Claude{extra: extra} }

func (c *Claude) client(cr Credentials) anthropic.Client {
	opts := append([]option.RequestOption{
		// The server's own ANTHROPIC_BASE_URL, CUSTOM_HEADERS and tokens must
		// never shape a learner's request.
		option.WithoutEnvironmentDefaults(),
		option.WithAPIKey(cr.APIKey),
		option.WithMaxRetries(1),
		option.WithRequestTimeout(requestTimeout),
	}, c.extra...)
	return anthropic.NewClient(opts...)
}

// Validate asks for the model: free, 401 for a bad key, 404 for an
// unavailable model.
func (c *Claude) Validate(ctx context.Context, cr Credentials) error {
	cl := c.client(cr)
	_, err := cl.Models.Get(ctx, cr.Model, anthropic.ModelGetParams{})
	return mapError("validate", err)
}

func (c *Claude) Review(ctx context.Context, cr Credentials, r ReviewRequest) (ReviewReply, error) {
	nonce := newNonce()
	text, model, usage, err := c.call(ctx, "review", cr, reviewSystemPrompt, reviewSchema, 24000, anthropic.BetaOutputConfigEffortMedium,
		[]anthropic.BetaContentBlockParamUnion{anthropic.NewBetaTextBlock(reviewUserMessage(r, nonce))})
	if err != nil {
		return ReviewReply{}, err
	}
	var out struct {
		Annotations []struct {
			Quote         string `json:"quote"`
			ContextBefore string `json:"context_before"`
			Correction    string `json:"correction"`
			Explanation   string `json:"explanation"`
			Category      string `json:"category"`
		} `json:"annotations"`
		Overall Overall `json:"overall"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return ReviewReply{}, ErrBadReply
	}
	rep := ReviewReply{Overall: out.Overall, Model: model, Usage: usage}
	for _, a := range out.Annotations {
		rep.Annotations = append(rep.Annotations, RawAnnotation{Quote: a.Quote, ContextBefore: a.ContextBefore, Correction: a.Correction, Explanation: a.Explanation, Category: a.Category})
	}
	return rep, nil
}

func (c *Claude) Suggest(ctx context.Context, cr Credentials, r SuggestRequest) (SuggestReply, error) {
	text, model, usage, err := c.call(ctx, "suggest", cr, suggestSystemPrompt, suggestSchema, 8000, anthropic.BetaOutputConfigEffortLow,
		[]anthropic.BetaContentBlockParamUnion{anthropic.NewBetaTextBlock(suggestUserMessage(r, newNonce()))})
	if err != nil {
		return SuggestReply{}, err
	}
	var out struct {
		Items []SuggestionItem `json:"items"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return SuggestReply{}, ErrBadReply
	}
	return SuggestReply{Items: out.Items, Model: model, Usage: usage}, nil
}

func (c *Claude) Transcribe(ctx context.Context, cr Credentials, r TranscribeRequest) (TranscribeReply, error) {
	if r.MediaType != "image/jpeg" {
		return TranscribeReply{}, ErrBadRequest
	}
	img := anthropic.NewBetaImageBlock(anthropic.BetaBase64ImageSourceParam{
		Data:      base64.StdEncoding.EncodeToString(r.Image),
		MediaType: anthropic.BetaBase64ImageSourceMediaTypeImageJPEG,
	})
	text, model, usage, err := c.call(ctx, "transcribe", cr, transcribeSystemPrompt, transcribeSchema, 16000, anthropic.BetaOutputConfigEffortMedium,
		[]anthropic.BetaContentBlockParamUnion{img, anthropic.NewBetaTextBlock(transcribeUserMessage(r))})
	if err != nil {
		return TranscribeReply{}, err
	}
	var out struct {
		Text       string `json:"text"`
		Unreadable bool   `json:"unreadable"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return TranscribeReply{}, ErrBadReply
	}
	return TranscribeReply{Text: out.Text, Unreadable: out.Unreadable, Model: model, Usage: usage}, nil
}

// Thinking tokens count toward max_tokens on these models, so the limits
// leave room for them above the structured reply.

// call sends one structured-output request and returns the JSON text of the
// last text block (a fallback boundary can precede it), the model that
// answered and the usage.
func (c *Claude) call(ctx context.Context, kind string, cr Credentials, system, schema string, maxTokens int64,
	effort anthropic.BetaOutputConfigEffort, content []anthropic.BetaContentBlockParamUnion) (string, string, Usage, error) {
	params := anthropic.BetaMessageNewParams{
		Model:     cr.Model,
		MaxTokens: maxTokens,
		System:    []anthropic.BetaTextBlockParam{{Text: system, CacheControl: anthropic.NewBetaCacheControlEphemeralParam()}},
		Messages:  []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(content...)},
		OutputConfig: anthropic.BetaOutputConfigParam{
			Effort: effort,
			Format: anthropic.BetaJSONOutputFormatParam{Schema: json.RawMessage(schema)},
		},
	}
	// Refusal fallback on Opus and Sonnet only; Haiku has none.
	if cr.Model == "claude-opus-5-5" || cr.Model == "claude-sonnet-5-5" {
		params.Fallbacks = anthropic.BetaFallbacksParamOfDefault()
		params.Betas = []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01}
	}
	cl := c.client(cr)
	resp, err := cl.Beta.Messages.New(ctx, params)
	if err != nil {
		return "", "", Usage{}, mapError(kind, err)
	}
	switch resp.StopReason {
	case anthropic.BetaStopReasonRefusal:
		log.Printf("ai: %s refused category=%s", kind, resp.StopDetails.Category)
		return "", "", Usage{}, ErrRefused
	case anthropic.BetaStopReasonMaxTokens:
		return "", "", Usage{}, ErrTruncated
	}
	var text string
	found := false
	for _, b := range resp.Content {
		if t, ok := b.AsAny().(anthropic.BetaTextBlock); ok {
			text, found = t.Text, true
		}
	}
	if !found {
		return "", "", Usage{}, ErrBadReply
	}
	return text, string(resp.Model), Usage{
		InputTokens:     resp.Usage.InputTokens,
		OutputTokens:    resp.Usage.OutputTokens,
		CacheReadTokens: resp.Usage.CacheReadInputTokens,
	}, nil
}

// mapError turns an SDK error into one of our errors. It logs kind, status,
// error type and request id only: the SDK's error string carries the request.
func mapError(kind string, err error) error {
	if err == nil {
		return nil
	}
	var apierr *anthropic.Error
	if !errors.As(err, &apierr) {
		log.Printf("ai: %s transport error", kind)
		return &BusyError{RetryAfter: defaultRetryAfter}
	}
	log.Printf("ai: %s provider error status=%d type=%s request_id=%s", kind, apierr.StatusCode, apierr.Type(), apierr.RequestID)
	switch s := apierr.StatusCode; {
	case s == 401 || s == 403:
		return ErrKeyRejected
	case s == 402:
		return ErrQuota
	case s == 404:
		return ErrModelUnavailable
	case s == 429 || s == 500 || s == 529 || s >= 500:
		return &BusyError{RetryAfter: retryAfter(apierr.Response)}
	default:
		return ErrBadRequest
	}
}

func retryAfter(resp *http.Response) time.Duration {
	if resp != nil {
		if n, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return defaultRetryAfter
}
