package api_test

import (
	"fmt"
	"io"
	"net/http"
	"slices"
	"testing"
)

// Picture reports (#274): a learner reports a wrong picture of an entry; the
// picture is no longer answered to them (the next mapping may show), the
// report list says what they reported, and nothing changes for anyone else.

func (e imagesEnv) report(t *testing.T, token string, body any) int {
	t.Helper()
	resp := doJSON(t, http.MethodPost, e.ts.URL, "/api/images/reports", token, body)
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return resp.StatusCode
}

func reportedKeys(t *testing.T, body map[string]any) []string {
	t.Helper()
	list, ok := body["reports"].([]any)
	if !ok {
		t.Fatalf("no reports list in %v", body)
	}
	out := []string{}
	for _, r := range list {
		m := r.(map[string]any)
		out = append(out, fmt.Sprintf("%v/%v/%v", m["entryId"], m["packId"], m["concept"]))
	}
	return out
}

func TestPictureReportsNeedSignIn(t *testing.T) {
	e := newImagesEnv(t)
	if code := e.report(t, "", map[string]any{"entryId": e.apple, "packId": "images-test", "concept": "A", "reason": "wrong"}); code != http.StatusUnauthorized {
		t.Errorf("POST without a token = %d, want 401", code)
	}
	if code, _ := e.get(t, "/api/images/reports", ""); code != http.StatusUnauthorized {
		t.Errorf("GET without a token = %d, want 401", code)
	}
}

func TestReportedPictureIsHiddenForTheReporterOnly(t *testing.T) {
	e := newImagesEnv(t)
	bob := registerUser(t, e.ts.URL, "bob", e.token)
	path := fmt.Sprintf("/api/images/entries/%d", e.hit)
	if _, b := e.get(t, path, e.token); picture(t, b)["concept"] != "H" {
		t.Fatalf("before the report: %v", b)
	}
	if code := e.report(t, e.token, map[string]any{"entryId": e.hit, "packId": "images-test", "concept": "H", "reason": "wrong"}); code != http.StatusNoContent {
		t.Fatalf("report = %d, want 204", code)
	}
	// the next mapping of the entry shows for the reporter; bob still sees H
	if _, b := e.get(t, path, e.token); picture(t, b)["concept"] != "P" {
		t.Errorf("after the report alice got %v, want the next mapping P", b)
	}
	if _, b := e.get(t, path+"?sense=1", e.token); picture(t, b) != nil {
		t.Errorf("sense 1 after the report: %v, want none", b)
	}
	if _, b := e.get(t, path, bob); picture(t, b)["concept"] != "H" {
		t.Errorf("bob got %v, want H", b)
	}
	// a report is per entry: the same picture elsewhere is not hidden
	if code := e.report(t, e.token, map[string]any{"entryId": e.kana, "packId": "images-test", "concept": "A", "reason": "unclear"}); code != http.StatusNoContent {
		t.Fatalf("second report = %d", code)
	}
	if _, b := e.get(t, fmt.Sprintf("/api/images/entries/%d", e.apple), e.token); picture(t, b)["concept"] != "A" {
		t.Errorf("another entry with the same picture got %v", b)
	}
	// a repeated report is stored once in the list
	e.report(t, e.token, map[string]any{"entryId": e.hit, "packId": "images-test", "concept": "H", "reason": "other"})
	code, body := e.get(t, "/api/images/reports", e.token)
	if code != http.StatusOK {
		t.Fatalf("GET reports = %d", code)
	}
	want := []string{fmt.Sprintf("%d/images-test/H", e.hit), fmt.Sprintf("%d/images-test/A", e.kana)} // by entry id
	if got := reportedKeys(t, body); !slices.Equal(got, want) {
		t.Errorf("alice's reports %v, want %v", got, want)
	}
	if _, body := e.get(t, "/api/images/reports", bob); len(reportedKeys(t, body)) != 0 {
		t.Errorf("bob's reports %v, want none", body)
	}
}

func TestPictureReportValidation(t *testing.T) {
	e := newImagesEnv(t)
	for _, c := range []struct {
		name string
		body any
		want int
	}{
		{"unknown reason", map[string]any{"entryId": e.hit, "packId": "images-test", "concept": "H", "reason": "ugly"}, http.StatusBadRequest},
		{"no reason", map[string]any{"entryId": e.hit, "packId": "images-test", "concept": "H"}, http.StatusBadRequest},
		{"not json", "x", http.StatusBadRequest},
		{"unknown entry", map[string]any{"entryId": 999999, "packId": "images-test", "concept": "H", "reason": "wrong"}, http.StatusNotFound},
		{"unknown picture", map[string]any{"entryId": e.hit, "packId": "images-test", "concept": "Z", "reason": "wrong"}, http.StatusNotFound},
		{"unknown pack", map[string]any{"entryId": e.hit, "packId": "nope", "concept": "H", "reason": "wrong"}, http.StatusNotFound},
	} {
		if code := e.report(t, e.token, c.body); code != c.want {
			t.Errorf("%s: %d, want %d", c.name, code, c.want)
		}
	}
}

// The entry answer carries the picture route's targets (#274), so an offline
// client looks a picture up by the same strings.
func TestEntryAnswerCarriesPictureTargets(t *testing.T) {
	e := newImagesEnv(t)
	for _, c := range []struct {
		id   int64
		want []string
	}{{e.apple, []string{"苹果", "苹果", "蘋果"}}, {e.kana, []string{"j:1", "いぬ"}}} {
		_, body := e.get(t, fmt.Sprintf("/api/entries/%d", c.id), e.token)
		raw, _ := body["pictureTargets"].([]any)
		var got []string
		for _, v := range raw {
			got = append(got, v.(string))
		}
		if !slices.Equal(got, c.want) {
			t.Errorf("entry %d pictureTargets %v, want %v", c.id, got, c.want)
		}
	}
}
