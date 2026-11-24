// Package aitest holds fake provider HTTP servers with canned replies, for
// tests and the fakeai tool. They never contact a real provider.
package aitest

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"
)

// Request is what a fake server saw. Auth holds the Authorization (or
// x-goog-api-key) header so tests can assert it; tools must not print it.
type Request struct {
	Method, Path string
	Auth         string
	Body         []byte
}

// OpenAI is a fake OpenAI-compatible server: GET /models and POST
// /chat/completions. A key containing "bad" is answered 401, like ai.Fake;
// the markers [[fake:401]], [[fake:quota]], [[fake:busy]] and
// [[fake:refusal]] in the request pick a canned failure.
type OpenAI struct {
	Models []string // default: fake-model

	mu   sync.Mutex
	seen []Request
}

// Requests returns a copy of what the server saw.
func (f *OpenAI) Requests() []Request {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Request(nil), f.seen...)
}

func (f *OpenAI) record(r *http.Request, body []byte) Request {
	rec := Request{Method: r.Method, Path: r.URL.Path, Auth: r.Header.Get("Authorization"), Body: body}
	if rec.Auth == "" {
		rec.Auth = r.Header.Get("x-goog-api-key")
	}
	f.mu.Lock()
	f.seen = append(f.seen, rec)
	f.mu.Unlock()
	return rec
}

func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// canned decides a marker failure; ok false means answer normally.
func canned(w http.ResponseWriter, auth, body string) bool {
	switch {
	case strings.Contains(auth, "bad"), strings.Contains(body, "[[fake:401]]"):
		jsonOut(w, 401, map[string]any{"error": map[string]any{"message": "invalid key"}})
	case strings.Contains(body, "[[fake:quota]]"):
		jsonOut(w, 402, map[string]any{"error": map[string]any{"message": "no balance"}})
	case strings.Contains(body, "[[fake:busy]]"):
		w.Header().Set("Retry-After", "30")
		jsonOut(w, 429, map[string]any{"error": map[string]any{"code": "rate_limit_exceeded"}})
	default:
		return false
	}
	return true
}

var (
	entryRe   = regexp.MustCompile(`(?s)<entry_[0-9a-f]+>\n(.*?)\n</entry_[0-9a-f]+>`)
	messageRe = regexp.MustCompile(`(?s)<message_[0-9a-f]+>\n(.*?)\n</message_[0-9a-f]+>`)
	wordRe    = regexp.MustCompile(`<word_[0-9a-f]+>\n([^\n]*)\n`)
)

// firstRunes is the first two runes of the trimmed match, or "".
func firstRunes(re *regexp.Regexp, user string) string {
	m := re.FindStringSubmatch(user)
	if m == nil {
		return ""
	}
	r := []rune(strings.TrimSpace(m[1]))
	if len(r) > 2 {
		r = r[:2]
	}
	return string(r)
}

// CannedText returns the JSON text a well-behaved model would answer for the
// request's system and user text.
func CannedText(system, user string) string {
	switch {
	case strings.Contains(system, "You write example sentences for a word"):
		// Two sentences with the word (Chinese), one reading each.
		word := "你好"
		if m := wordRe.FindStringSubmatch(user); m != nil {
			word = m[1]
		}
		b, _ := json.Marshal(map[string]any{"sentences": []any{
			map[string]any{"text": "我每天" + word + "。", "reading": "wǒ měitiān …", "translation": "Every day (fake)."},
			map[string]any{"text": word + "很好。", "reading": "… hěn hǎo", "translation": "It is good (fake)."},
		}})
		return string(b)
	case strings.Contains(system, "conversation partner for a language learner"):
		// The reply is Chinese; the learner's new message (if any) gets one correction.
		anns := []any{}
		if quote := firstRunes(messageRe, user); quote != "" {
			anns = append(anns, map[string]any{"quote": quote, "context_before": "", "correction": quote + "X", "explanation": "Fake explanation", "category": "grammar", "kind": "mistake"})
		}
		b, _ := json.Marshal(map[string]any{"reply": "你好！你今天做什么了？", "annotations": anns})
		return string(b)
	case strings.Contains(system, "review a language learner's journal entry"):
		quote := "你好"
		if q := firstRunes(entryRe, user); q != "" {
			quote = q
		}
		b, _ := json.Marshal(map[string]any{
			"annotations": []any{map[string]any{"quote": quote, "context_before": "", "correction": quote + "X", "explanation": "Fake explanation", "category": "grammar"}},
			"overall":     map[string]any{"summary": "Fake review", "strengths": []string{"fake strength"}, "focus": []string{"fake focus"}},
		})
		return string(b)
	case strings.Contains(system, "suggest topics"):
		b, _ := json.Marshal(map[string]any{"items": []any{
			map[string]any{"title": "Topic 1", "prompt": "Fake prompt", "words": []string{}},
			map[string]any{"title": "Topic 2", "prompt": "Fake prompt", "words": []string{}},
			map[string]any{"title": "Topic 3", "prompt": "Fake prompt", "words": []string{}},
		}})
		return string(b)
	}
	return `{"text":"fake transcription","unreadable":false}`
}

func (f *OpenAI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 16<<20))
	rec := f.record(r, raw)
	switch {
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/models"):
		if canned(w, rec.Auth, "") {
			return
		}
		ids := f.Models
		if len(ids) == 0 {
			ids = []string{"fake-model"}
		}
		var data []any
		for _, id := range ids {
			data = append(data, map[string]any{"id": id, "object": "model"})
		}
		jsonOut(w, 200, map[string]any{"object": "list", "data": data})
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/chat/completions"):
		if canned(w, rec.Auth, string(raw)) {
			return
		}
		var req struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content any    `json:"content"`
			} `json:"messages"`
		}
		_ = json.Unmarshal(raw, &req)
		var system, user string
		for _, m := range req.Messages {
			text, _ := m.Content.(string)
			if parts, ok := m.Content.([]any); ok {
				for _, p := range parts {
					if pm, ok := p.(map[string]any); ok && pm["type"] == "text" {
						text, _ = pm["text"].(string)
					}
				}
			}
			if m.Role == "system" {
				system = text
			} else if m.Role == "user" {
				user = text
			}
		}
		if strings.Contains(string(raw), "[[fake:refusal]]") {
			jsonOut(w, 200, map[string]any{"model": req.Model, "choices": []any{map[string]any{
				"message": map[string]any{"role": "assistant", "content": nil, "refusal": "I can't help with that."}, "finish_reason": "stop"}}})
			return
		}
		text := CannedText(system, user)
		jsonOut(w, 200, map[string]any{"model": req.Model,
			"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": text}, "finish_reason": "stop"}},
			"usage":   map[string]any{"prompt_tokens": utf8.RuneCountInString(system + user), "completion_tokens": utf8.RuneCountInString(text)}})
	default:
		http.NotFound(w, r)
	}
}
