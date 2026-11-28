package api_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

const coursesSamples = "../../../plugins/samples"

// installCourseFixture imports the Chinese fixture course with the packs it fills from.
func installCourseFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	lang.Register(lang.Zh{})
	for _, dir := range []string{filepath.Join(coursesSamples, "zh-mini"), filepath.Join(coursesSamples, "hsk-mini"), filepath.Join(coursesSamples, "zh-course-mini")} {
		p, err := pack.LoadPack(dir)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := packs.Import(context.Background(), db, p); err != nil {
			t.Fatalf("import %s: %v", dir, err)
		}
	}
}

// Both course routes are for signed-in users; an unknown course is 404; two users read the same course (it holds no
// user data); the filled course carries an ETag that a matching If-None-Match answers with 304.
func TestCourseRoutes(t *testing.T) {
	ts, sqlDB, _ := newServerWithDir(t)
	installCourseFixture(t, sqlDB)
	for _, path := range []string{"/api/courses", "/api/courses/zh-course-mini"} {
		if code, _ := getStarter(t, ts.URL, path, ""); code != http.StatusUnauthorized {
			t.Errorf("%s anonymous = %d, want 401", path, code)
		}
	}
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)

	code, raw := getStarter(t, ts.URL, "/api/courses?language=zh", alice)
	var list struct {
		Courses []struct {
			ID       string            `json:"id"`
			Language string            `json:"language"`
			License  string            `json:"license"`
			Title    map[string]string `json:"title"`
		} `json:"courses"`
	}
	if code != http.StatusOK || json.Unmarshal(raw, &list) != nil || len(list.Courses) != 1 || list.Courses[0].ID != "zh-course-mini" ||
		list.Courses[0].License != "CC-BY-4.0" || list.Courses[0].Title["en"] == "" {
		t.Fatalf("list = %d %s", code, raw)
	}
	if code, raw := getStarter(t, ts.URL, "/api/courses?language=ja", alice); code != http.StatusOK || !bytes.Equal(bytes.TrimSpace(raw), []byte(`{"courses":[]}`)) {
		t.Fatalf("ja list = %d %s", code, raw)
	}

	codeA, rawA := getStarter(t, ts.URL, "/api/courses/zh-course-mini", alice)
	codeB, rawB := getStarter(t, ts.URL, "/api/courses/zh-course-mini", bob)
	if codeA != http.StatusOK || codeB != http.StatusOK || string(rawA) != string(rawB) {
		t.Fatalf("alice %d, bob %d; bodies equal %v", codeA, codeB, string(rawA) == string(rawB))
	}
	var body struct {
		ID     string `json:"id"`
		Fill   string `json:"fill"`
		Source struct {
			Kind string `json:"kind"`
		} `json:"source"`
		Sections []json.RawMessage `json:"sections"`
	}
	if err := json.Unmarshal(rawA, &body); err != nil || body.ID != "zh-course-mini" || body.Source.Kind != "levels" || len(body.Sections) != 3 || body.Fill == "" {
		t.Fatalf("body %s (%v)", rawA, err)
	}

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/courses/zh-course-mini", nil)
	req.Header.Set("Authorization", "Bearer "+alice)
	req.Header.Set("If-None-Match", `"`+body.Fill+`"`)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotModified || resp.Header.Get("ETag") != `"`+body.Fill+`"` {
		t.Fatalf("revalidation = %d, ETag %q", resp.StatusCode, resp.Header.Get("ETag"))
	}

	if code, _ := getStarter(t, ts.URL, "/api/courses/nope", alice); code != http.StatusNotFound {
		t.Errorf("unknown course = %d, want 404", code)
	}
}
