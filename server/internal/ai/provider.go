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
type RawAnnotation struct{ Quote, ContextBefore, Correction, Explanation, Category string }

// Overall is the summary part of a review.
type Overall struct {
	Summary   string   `json:"summary"`
	Strengths []string `json:"strengths"`
	Focus     []string `json:"focus"`
}

// ReviewRequest asks for a review; languages are codes such as "zh" or "en".
type ReviewRequest struct{ Language, ExplanationLanguage, Guidance, Text string }

// ReviewReply is the unvalidated answer.
type ReviewReply struct {
	Annotations []RawAnnotation
	Overall     Overall
	Model       string
	Usage       Usage
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
}

// Provider is an AI backend; Claude is the only real implementation.
type Provider interface {
	Validate(ctx context.Context, c Credentials) error
	Review(ctx context.Context, c Credentials, r ReviewRequest) (ReviewReply, error)
	Suggest(ctx context.Context, c Credentials, r SuggestRequest) (SuggestReply, error)
	Transcribe(ctx context.Context, c Credentials, r TranscribeRequest) (TranscribeReply, error)
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
	case errors.Is(err, ErrRefused):
		return "refused"
	case errors.Is(err, ErrTruncated):
		return "truncated"
	case errors.Is(err, ErrBadReply):
		return "bad_reply"
	case errors.Is(err, ErrBadRequest):
		return "bad_request"
	case errors.As(err, &rl):
		return "rate_limited"
	case errors.Is(err, ErrInFlight):
		return "in_flight"
	}
	return ""
}
