package api_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"qinqin/internal/grammar"
	"qinqin/internal/pack"
)

// grammarFixture is the shared grammar pack fixture, relative to this
// package's test working directory.
const grammarFixture = "../grammar/testdata/zh-mini"

func TestGrammarRoutes(t *testing.T) {
	ts, sqlDB := newServer(t)
	pk, err := pack.LoadPack(grammarFixture)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := grammar.Import(context.Background(), sqlDB, pk); err != nil {
		t.Fatal(err)
	}

	// Public: no session.
	resp := getEntry(t, ts.URL, "/api/grammar")
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/grammar = %d: %s", resp.StatusCode, body)
	}
	var packs []map[string]any
	if err := json.Unmarshal(body, &packs); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	if len(packs) != 1 {
		t.Fatalf("packs = %v", packs)
	}
	for _, k := range []string{"packId", "name", "version", "language", "license", "attribution", "notice", "levels", "lessons"} {
		if _, ok := packs[0][k]; !ok {
			t.Errorf("pack lacks key %q: %v", k, packs[0])
		}
	}
	if lessons, _ := packs[0]["lessons"].([]any); len(lessons) != 3 {
		t.Errorf("lessons = %v, want 3", packs[0]["lessons"])
	}

	// Language filter.
	for lang, want := range map[string]int{"zh": 1, "ja": 0} {
		resp := getEntry(t, ts.URL, "/api/grammar?language="+lang)
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		var got []any
		if resp.StatusCode != http.StatusOK || json.Unmarshal(body, &got) != nil || len(got) != want {
			t.Errorf("language=%s: %d %s, want %d packs", lang, resp.StatusCode, body, want)
		}
		if lang == "ja" && string(body) != "[]\n" && string(body) != "[]" {
			t.Errorf("language=ja body = %q, want an empty array", body)
		}
	}

	// One lesson.
	resp = getEntry(t, ts.URL, "/api/grammar/zh-grammar-mini/bu")
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET lesson = %d: %s", resp.StatusCode, body)
	}
	var view struct {
		Pack   map[string]any `json:"pack"`
		Lesson struct {
			ID       string `json:"id"`
			Title    string `json:"title"`
			Examples []struct {
				Focus string `json:"focus"`
			} `json:"examples"`
		} `json:"lesson"`
		Prev string `json:"prev"`
		Next string `json:"next"`
	}
	if err := json.Unmarshal(body, &view); err != nil {
		t.Fatal(err)
	}
	if view.Lesson.ID != "bu" || view.Lesson.Examples[0].Focus != "不" || view.Prev != "shi" || view.Next != "ge" {
		t.Errorf("view = %+v", view)
	}
	if view.Pack["license"] != "CC0-1.0" || view.Pack["packId"] != "zh-grammar-mini" {
		t.Errorf("pack credits = %v", view.Pack)
	}
	if _, has := view.Pack["lessons"]; has {
		t.Errorf("lesson view's pack carries the lesson list: %v", view.Pack)
	}

	// Unknown lesson and pack: 404 with the JSON error.
	for _, path := range []string{"/api/grammar/zh-grammar-mini/nope", "/api/grammar/nope/shi"} {
		resp := getEntry(t, ts.URL, path)
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, resp.StatusCode)
		}
		var e map[string]string
		if json.Unmarshal(body, &e) != nil || e["error"] != "not_found" {
			t.Errorf("GET %s body = %s, want {\"error\":\"not_found\"}", path, body)
		}
	}
}
