package ai

import (
	"context"
	"errors"
	"time"
)

// DefaultModel is the model a new key starts with.
const DefaultModel = "claude-opus-5-5"

// ModelInfo is a selectable model.
type ModelInfo struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// Models are the only model ids the server accepts, as plain strings.
var Models = []ModelInfo{
	{"claude-opus-5-5", "Claude Opus 5.5"},
	{"claude-sonnet-5-5", "Claude Sonnet 5.5"},
	{"claude-haiku-5-5", "Claude Haiku 5.5"},
}

// Usage counts the tokens of one provider call.
type Usage struct{ InputTokens, OutputTokens, CacheReadTokens int64 }

// RawAnnotation is one model-proposed correction, before server validation.
type RawAnnotation struct{ Quote, ContextBefore, Correction, Explanation, Category, Kind string }

// Overall is the summary part of a review.
type Overall struct {
	Summary   string   `json:"summary"`
	Strengths []string `json:"strengths"`
	Focus     []string `json:"focus"`
}

// ReviewRequest asks for a review; languages are codes such as "zh" or "en".
type ReviewRequest struct{ Language, ExplanationLanguage, Guidance, Text string }

// CallUsage is one provider call an action made: Kind is the action ("review")
// or its repair ("review-repair"). Adapters that make more than one call
// list every call so each gets its own ai_calls row; Usage on the reply is
// their sum.
type CallUsage struct {
	Kind  string
	Usage Usage
}

// ReviewReply is the unvalidated answer.
type ReviewReply struct {
	Annotations []RawAnnotation
	Overall     Overall
	Model       string
	Usage       Usage
	Calls       []CallUsage
	// FallbackFrom is the requested model when the Anthropic adapter was
	// served by a different one (refusal fallback); other adapters leave it empty.
	FallbackFrom string
}

// CallResult is what a provider call reports back to the caller that records it.
type CallResult struct {
	Model string
	Usage Usage
	Calls []CallUsage
}

// EntrySummary is what a suggestion request sends about a past entry.
type EntrySummary struct{ Title, Opening string }

// SuggestRequest asks for topic ideas from studied words and recent entries.
type SuggestRequest struct {
	Language, ExplanationLanguage string
	Words                         []string
	Recent                        []EntrySummary
}

// SuggestionItem is one topic idea.
type SuggestionItem struct {
	Title  string   `json:"title"`
	Prompt string   `json:"prompt"`
	Words  []string `json:"words"`
}

// SuggestReply is the unvalidated answer.
type SuggestReply struct {
	Items []SuggestionItem
	Model string
	Usage Usage
	Calls []CallUsage
}

// TranscribeRequest sends one photo; MediaType is "image/jpeg" after the
// server has re-encoded it.
type TranscribeRequest struct {
	Language  string
	Image     []byte
	MediaType string
}

// TranscribeReply is the transcription draft.
type TranscribeReply struct {
	Text       string
	Unreadable bool
	Model      string
	Usage      Usage
	Calls      []CallUsage
}

// Provider is an AI backend; Claude is the only real implementation.
type Provider interface {
	Validate(ctx context.Context, c Credentials) error
	Review(ctx context.Context, c Credentials, r ReviewRequest) (ReviewReply, error)
	Suggest(ctx context.Context, c Credentials, r SuggestRequest) (SuggestReply, error)
	Transcribe(ctx context.Context, c Credentials, r TranscribeRequest) (TranscribeReply, error)
	Converse(ctx context.Context, c Credentials, r ConverseRequest) (ConverseReply, error)
}

// CallCounter is implemented by adapters whose key check may take more than
// one provider call (a custom endpoint without /models falls back to a chat
// call), so the limiter can count each.
type CallCounter interface {
	ValidateCounted(ctx context.Context, c Credentials) (calls int, err error)
}

// Provider errors. Wrap them with %w; Code maps them to the API code.
var (
	ErrKeyRejected      = errors.New("ai: the provider rejected the key")
	ErrQuota            = errors.New("ai: the provider account has no quota left")
	ErrBusy             = errors.New("ai: the provider is busy")
	ErrModelUnavailable = errors.New("ai: the model is not available for this key")
	ErrRefused          = errors.New("ai: the model refused the request")
	ErrTruncated        = errors.New("ai: the reply was cut off")
	ErrBadReply         = errors.New("ai: the reply could not be read")
	ErrBadRequest       = errors.New("ai: the provider rejected the request")
	ErrNoAccess         = errors.New("ai: the key has no access to this model or action")
)

// BusyError is ErrBusy with the wait the provider asked for.
type BusyError struct{ RetryAfter time.Duration }

func (e *BusyError) Error() string        { return ErrBusy.Error() }
func (e *BusyError) Is(target error) bool { return target == ErrBusy }

// Code maps an error to its API code, or "" when it is not one of ours.
func Code(err error) string {
	var rl *RateLimitedError
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ErrKeyRejected):
		return "key_rejected"
	case errors.Is(err, ErrQuota):
		return "quota"
	case errors.Is(err, ErrBusy):
		return "busy"
	case errors.Is(err, ErrModelUnavailable):
		return "model_unavailable"
	case errors.Is(err, ErrNoAccess):
		return "no_access"
	case errors.Is(err, ErrRefused):
		return "refused"
	case errors.Is(err, ErrTruncated):
		return "truncated"
	case errors.Is(err, ErrBadReply):
		return "bad_reply"
	case errors.Is(err, ErrBadRequest):
		return "bad_request"
	case errors.Is(err, ErrEndpointBlocked):
		return "endpoint_blocked"
	case errors.Is(err, ErrUnknownProvider):
		return "unknown_provider"
	case errors.Is(err, ErrProviderDisabled):
		return "provider_disabled"
	case errors.Is(err, ErrNoSelection):
		return "no_selection"
	case errors.As(err, &rl):
		return "rate_limited"
	case errors.Is(err, ErrInFlight):
		return "in_flight"
	}
	return ""
}
