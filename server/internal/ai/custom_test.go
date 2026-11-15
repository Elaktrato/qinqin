package ai

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"
)

func newCustom(t *testing.T) (*CustomStore, *sql.DB) {
	t.Helper()
	sqlDB, _ := openTestDB(t)
	return &CustomStore{DB: sqlDB, Now: time.Now}, sqlDB
}

func validInput() CustomInput {
	return CustomInput{Name: "Company gateway", BaseURL: "https://llm.example.com/v1", DefaultModel: "llama3.2:3b", Vision: true, KeyRequired: true, Structured: StructuredSchema}
}

func TestCustomIDFormat(t *testing.T) {
	cs, _ := newCustom(t)
	ctx := context.Background()
	re := regexp.MustCompile(`^custom-[a-z2-7]{10}$`)
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		in := validInput()
		in.Name = "Endpoint " + strings.Repeat("x", i%5) + string(rune('A'+i/5)) + string(rune('a'+i%5))
		sp, err := cs.Create(ctx, 1, in)
		if err != nil {
			t.Fatal(err)
		}
		if !re.MatchString(sp.ID) || seen[sp.ID] {
			t.Fatalf("id %q malformed or reused", sp.ID)
		}
		seen[sp.ID] = true
	}
}

func TestCustomCreateAndSpec(t *testing.T) {
	cs, _ := newCustom(t)
	ctx := context.Background()
	in := validInput()
	in.BaseURL = "https://llm.example.com/v1/"
	max := 4096
	in.MaxOutputTokens = &max
	sp, err := cs.Create(ctx, 7, in)
	if err != nil {
		t.Fatal(err)
	}
	if !sp.Custom || sp.Kind != KindOpenAI || sp.Name != "Company gateway" || sp.BaseURL != "https://llm.example.com/v1" ||
		sp.DefaultModel != "llama3.2:3b" || !sp.Vision || !sp.KeyRequired || sp.Structured != StructuredSchema || sp.MaxOutputTokens != 4096 || sp.Strict {
		t.Errorf("spec = %+v", sp)
	}
	if len(sp.Models) != 1 || sp.Models[0].ID != "llama3.2:3b" {
		t.Errorf("models = %+v", sp.Models)
	}
	got, err := cs.Get(ctx, sp.ID)
	if err != nil || got.BaseURL != sp.BaseURL || got.Name != sp.Name || got.MaxOutputTokens != 4096 {
		t.Errorf("Get = %+v, %v", got, err)
	}
	var createdBy int64
	if err := cs.DB.QueryRow(`SELECT created_by FROM ai_custom_providers WHERE id = ?`, sp.ID).Scan(&createdBy); err != nil || createdBy != 7 {
		t.Errorf("created_by = %d, %v", createdBy, err)
	}
	// An empty structured mode defaults to json_object (the safe default).
	in = validInput()
	in.Name, in.Structured = "Second", ""
	sp2, err := cs.Create(ctx, 7, in)
	if err != nil || sp2.Structured != StructuredObject {
		t.Errorf("default structured = %q, %v", sp2.Structured, err)
	}
	if list, err := cs.List(ctx); err != nil || len(list) != 2 || list[0].ID != sp.ID {
		t.Errorf("List = %+v, %v", list, err)
	}
}

func TestCustomNameRules(t *testing.T) {
	cs, _ := newCustom(t)
	ctx := context.Background()
	create := func(name string) error {
		in := validInput()
		in.Name = name
		_, err := cs.Create(ctx, 1, in)
		return err
	}
	for _, name := range []string{"", "   ", strings.Repeat("a", 41), "bad\x00name", "tab\tname", "new\nline",
		"openai", "OpenAI", "OPENAI", "Open AI", "open-ai", "Google Gemini", "google gemini", "Anthropic", "xAI", "XAI", "deepseek", "Groq", "OpenRouter", "Mistral", "gemini"} {
		if err := create(name); !errors.Is(err, ErrInvalidEndpoint) {
			t.Errorf("name %q accepted (err %v)", name, err)
		}
	}
	if err := create(strings.Repeat("ä", 40)); err != nil {
		t.Errorf("40 runes rejected: %v", err)
	}
	if err := create("OpenAI (EU gateway)"); err != nil {
		t.Errorf("distinct name rejected: %v", err)
	}
	if err := create("Local Ollama"); err != nil {
		t.Fatal(err)
	}
	if err := create("local ollama"); !errors.Is(err, ErrInvalidEndpoint) {
		t.Errorf("duplicate name (case-insensitive) = %v", err)
	}
}

func TestCustomInputRules(t *testing.T) {
	cs, _ := newCustom(t)
	ctx := context.Background()
	bad := func(mut func(*CustomInput)) error {
		in := validInput()
		mut(&in)
		_, err := cs.Create(ctx, 1, in)
		return err
	}
	if err := bad(func(in *CustomInput) { in.BaseURL = "http://169.254.169.254/v1" }); !errors.Is(err, ErrEndpointBlocked) {
		t.Errorf("metadata = %v", err)
	}
	if err := bad(func(in *CustomInput) { in.BaseURL = "http://127.0.0.1:11434/v1" }); !errors.Is(err, ErrEndpointBlocked) {
		t.Errorf("loopback without switch = %v", err)
	}
	if err := bad(func(in *CustomInput) { in.BaseURL = "https://x.example/v1?k=1" }); !errors.Is(err, ErrEndpointBlocked) {
		t.Errorf("query = %v", err)
	}
	for _, m := range []string{"", "a b", "-x", strings.Repeat("a", 201)} {
		if err := bad(func(in *CustomInput) { in.DefaultModel = m }); !errors.Is(err, ErrInvalidEndpoint) {
			t.Errorf("model %q = %v", m, err)
		}
	}
	if err := bad(func(in *CustomInput) { in.Structured = "xml" }); !errors.Is(err, ErrInvalidEndpoint) {
		t.Errorf("structured = %v", err)
	}
	for _, n := range []int{0, -1, 1_000_001} {
		n := n
		if err := bad(func(in *CustomInput) { in.MaxOutputTokens = &n }); !errors.Is(err, ErrInvalidEndpoint) {
			t.Errorf("max tokens %d = %v", n, err)
		}
	}
	// With the switch, a loopback endpoint is fine (Ollama).
	cs.Policy = GuardPolicy{AllowPrivate: true}
	in := validInput()
	in.Name, in.BaseURL, in.KeyRequired = "Ollama", "http://127.0.0.1:11434/v1", false
	if sp, err := cs.Create(ctx, 1, in); err != nil || sp.KeyRequired {
		t.Errorf("ollama = %+v, %v", sp, err)
	}
	in.Name, in.BaseURL = "Meta", "http://169.254.169.254/v1"
	if _, err := cs.Create(ctx, 1, in); !errors.Is(err, ErrEndpointBlocked) {
		t.Errorf("metadata with switch = %v", err)
	}
}

func TestCustomUpdateCannotChangeURL(t *testing.T) {
	cs, _ := newCustom(t)
	ctx := context.Background()
	sp, err := cs.Create(ctx, 1, validInput())
	if err != nil {
		t.Fatal(err)
	}
	m, v, s, max := "new-model", false, StructuredObject, 2000
	up, err := cs.Update(ctx, sp.ID, CustomPatch{DefaultModel: &m, Vision: &v, Structured: &s, MaxOutputTokens: &max})
	if err != nil {
		t.Fatal(err)
	}
	if up.DefaultModel != "new-model" || up.Vision || up.Structured != StructuredObject || up.MaxOutputTokens != 2000 {
		t.Errorf("updated = %+v", up)
	}
	if up.BaseURL != sp.BaseURL || up.Name != sp.Name || up.KeyRequired != sp.KeyRequired || up.ID != sp.ID {
		t.Errorf("immutable fields changed: %+v vs %+v", up, sp)
	}
	got, _ := cs.Get(ctx, sp.ID)
	if got.BaseURL != sp.BaseURL || got.Name != sp.Name || got.DefaultModel != "new-model" {
		t.Errorf("stored = %+v", got)
	}
	// An empty patch changes nothing; bad values and unknown ids are refused.
	if same, err := cs.Update(ctx, sp.ID, CustomPatch{}); err != nil || same.DefaultModel != "new-model" {
		t.Errorf("empty patch = %+v, %v", same, err)
	}
	bad := "a b"
	if _, err := cs.Update(ctx, sp.ID, CustomPatch{DefaultModel: &bad}); !errors.Is(err, ErrInvalidEndpoint) {
		t.Errorf("bad model = %v", err)
	}
	if _, err := cs.Update(ctx, "custom-aaaaaaaaaa", CustomPatch{Vision: &v}); !errors.Is(err, ErrUnknownProvider) {
		t.Errorf("unknown = %v", err)
	}
}

func TestCustomDelete(t *testing.T) {
	cs, _ := newCustom(t)
	ctx := context.Background()
	sp, _ := cs.Create(ctx, 1, validInput())
	if err := cs.Delete(ctx, sp.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := cs.Get(ctx, sp.ID); !errors.Is(err, ErrUnknownProvider) {
		t.Errorf("Get after delete = %v", err)
	}
	if err := cs.Delete(ctx, sp.ID); !errors.Is(err, ErrUnknownProvider) {
		t.Errorf("second delete = %v", err)
	}
	if list, _ := cs.List(ctx); len(list) != 0 {
		t.Errorf("List = %+v", list)
	}
}
