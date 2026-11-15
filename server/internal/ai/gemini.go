package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"
)

// Gemini speaks Google's native generateContent API. BaseURL is
// https://generativelanguage.googleapis.com/v1beta in production; tests pass
// an httptest URL.
type Gemini struct {
	HTTP    *http.Client
	BaseURL string
}

const geminiProvider = "gemini"

func (g *Gemini) client() *http.Client {
	if g.HTTP != nil {
		return g.HTTP
	}
	return NewBuiltinClient(nil)
}

func (g *Gemini) base(cr Credentials) string {
	switch {
	case g.BaseURL != "":
		return g.BaseURL
	case cr.BaseURL != "":
		return cr.BaseURL
	}
	return "https://generativelanguage.googleapis.com/v1beta"
}

// modelPath returns the escaped model segment: one optional leading
// "models/", then an id with no slash and no "..".
func modelPath(model string) (string, bool) {
	m := strings.TrimPrefix(model, "models/")
	if !ValidModelID(m) || strings.Contains(m, "/") || strings.Contains(m, "..") {
		return "", false
	}
	return url.PathEscape(m), true
}

func (g *Gemini) do(ctx context.Context, kind string, cr Credentials, method, path string, body any) ([]byte, error) {
	var rdr *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, ErrBadRequest
		}
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, g.base(cr)+path, rdr)
	if err != nil {
		return nil, ErrBadRequest
	}
	req.Header.Set("x-goog-api-key", cr.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := g.client().Do(req)
	if err != nil {
		if errors.Is(err, ErrEndpointBlocked) {
			log.Printf("ai: %s provider=%s endpoint blocked", kind, geminiProvider)
			return nil, ErrEndpointBlocked
		}
		log.Printf("ai: %s provider=%s transport error", kind, geminiProvider)
		return nil, &BusyError{RetryAfter: defaultRetryAfter}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		eb, _ := readCapped(resp.Body, maxErrorBody)
		return nil, mapGeminiError(kind, resp.StatusCode, eb, resp.Header)
	}
	b, err := readCapped(resp.Body, MaxResponseBytes)
	if err != nil {
		log.Printf("ai: %s provider=%s status=200 code=%s", kind, geminiProvider, Code(err))
	}
	return b, err
}

// mapGeminiError reads the error body for status and details[].reason only;
// nothing from it is logged or returned.
func mapGeminiError(kind string, status int, body []byte, h http.Header) error {
	var parsed struct {
		Error struct {
			Status  string `json:"status"`
			Details []struct {
				Reason string `json:"reason"`
			} `json:"details"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &parsed)
	keyInvalid := false
	for _, d := range parsed.Error.Details {
		if d.Reason == "API_KEY_INVALID" {
			keyInvalid = true
		}
	}
	var err error
	switch {
	case status == 401 || status == 403 || parsed.Error.Status == "PERMISSION_DENIED" || keyInvalid:
		err = ErrKeyRejected
	case status == 402:
		err = ErrQuota
	case status == 404:
		err = ErrModelUnavailable
	case status == 429 || status >= 500:
		err = &BusyError{RetryAfter: retryAfterHeader(h)}
	default:
		err = ErrBadRequest
	}
	log.Printf("ai: %s provider=%s status=%d code=%s", kind, geminiProvider, status, Code(err))
	return err
}

type gemTurn struct {
	Role  string `json:"role"`
	Parts []any  `json:"parts"`
}

func gemText(s string) map[string]any { return map[string]any{"text": s} }

type gemWire struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
		FinishReason string `json:"finishReason"`
	} `json:"candidates"`
	PromptFeedback struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback"`
	ModelVersion  string `json:"modelVersion"`
	UsageMetadata struct {
		Prompt   int64 `json:"promptTokenCount"`
		Output   int64 `json:"candidatesTokenCount"`
		Thoughts int64 `json:"thoughtsTokenCount"`
		Cached   int64 `json:"cachedContentTokenCount"`
	} `json:"usageMetadata"`
}

func (g *Gemini) generate(ctx context.Context, kind, task string, cr Credentials, mp string, contents []gemTurn, budget int) (string, string, Usage, error) {
	body := map[string]any{
		"systemInstruction": map[string]any{"parts": []any{gemText(systemPrompt(task, StructuredSchema))}},
		"contents":          contents,
		"generationConfig": map[string]any{
			"responseMimeType":   "application/json",
			"responseJsonSchema": json.RawMessage(taskSchema(task)),
			"maxOutputTokens":    budget,
		},
	}
	raw, err := g.do(ctx, kind, cr, http.MethodPost, "/models/"+mp+":generateContent", body)
	if err != nil {
		return "", "", Usage{}, err
	}
	var rep gemWire
	if err := json.Unmarshal(raw, &rep); err != nil {
		return "", "", Usage{}, ErrBadReply
	}
	um := rep.UsageMetadata
	usage := Usage{InputTokens: um.Prompt - um.Cached, OutputTokens: um.Output + um.Thoughts, CacheReadTokens: um.Cached}
	if rep.PromptFeedback.BlockReason != "" {
		log.Printf("ai: %s provider=%s blocked", kind, geminiProvider)
		return "", rep.ModelVersion, usage, ErrRefused
	}
	if len(rep.Candidates) == 0 {
		return "", rep.ModelVersion, usage, ErrBadReply
	}
	c := rep.Candidates[0]
	switch c.FinishReason {
	case "MAX_TOKENS":
		return "", rep.ModelVersion, usage, ErrTruncated
	case "SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY":
		log.Printf("ai: %s provider=%s finish=%s", kind, geminiProvider, c.FinishReason)
		return "", rep.ModelVersion, usage, ErrRefused
	}
	var sb strings.Builder
	for _, p := range c.Content.Parts {
		sb.WriteString(p.Text)
	}
	return sb.String(), rep.ModelVersion, usage, nil
}

func (g *Gemini) run(ctx context.Context, task string, cr Credentials, first []any, userText string, budget int, dst any, required []string) (string, Usage, []CallUsage, error) {
	mp, ok := modelPath(cr.Model)
	if !ok {
		return "", Usage{}, nil, ErrBadRequest
	}
	contents := []gemTurn{{Role: "user", Parts: first}}
	text, model, usage, err := g.generate(ctx, task, task, cr, mp, contents, budget)
	total := usage
	var calls []CallUsage
	if model != "" || usage != (Usage{}) || err == nil {
		calls = append(calls, CallUsage{Kind: task, Usage: usage})
	}
	if err != nil {
		return model, total, calls, err
	}
	derr := decodeStrict(text, dst, required)
	if derr == nil {
		return model, total, calls, nil
	}
	// The repair turn is text only: the photo is not sent a second time.
	contents = []gemTurn{{Role: "user", Parts: []any{gemText(userText)}}, {Role: "model", Parts: []any{gemText(text)}}, {Role: "user", Parts: []any{gemText(repairMessage(text, derr))}}}
	text, m2, usage, err := g.generate(ctx, task+"-repair", task, cr, mp, contents, budget)
	total.add(usage)
	calls = append(calls, CallUsage{Kind: task + "-repair", Usage: usage})
	if m2 != "" {
		model = m2
	}
	if err != nil {
		return model, total, calls, err
	}
	if derr := decodeStrict(text, dst, required); derr != nil {
		log.Printf("ai: %s provider=%s code=bad_reply after repair", task, geminiProvider)
		return model, total, calls, ErrBadReply
	}
	return model, total, calls, nil
}

func (g *Gemini) Review(ctx context.Context, cr Credentials, r ReviewRequest) (ReviewReply, error) {
	var out reviewWire
	msgR := reviewUserMessage(r, newNonce())
	model, usage, calls, err := g.run(ctx, "review", cr, []any{gemText(msgR)}, msgR, 16000, &out, []string{"annotations", "overall"})
	rep := ReviewReply{Overall: out.Overall, Model: model, Usage: usage, Calls: calls}
	if err != nil {
		return rep, err
	}
	for _, a := range out.Annotations {
		rep.Annotations = append(rep.Annotations, RawAnnotation{Quote: a.Quote, ContextBefore: a.ContextBefore, Correction: a.Correction, Explanation: a.Explanation, Category: a.Category})
	}
	return rep, nil
}

func (g *Gemini) Suggest(ctx context.Context, cr Credentials, r SuggestRequest) (SuggestReply, error) {
	var out suggestWire
	msgS := suggestUserMessage(r, newNonce())
	model, usage, calls, err := g.run(ctx, "suggest", cr, []any{gemText(msgS)}, msgS, 4000, &out, []string{"items"})
	return SuggestReply{Items: out.Items, Model: model, Usage: usage, Calls: calls}, err
}

func (g *Gemini) Transcribe(ctx context.Context, cr Credentials, r TranscribeRequest) (TranscribeReply, error) {
	if r.MediaType != "image/jpeg" {
		return TranscribeReply{}, ErrBadRequest
	}
	parts := []any{
		map[string]any{"inlineData": map[string]any{"mimeType": "image/jpeg", "data": base64.StdEncoding.EncodeToString(r.Image)}},
		gemText(transcribeUserMessage(r)),
	}
	var out transcribeWire
	model, usage, calls, err := g.run(ctx, "transcribe", cr, parts, transcribeUserMessage(r), 8000, &out, []string{"text", "unreadable"})
	return TranscribeReply{Text: out.Text, Unreadable: out.Unreadable, Model: model, Usage: usage, Calls: calls}, err
}

// Validate asks for the model: free, 400/403 for a bad key, 404 for an
// unavailable model.
func (g *Gemini) Validate(ctx context.Context, cr Credentials) error {
	mp, ok := modelPath(cr.Model)
	if !ok {
		return ErrBadRequest
	}
	_, err := g.do(ctx, "validate", cr, http.MethodGet, "/models/"+mp, nil)
	return err
}
