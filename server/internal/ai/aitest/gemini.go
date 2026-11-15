package aitest

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
)

// Gemini is a fake of the native Gemini API: GET /models/{model} and
// POST /models/{model}:generateContent. The same failure markers as OpenAI
// apply ([[fake:401|quota|busy|refusal]]); a key containing "bad" is a 400
// API_KEY_INVALID like the real service.
type Gemini struct {
	mu   sync.Mutex
	seen []Request
}

// Requests returns a copy of what the server saw.
func (f *Gemini) Requests() []Request {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Request(nil), f.seen...)
}

func (f *Gemini) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 16<<20))
	key := r.Header.Get("x-goog-api-key")
	f.mu.Lock()
	f.seen = append(f.seen, Request{Method: r.Method, Path: r.URL.Path, Auth: key, Body: raw})
	f.mu.Unlock()
	body := string(raw)
	switch {
	case strings.Contains(key, "bad"):
		jsonOut(w, 400, map[string]any{"error": map[string]any{"code": 400, "status": "INVALID_ARGUMENT", "details": []any{map[string]any{"reason": "API_KEY_INVALID"}}}})
		return
	case strings.Contains(body, "[[fake:401]]"):
		jsonOut(w, 403, map[string]any{"error": map[string]any{"status": "PERMISSION_DENIED"}})
		return
	case strings.Contains(body, "[[fake:quota]]"), strings.Contains(body, "[[fake:busy]]"):
		w.Header().Set("Retry-After", "30")
		jsonOut(w, 429, map[string]any{"error": map[string]any{"status": "RESOURCE_EXHAUSTED"}})
		return
	}
	switch {
	case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/models/"):
		jsonOut(w, 200, map[string]any{"name": strings.TrimPrefix(r.URL.Path[strings.Index(r.URL.Path, "/models/")+1:], "")})
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, ":generateContent"):
		if strings.Contains(body, "[[fake:refusal]]") {
			jsonOut(w, 200, map[string]any{"promptFeedback": map[string]any{"blockReason": "PROHIBITED_CONTENT"}})
			return
		}
		var req struct {
			SystemInstruction struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"systemInstruction"`
			Contents []struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"contents"`
		}
		_ = json.Unmarshal(raw, &req)
		var system, user string
		if len(req.SystemInstruction.Parts) > 0 {
			system = req.SystemInstruction.Parts[0].Text
		}
		if len(req.Contents) > 0 {
			for _, p := range req.Contents[0].Parts {
				user += p.Text
			}
		}
		jsonOut(w, 200, map[string]any{
			"candidates":    []any{map[string]any{"content": map[string]any{"role": "model", "parts": []any{map[string]any{"text": CannedText(system, user)}}}, "finishReason": "STOP"}},
			"usageMetadata": map[string]any{"promptTokenCount": 10, "candidatesTokenCount": 5},
			"modelVersion":  "fake-gemini-1",
		})
	default:
		http.NotFound(w, r)
	}
}
