package api_test

import (
	"bytes"
	"image"
	"image/jpeg"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"qinqin/internal/ai"
)

func testJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewGray(image.Rect(0, 0, w, h)), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func uploadPhoto(t *testing.T, env journalEnv, token string, ws int64, file []byte) *http.Response {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	mw.WriteField("workspace", strconv.FormatInt(ws, 10))
	fw, _ := mw.CreateFormFile("file", "page.jpg")
	fw.Write(file)
	mw.Close()
	req, _ := http.NewRequest(http.MethodPost, env.url+"/api/journal/photos", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func photoFiles(t *testing.T, env journalEnv) []string {
	t.Helper()
	m, _ := filepath.Glob(filepath.Join(env.dataDir, "journal", "*", "*.jpg"))
	return m
}

func TestPhotoRoutes(t *testing.T) {
	env := newJournalEnv(t, ai.Fake{}, false)
	other := registerUser(t, env.url, "mallory", env.token)

	resp := uploadPhoto(t, env, "", env.ws, testJPEG(t, 20, 10))
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous upload: %d", resp.StatusCode)
	}
	resp = uploadPhoto(t, env, env.token, env.ws, testJPEG(t, 20, 10))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload: %d", resp.StatusCode)
	}
	var created struct {
		PhotoID string `json:"photoId"`
	}
	decodeJSON(t, resp, &created)
	if created.PhotoID == "" || len(photoFiles(t, env)) != 1 {
		t.Fatalf("photo id %q, files %v", created.PhotoID, photoFiles(t, env))
	}
	path := "/api/journal/photos/" + created.PhotoID

	get := doJSON(t, http.MethodGet, env.url, path, env.token, nil)
	if get.StatusCode != 200 || get.Header.Get("Content-Type") != "image/jpeg" ||
		get.Header.Get("Cache-Control") != "no-store" || get.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("GET: %d %v", get.StatusCode, get.Header)
	}
	if b, _ := io.ReadAll(get.Body); len(b) < 10 {
		t.Fatal("empty photo body")
	}
	if r := doJSON(t, http.MethodGet, env.url, path, other, nil); r.StatusCode != 404 {
		t.Fatalf("foreign GET: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodPut, env.url, path+"/keepalive", env.token, nil); r.StatusCode != 204 {
		t.Fatalf("keepalive: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodPut, env.url, path+"/keepalive", other, nil); r.StatusCode != 404 {
		t.Fatalf("foreign keepalive: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, env.url, path, other, nil); r.StatusCode != 404 {
		t.Fatalf("foreign DELETE: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, env.url, path, env.token, nil); r.StatusCode != 204 {
		t.Fatalf("DELETE: %d", r.StatusCode)
	}
	if len(photoFiles(t, env)) != 0 {
		t.Fatal("file survived DELETE")
	}
	if r := doJSON(t, http.MethodDelete, env.url, path, env.token, nil); r.StatusCode != 404 {
		t.Fatalf("second DELETE: %d", r.StatusCode)
	}
}

func TestPhotoUploadErrors(t *testing.T) {
	env := newJournalEnv(t, ai.Fake{}, false)
	code := func(resp *http.Response) string {
		var e struct {
			Error string `json:"error"`
		}
		decodeJSON(t, resp, &e)
		return e.Error
	}
	if r := uploadPhoto(t, env, env.token, 999999, testJPEG(t, 10, 10)); r.StatusCode != 404 {
		t.Errorf("foreign workspace: %d", r.StatusCode)
	}
	if r := uploadPhoto(t, env, env.token, env.ws, bytes.Repeat([]byte{'x'}, 10<<20+1)); r.StatusCode != 413 || code(r) != "photo_too_large" {
		t.Errorf("10 MiB + 1: %d", r.StatusCode)
	}
	if r := uploadPhoto(t, env, env.token, env.ws, []byte("GIF89a not a photo")); r.StatusCode != 415 || code(r) != "unsupported_image" {
		t.Errorf("gif: %d", r.StatusCode)
	}
	if r := uploadPhoto(t, env, env.token, env.ws, testJPEG(t, 8000, 7000)); r.StatusCode != 422 || code(r) != "image_too_large" {
		t.Errorf("56 MP: %d", r.StatusCode)
	}
	for i := 0; i < 10; i++ {
		if r := uploadPhoto(t, env, env.token, env.ws, testJPEG(t, 10, 10)); r.StatusCode != 201 {
			t.Fatalf("photo %d: %d", i, r.StatusCode)
		}
	}
	if r := uploadPhoto(t, env, env.token, env.ws, testJPEG(t, 10, 10)); r.StatusCode != 409 || code(r) != "too_many_photos" {
		t.Errorf("11th: %d", r.StatusCode)
	}
	if n := len(photoFiles(t, env)); n != 10 {
		t.Errorf("%d files on disk, want 10 (rejected uploads must leave nothing)", n)
	}
	_ = os.Stderr
}

func TestPhotoPendingCapIsCheckedBeforeDecoding(t *testing.T) {
	env := newJournalEnv(t, ai.Fake{}, false)
	for i := 0; i < 10; i++ {
		if r := uploadPhoto(t, env, env.token, env.ws, testJPEG(t, 10, 10)); r.StatusCode != 201 {
			t.Fatalf("photo %d: %d", i, r.StatusCode)
		}
	}
	// Garbage would be a 415 if it were decoded; at the cap it is a 409.
	var e struct {
		Error string `json:"error"`
	}
	r := uploadPhoto(t, env, env.token, env.ws, []byte("GIF89a not a photo"))
	decodeJSON(t, r, &e)
	if r.StatusCode != 409 || e.Error != "too_many_photos" {
		t.Fatalf("at the cap: %d %q", r.StatusCode, e.Error)
	}
}

func TestPhotoUploadRateLimit(t *testing.T) {
	env := newJournalEnv(t, ai.Fake{}, false)
	for i := 0; i < 30; i++ {
		r := uploadPhoto(t, env, env.token, env.ws, testJPEG(t, 10, 10))
		if r.StatusCode != 201 {
			t.Fatalf("upload %d: %d", i, r.StatusCode)
		}
		var c struct {
			PhotoID string `json:"photoId"`
		}
		decodeJSON(t, r, &c)
		doJSON(t, http.MethodDelete, env.url, "/api/journal/photos/"+c.PhotoID, env.token, nil)
	}
	r := uploadPhoto(t, env, env.token, env.ws, testJPEG(t, 10, 10))
	if r.StatusCode != 429 || r.Header.Get("Retry-After") == "" {
		t.Fatalf("31st upload: %d %v", r.StatusCode, r.Header)
	}
}

func TestPhotoUploadLimitIs25Megapixels(t *testing.T) {
	env := newJournalEnv(t, ai.Fake{}, false)
	if r := uploadPhoto(t, env, env.token, env.ws, testJPEG(t, 5100, 5100)); r.StatusCode != 422 {
		t.Fatalf("26 MP: %d", r.StatusCode)
	}
}
