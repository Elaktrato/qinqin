package ai

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestBuiltinIDsFrozen(t *testing.T) {
	var ids []string
	for _, p := range Builtins() {
		ids = append(ids, p.ID)
	}
	want := []string{"anthropic", "openai", "gemini", "deepseek", "mistral", "xai", "groq", "openrouter"}
	if !reflect.DeepEqual(ids, want) {
		t.Errorf("ids = %v, want %v", ids, want)
	}
}

func TestBuiltinBaseURLsHTTPS(t *testing.T) {
	for _, p := range Builtins() {
		u, err := CheckEndpointURL(p.BaseURL, GuardPolicy{})
		if err != nil {
			t.Errorf("%s: base URL %q: %v", p.ID, p.BaseURL, err)
			continue
		}
		if u.Scheme != "https" || strings.HasSuffix(p.BaseURL, "/") {
			t.Errorf("%s: base URL %q", p.ID, p.BaseURL)
		}
		if p.Custom || !p.KeyRequired || p.Name == "" || p.KeyURL == "" || !strings.HasPrefix(p.KeyURL, "https://") {
			t.Errorf("%s: %+v", p.ID, p)
		}
	}
	byID := map[string]ProviderSpec{}
	for _, p := range Builtins() {
		byID[p.ID] = p
	}
	if byID["gemini"].BaseURL != "https://generativelanguage.googleapis.com/v1beta" || byID["gemini"].Kind != KindGemini {
		t.Errorf("gemini = %+v", byID["gemini"])
	}
	if byID["anthropic"].Kind != KindAnthropic || byID["openai"].TokenField != "max_completion_tokens" || byID["deepseek"].TokenField != "max_tokens" {
		t.Error("kind or token field wrong")
	}
	if byID["deepseek"].Structured != StructuredObject || byID["openai"].Structured != StructuredSchema || !byID["openai"].Strict || byID["mistral"].Strict {
		t.Error("structured modes wrong")
	}
	or := byID["openrouter"]
	if or.ValidateBy != "chat" || or.Extra["provider"] == nil {
		t.Errorf("openrouter = %+v", or)
	}
}

func TestDefaultModelInModels(t *testing.T) {
	for _, p := range Builtins() {
		found := false
		for _, m := range p.Models {
			if !ValidModelID(m.ID) || m.Label == "" {
				t.Errorf("%s: bad model %+v", p.ID, m)
			}
			found = found || m.ID == p.DefaultModel
		}
		if !found {
			t.Errorf("%s: default %q not in Models", p.ID, p.DefaultModel)
		}
	}
	for _, p := range Builtins() {
		if p.ID == "anthropic" {
			if p.DefaultModel != DefaultModel || len(p.Models) != len(Models) {
				t.Errorf("anthropic registry entry drifted from provider.go: %+v", p)
			}
		}
	}
}

func TestVisionFor(t *testing.T) {
	var ds, an ProviderSpec
	for _, p := range Builtins() {
		switch p.ID {
		case "deepseek":
			ds = p
		case "anthropic":
			an = p
		}
	}
	if ds.VisionFor("deepseek-v4-pro") {
		t.Error("deepseek-v4-pro reads photos")
	}
	if !ds.VisionFor("deepseek-flash") {
		t.Error("deepseek-flash cannot read photos")
	}
	if !ds.VisionFor("deepseek-some-new-model") {
		t.Error("free-text model must inherit the provider flag (true)")
	}
	if !an.VisionFor("claude-opus-5-5") {
		t.Error("anthropic")
	}
	if (ProviderSpec{Vision: false}).VisionFor("x") {
		t.Error("custom no-vision inherited as vision")
	}
}

func TestSpecJSONHidesInternals(t *testing.T) {
	b, err := json.Marshal(Builtins()[7]) // openrouter: has Extra
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, bad := range []string{"require_parameters", "TokenField", "max_tokens", "validateBy", "Extra"} {
		if strings.Contains(s, bad) {
			t.Errorf("JSON exposes %q: %s", bad, s)
		}
	}
	for _, want := range []string{`"id":"openrouter"`, `"name":"OpenRouter"`, `"keyRequired":true`, `"defaultModel":"openrouter/auto"`} {
		if !strings.Contains(s, want) {
			t.Errorf("JSON lacks %s: %s", want, s)
		}
	}
}

func TestLookupUnknown(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	r := &Registry{Custom: &CustomStore{DB: sqlDB}}
	ctx := context.Background()
	for _, id := range []string{"nope", "", "custom-aaaaaaaaaa", "OpenAI"} {
		if _, err := r.Lookup(ctx, id); !errors.Is(err, ErrUnknownProvider) {
			t.Errorf("Lookup(%q) = %v, want ErrUnknownProvider", id, err)
		}
	}
	if p, err := r.Lookup(ctx, "openai"); err != nil || p.ID != "openai" {
		t.Errorf("Lookup(openai) = %+v, %v", p, err)
	}
	if _, err := (&Registry{}).Lookup(ctx, "custom-aaaaaaaaaa"); !errors.Is(err, ErrUnknownProvider) {
		t.Errorf("without a custom store: %v", err)
	}
}

func TestLookupDisabled(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	cs := &CustomStore{DB: sqlDB}
	ctx := context.Background()
	c, err := cs.Create(ctx, 1, CustomInput{Name: "Local", BaseURL: "https://llm.example.com/v1", DefaultModel: "m"})
	if err != nil {
		t.Fatal(err)
	}
	r := &Registry{Custom: cs, Enabled: map[string]bool{"anthropic": true}}
	if _, err := r.Lookup(ctx, "openai"); !errors.Is(err, ErrProviderDisabled) {
		t.Errorf("openai = %v, want ErrProviderDisabled", err)
	}
	if _, err := r.Lookup(ctx, c.ID); !errors.Is(err, ErrProviderDisabled) {
		t.Errorf("custom = %v, want ErrProviderDisabled", err)
	}
	if _, err := r.Lookup(ctx, "anthropic"); err != nil {
		t.Errorf("anthropic: %v", err)
	}
	all, err := r.All(ctx)
	if err != nil || len(all) != 1 || all[0].ID != "anthropic" {
		t.Errorf("All = %+v, %v", all, err)
	}
	if r.IsEnabled("openai") || !r.IsEnabled("anthropic") || r.IsEnabled(c.ID) || r.IsEnabled("custom") {
		t.Error("IsEnabled")
	}

	r = &Registry{Custom: cs, Enabled: map[string]bool{"custom": true, "openai": true}}
	if sp, err := r.Lookup(ctx, c.ID); err != nil || sp.ID != c.ID {
		t.Errorf("custom enabled: %+v, %v", sp, err)
	}
	all, _ = r.All(ctx)
	if len(all) != 2 || all[0].ID != "openai" || all[1].ID != c.ID {
		t.Errorf("All = %+v", all)
	}
	if !r.IsEnabled(c.ID) || !r.IsEnabled("custom-zzzzzzzzzz") {
		t.Error("custom ids follow the custom key")
	}

	r = &Registry{Custom: cs} // nil = all
	all, _ = r.All(ctx)
	if len(all) != 9 {
		t.Errorf("All with nil Enabled = %d, want 9", len(all))
	}
}
