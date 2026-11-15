package ai

import (
	"context"
	"errors"
	"strings"
)

// Kind picks the adapter family of a provider.
type Kind string

const (
	KindAnthropic Kind = "anthropic"
	KindOpenAI    Kind = "openai" // Chat Completions shape: OpenAI and compatible APIs
	KindGemini    Kind = "gemini" // native generateContent
)

// Structured is how a provider is asked for JSON.
type Structured string

const (
	StructuredSchema Structured = "json_schema" // response_format json_schema
	StructuredObject Structured = "json_object" // json mode, schema in the system prompt
	StructuredPrompt Structured = "prompt"      // no response_format, schema in the system prompt
)

func (s Structured) valid() bool {
	return s == StructuredSchema || s == StructuredObject || s == StructuredPrompt
}

var (
	ErrUnknownProvider  = errors.New("ai: unknown provider")
	ErrProviderDisabled = errors.New("ai: provider turned off by the server")
)

// ModelSpec is a suggested model. Vision nil inherits the provider's flag.
type ModelSpec struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Vision *bool  `json:"vision,omitempty"`
}

// ProviderSpec describes one provider, built in or custom. The JSON form is
// what the API shows; fields tagged "-" stay on the server.
type ProviderSpec struct {
	ID              string         `json:"id"`
	Name            string         `json:"name"`
	Kind            Kind           `json:"kind"`
	BaseURL         string         `json:"baseUrl,omitempty"` // the handler drops it for non-admins
	Custom          bool           `json:"custom"`
	KeyRequired     bool           `json:"keyRequired"`
	KeyURL          string         `json:"keyUrl,omitempty"`
	DefaultModel    string         `json:"defaultModel"`
	Models          []ModelSpec    `json:"models"`
	Structured      Structured     `json:"structured"`
	Strict          bool           `json:"-"`
	Vision          bool           `json:"vision"`
	TokenField      string         `json:"-"`
	MaxOutputTokens int            `json:"maxOutputTokens,omitempty"`
	ValidateBy      string         `json:"-"` // "models" | "model" | "chat"
	Extra           map[string]any `json:"-"` // fixed request fields
}

// VisionFor reports whether model reads photos: a registry override wins,
// any other id (free text included) inherits the provider's flag.
func (p ProviderSpec) VisionFor(model string) bool {
	for _, m := range p.Models {
		if m.ID == model && m.Vision != nil {
			return *m.Vision
		}
	}
	return p.Vision
}

func ptr[T any](v T) *T { return &v }

// Builtins are the providers the server knows. Ids are frozen: they are part
// of every stored key's additional data.
//
// Model ids marked UNVERIFIED were not confirmed against the provider's own
// documentation on 2026-11-15; the owner's real-key run confirms them.
func Builtins() []ProviderSpec {
	anthropicModels := make([]ModelSpec, 0, len(Models))
	for _, m := range Models {
		anthropicModels = append(anthropicModels, ModelSpec{ID: m.ID, Label: m.Label})
	}
	return []ProviderSpec{
		{ID: "anthropic", Name: "Anthropic", Kind: KindAnthropic, BaseURL: "https://api.anthropic.com", KeyRequired: true,
			KeyURL: "https://platform.claude.com/settings/keys", DefaultModel: DefaultModel, Models: anthropicModels,
			Structured: StructuredSchema, Strict: true, Vision: true, ValidateBy: "model"},
		{ID: "openai", Name: "OpenAI", Kind: KindOpenAI, BaseURL: "https://api.openai.com/v1", KeyRequired: true,
			KeyURL: "https://platform.openai.com/api-keys", DefaultModel: "gpt-6-astra",
			Models: []ModelSpec{
				{ID: "gpt-6-astra", Label: "GPT-6 Astra"},
				{ID: "gpt-6-luna", Label: "GPT-6 Luna"}, // UNVERIFIED 2026-11-15 (cheapest per the docs list; image data URLs unverified for OpenAI)
			},
			Structured: StructuredSchema, Strict: true, Vision: true, TokenField: "max_completion_tokens", ValidateBy: "models"},
		{ID: "gemini", Name: "Google Gemini", Kind: KindGemini, BaseURL: "https://generativelanguage.googleapis.com/v1beta", KeyRequired: true,
			KeyURL: "https://aistudio.google.com/apikey", DefaultModel: "gemini-3.8-flash",
			Models: []ModelSpec{
				{ID: "gemini-3.8-flash", Label: "Gemini 3.8 Flash"},
				{ID: "gemini-3.5-flash-lite", Label: "Gemini 3.5 Flash-Lite"},
			},
			Structured: StructuredSchema, Vision: true, ValidateBy: "model"}, // UNVERIFIED 2026-11-15: REST field generationConfig.responseJsonSchema
		{ID: "deepseek", Name: "DeepSeek", Kind: KindOpenAI, BaseURL: "https://api.deepseek.com", KeyRequired: true,
			KeyURL: "https://platform.deepseek.com/api_keys", DefaultModel: "deepseek-flash",
			Models: []ModelSpec{
				{ID: "deepseek-flash", Label: "DeepSeek Flash", Vision: ptr(true)},
				{ID: "deepseek-v4-pro", Label: "DeepSeek V4 Pro", Vision: ptr(false)},
			},
			Structured: StructuredObject, Vision: true, TokenField: "max_tokens", ValidateBy: "models"}, // UNVERIFIED 2026-11-15: /models
		{ID: "mistral", Name: "Mistral", Kind: KindOpenAI, BaseURL: "https://api.mistral.ai/v1", KeyRequired: true,
			KeyURL: "https://console.mistral.ai/api-keys", DefaultModel: "mistral-large-latest",
			Models: []ModelSpec{
				{ID: "mistral-large-latest", Label: "Mistral Large", Vision: ptr(true)}, // UNVERIFIED 2026-11-15
				{ID: "mistral-small-latest", Label: "Mistral Small", Vision: ptr(true)}, // UNVERIFIED 2026-11-15
			},
			Structured: StructuredSchema, Vision: true, TokenField: "max_tokens", ValidateBy: "models"},
		{ID: "xai", Name: "xAI", Kind: KindOpenAI, BaseURL: "https://api.x.ai/v1", KeyRequired: true,
			KeyURL: "https://console.x.ai", DefaultModel: "grok-4.7",
			Models:     []ModelSpec{{ID: "grok-4.7", Label: "Grok 4.7"}}, // UNVERIFIED 2026-11-15: vision
			Structured: StructuredSchema, Strict: true, Vision: true, TokenField: "max_tokens", ValidateBy: "models"},
		{ID: "groq", Name: "Groq", Kind: KindOpenAI, BaseURL: "https://api.groq.com/openai/v1", KeyRequired: true,
			KeyURL: "https://console.groq.com/keys", DefaultModel: "openai/gpt-oss-120b",
			Models:     []ModelSpec{{ID: "openai/gpt-oss-120b", Label: "GPT-OSS 120B"}},
			Structured: StructuredSchema, Vision: false, TokenField: "max_tokens", ValidateBy: "models"}, // strict only on some models: sent non-strict
		{ID: "openrouter", Name: "OpenRouter", Kind: KindOpenAI, BaseURL: "https://openrouter.ai/api/v1", KeyRequired: true,
			KeyURL: "https://openrouter.ai/keys", DefaultModel: "openrouter/auto",
			Models:     []ModelSpec{{ID: "openrouter/auto", Label: "Auto router"}}, // UNVERIFIED 2026-11-15: vision depends on the routed model
			Structured: StructuredSchema, Vision: true, TokenField: "max_tokens", ValidateBy: "chat",
			Extra: map[string]any{"provider": map[string]any{"require_parameters": true}}},
	}
}

// Registry resolves provider ids to specs and applies the operator's
// QINQIN_AI_PROVIDERS restriction.
type Registry struct {
	Custom *CustomStore
	// Enabled lists the usable provider ids; nil means all. The key "custom"
	// covers every custom endpoint.
	Enabled map[string]bool
}

// IsEnabled reports whether the operator allows the provider id.
func (r *Registry) IsEnabled(id string) bool {
	if r.Enabled == nil {
		return true
	}
	if strings.HasPrefix(id, customIDPrefix) {
		return r.Enabled["custom"]
	}
	return r.Enabled[id]
}

// Lookup returns the spec for id: ErrUnknownProvider, or ErrProviderDisabled
// for a known provider the server turned off.
func (r *Registry) Lookup(ctx context.Context, id string) (ProviderSpec, error) {
	for _, b := range Builtins() {
		if b.ID == id {
			if !r.IsEnabled(id) {
				return ProviderSpec{}, ErrProviderDisabled
			}
			return b, nil
		}
	}
	if r.Custom == nil || !strings.HasPrefix(id, customIDPrefix) {
		return ProviderSpec{}, ErrUnknownProvider
	}
	sp, err := r.Custom.Get(ctx, id)
	if err != nil {
		return ProviderSpec{}, err
	}
	if !r.IsEnabled(id) {
		return ProviderSpec{}, ErrProviderDisabled
	}
	return sp, nil
}

// All lists the enabled providers: built-ins first, then custom endpoints.
func (r *Registry) All(ctx context.Context) ([]ProviderSpec, error) {
	var out []ProviderSpec
	for _, b := range Builtins() {
		if r.IsEnabled(b.ID) {
			out = append(out, b)
		}
	}
	if r.Custom != nil && r.IsEnabled(customIDPrefix) {
		list, err := r.Custom.List(ctx)
		if err != nil {
			return nil, err
		}
		out = append(out, list...)
	}
	return out, nil
}
