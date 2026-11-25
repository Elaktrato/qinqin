package api_test

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/color"
	"image/color/palette"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
)

const avatarGPS = "QINQIN-GPS-48.8584N-2.2945E"

type avatarEnv struct {
	url, dataDir string
	root, bob    string // tokens: root is the administrator
	rootID       int64
	bobID        int64
}

func newAvatarEnv(t *testing.T) avatarEnv {
	t.Helper()
	ts, sqlDB, dataDir := newServerWithDir(t)
	root := registerUser(t, ts.URL, "root", "")
	bob := registerUser(t, ts.URL, "bobby", root)
	return avatarEnv{url: ts.URL, dataDir: dataDir, root: root, bob: bob,
		rootID: userID(t, sqlDB, "root"), bobID: userID(t, sqlDB, "bobby")}
}

func colourPNG(t *testing.T, w, h int, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = c.R, c.G, c.B, c.A
	}
	var b bytes.Buffer
	png.Encode(&b, img)
	return b.Bytes()
}

// exifPhoto is a JPEG with an APP1 Exif segment naming a GPS position.
func exifPhoto(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	jpeg.Encode(&b, image.NewGray(image.Rect(0, 0, 120, 90)), nil)
	jpg := b.Bytes()
	payload := append([]byte("Exif\x00\x00II*\x00\x08\x00\x00\x00\x00\x00\x00\x00\x00\x00"), avatarGPS...)
	seg := []byte{0xFF, 0xE1, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}
	out := append(append(append([]byte{}, jpg[:2]...), seg...), payload...)
	return append(out, jpg[2:]...)
}

func pngChunk(typ string, data []byte) []byte {
	var b bytes.Buffer
	binary.Write(&b, binary.BigEndian, uint32(len(data)))
	b.WriteString(typ)
	b.Write(data)
	binary.Write(&b, binary.BigEndian, crc32.ChecksumIEEE(append([]byte(typ), data...)))
	return b.Bytes()
}

func uploadAvatar(t *testing.T, e avatarEnv, token string, file []byte) *http.Response {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if file != nil {
		fw, _ := mw.CreateFormFile("file", "me.png")
		fw.Write(file)
	}
	mw.Close()
	req, _ := http.NewRequest(http.MethodPost, e.url+"/api/account/avatar", &body)
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

func avatarURLOf(t *testing.T, resp *http.Response) string {
	t.Helper()
	var out struct {
		AvatarURL *string `json:"avatarUrl"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.AvatarURL == nil {
		return ""
	}
	return *out.AvatarURL
}

func meAvatar(t *testing.T, e avatarEnv, token string) string {
	t.Helper()
	return avatarURLOf(t, doJSON(t, http.MethodGet, e.url, "/api/auth/me", token, nil))
}

func codeOf(t *testing.T, resp *http.Response) string {
	t.Helper()
	var out struct {
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	return out.Error
}

func TestAvatarRoutesRefuseAnonymousCallers(t *testing.T) {
	e := newAvatarEnv(t)
	up := uploadAvatar(t, e, e.root, colourPNG(t, 40, 40, color.RGBA{200, 10, 10, 255}))
	if up.StatusCode != http.StatusOK {
		t.Fatalf("upload: %d", up.StatusCode)
	}
	url := avatarURLOf(t, up)
	for name, resp := range map[string]*http.Response{
		"upload":  uploadAvatar(t, e, "", colourPNG(t, 8, 8, color.RGBA{1, 2, 3, 255})),
		"remove":  doJSON(t, http.MethodDelete, e.url, "/api/account/avatar", "", nil),
		"picture": doJSON(t, http.MethodGet, e.url, url, "", nil),
		"small":   doJSON(t, http.MethodGet, e.url, url+"?size=64", "", nil),
	} {
		if resp.StatusCode != http.StatusUnauthorized || codeOf(t, resp) != "unauthorized" {
			t.Errorf("%s without a session: %d", name, resp.StatusCode)
		}
	}
	// Administrator routes answer every caller who is not an admin 403.
	if r := doJSON(t, http.MethodDelete, e.url, "/api/admin/users/"+strconv.FormatInt(e.rootID, 10)+"/avatar", "", nil); r.StatusCode != http.StatusForbidden {
		t.Errorf("admin remove without a session: %d", r.StatusCode)
	}
	if meAvatar(t, e, e.root) != url {
		t.Fatal("an anonymous call changed the picture")
	}
}

func TestAvatarUploadServesACleanSquare(t *testing.T) {
	e := newAvatarEnv(t)
	if got := meAvatar(t, e, e.root); got != "" {
		t.Fatalf("a new account has avatarUrl %q", got)
	}
	in := exifPhoto(t)
	if !bytes.Contains(in, []byte(avatarGPS)) {
		t.Fatal("fixture has no GPS text")
	}
	up := uploadAvatar(t, e, e.root, in)
	if up.StatusCode != http.StatusOK {
		t.Fatalf("upload: %d", up.StatusCode)
	}
	url := avatarURLOf(t, up)
	if !strings.HasPrefix(url, "/api/avatars/"+strconv.FormatInt(e.rootID, 10)+"/") || meAvatar(t, e, e.root) != url {
		t.Fatalf("avatarUrl %q, me says %q", url, meAvatar(t, e, e.root))
	}
	for size, query := range map[int]string{256: "", 64: "?size=64"} {
		resp := doJSON(t, http.MethodGet, e.url, url+query, e.root, nil)
		h := resp.Header
		if resp.StatusCode != 200 || h.Get("Content-Type") != "image/jpeg" || h.Get("Cache-Control") != "private, no-cache" ||
			h.Get("X-Content-Type-Options") != "nosniff" || h.Get("ETag") == "" {
			t.Fatalf("GET %d: %d %v", size, resp.StatusCode, h)
		}
		b, _ := io.ReadAll(resp.Body)
		cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
		if err != nil || format != "jpeg" || cfg.Width != size || cfg.Height != size {
			t.Fatalf("GET %d: %v %s %dx%d", size, err, format, cfg.Width, cfg.Height)
		}
		if bytes.Contains(b, []byte(avatarGPS)) || bytes.Contains(b, []byte("Exif")) {
			t.Fatalf("GET %d: the served file still carries the EXIF", size)
		}
		// A revalidation with the ETag is a 304.
		req, _ := http.NewRequest(http.MethodGet, e.url+url+query, nil)
		req.Header.Set("Authorization", "Bearer "+e.root)
		req.Header.Set("If-None-Match", h.Get("ETag"))
		again, err := http.DefaultClient.Do(req)
		if err != nil || again.StatusCode != http.StatusNotModified {
			t.Fatalf("revalidation: %v %d", err, again.StatusCode)
		}
		again.Body.Close()
	}
	// Nothing on disk holds the GPS text either.
	filepath.Walk(filepath.Join(e.dataDir, "avatars"), func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			if b, _ := os.ReadFile(p); bytes.Contains(b, []byte(avatarGPS)) {
				t.Errorf("%s holds the GPS text", p)
			}
		}
		return nil
	})
	if r := doJSON(t, http.MethodGet, e.url, url+"?size=128", e.root, nil); r.StatusCode != http.StatusBadRequest || codeOf(t, r) != "bad_request" {
		t.Fatalf("size 128: %d", r.StatusCode)
	}
	for _, bad := range []string{"/api/avatars/x/" + url[len(url)-32:], "/api/avatars/" + strconv.FormatInt(e.bobID, 10) + "/" + url[len(url)-32:], url[:len(url)-1] + "0"} {
		if r := doJSON(t, http.MethodGet, e.url, bad, e.root, nil); r.StatusCode != http.StatusNotFound || codeOf(t, r) != "not_found" {
			t.Errorf("GET %s: %d", bad, r.StatusCode)
		}
	}
}

func TestAvatarReplaceAndRemove(t *testing.T) {
	e := newAvatarEnv(t)
	first := avatarURLOf(t, uploadAvatar(t, e, e.root, colourPNG(t, 40, 40, color.RGBA{200, 10, 10, 255})))
	second := avatarURLOf(t, uploadAvatar(t, e, e.root, colourPNG(t, 40, 40, color.RGBA{10, 10, 200, 255})))
	if first == "" || second == "" || first == second {
		t.Fatalf("replace: %q then %q", first, second)
	}
	if r := doJSON(t, http.MethodGet, e.url, first, e.root, nil); r.StatusCode != http.StatusNotFound {
		t.Fatalf("the replaced picture is still served: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, e.url, "/api/account/avatar", e.root, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("remove: %d", r.StatusCode)
	}
	if meAvatar(t, e, e.root) != "" {
		t.Fatal("me still names a picture")
	}
	if r := doJSON(t, http.MethodGet, e.url, second, e.root, nil); r.StatusCode != http.StatusNotFound {
		t.Fatalf("the removed picture is still served: %d", r.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(e.dataDir, "avatars", strconv.FormatInt(e.rootID, 10))); !os.IsNotExist(err) {
		t.Fatalf("files are left: %v", err)
	}
	// Removing when there is none is still 204.
	if r := doJSON(t, http.MethodDelete, e.url, "/api/account/avatar", e.root, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("second remove: %d", r.StatusCode)
	}
}

// Two users: B sees A's picture (signed-in users of one server do), but B
// can neither change nor remove it.
func TestAvatarTwoUsers(t *testing.T) {
	e := newAvatarEnv(t)
	rootURL := avatarURLOf(t, uploadAvatar(t, e, e.root, colourPNG(t, 40, 40, color.RGBA{200, 10, 10, 255})))
	if r := doJSON(t, http.MethodGet, e.url, rootURL, e.bob, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("bob cannot see root's picture: %d", r.StatusCode)
	}
	bobURL := avatarURLOf(t, uploadAvatar(t, e, e.bob, colourPNG(t, 40, 40, color.RGBA{10, 200, 10, 255})))
	if !strings.HasPrefix(bobURL, "/api/avatars/"+strconv.FormatInt(e.bobID, 10)+"/") {
		t.Fatalf("bob's upload landed at %q", bobURL)
	}
	if r := doJSON(t, http.MethodDelete, e.url, "/api/account/avatar", e.bob, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("bob removes his own: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, e.url, "/api/admin/users/"+strconv.FormatInt(e.rootID, 10)+"/avatar", e.bob, nil); r.StatusCode != http.StatusForbidden {
		t.Fatalf("bob removing root's picture as an admin: %d", r.StatusCode)
	}
	if meAvatar(t, e, e.root) != rootURL {
		t.Fatal("root's picture changed by bob")
	}
	if r := doJSON(t, http.MethodGet, e.url, rootURL, e.root, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("root's picture is gone: %d", r.StatusCode)
	}
}

func TestAdminRemovesAUsersPicture(t *testing.T) {
	e := newAvatarEnv(t)
	bobURL := avatarURLOf(t, uploadAvatar(t, e, e.bob, colourPNG(t, 40, 40, color.RGBA{10, 200, 10, 255})))
	var list struct {
		Users []struct {
			ID        int64   `json:"id"`
			AvatarURL *string `json:"avatarUrl"`
		} `json:"users"`
	}
	decodeJSON(t, doJSON(t, http.MethodGet, e.url, "/api/admin/users", e.root, nil), &list)
	found := false
	for _, u := range list.Users {
		if u.ID == e.bobID {
			found = u.AvatarURL != nil && *u.AvatarURL == bobURL
		}
	}
	if !found {
		t.Fatalf("the admin list does not name bob's picture: %+v", list.Users)
	}
	path := "/api/admin/users/" + strconv.FormatInt(e.bobID, 10) + "/avatar"
	if r := doJSON(t, http.MethodDelete, e.url, path, e.root, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("admin remove: %d", r.StatusCode)
	}
	if meAvatar(t, e, e.bob) != "" {
		t.Fatal("bob still has a picture")
	}
	if r := doJSON(t, http.MethodDelete, e.url, path, e.root, nil); r.StatusCode != http.StatusNotFound || codeOf(t, r) != "not_found" {
		t.Fatalf("admin remove of none: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, e.url, "/api/admin/users/99999/avatar", e.root, nil); r.StatusCode != http.StatusNotFound {
		t.Fatalf("admin remove of an unknown user: %d", r.StatusCode)
	}
	var audit struct {
		Events []struct {
			Action string `json:"action"`
		} `json:"events"`
	}
	decodeJSON(t, doJSON(t, http.MethodGet, e.url, "/api/admin/audit", e.root, nil), &audit)
	n := 0
	for _, ev := range audit.Events {
		if ev.Action == "avatar_removed" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("%d avatar_removed audit rows, want 1: %+v", n, audit.Events)
	}
}

func animatedGIFBytes(t *testing.T) []byte {
	t.Helper()
	frame := image.NewPaletted(image.Rect(0, 0, 4, 4), palette.Plan9)
	var b bytes.Buffer
	gif.EncodeAll(&b, &gif.GIF{Image: []*image.Paletted{frame, frame}, Delay: []int{5, 5}})
	return b.Bytes()
}

func TestAvatarUploadRefusals(t *testing.T) {
	e := newAvatarEnv(t)
	still := colourPNG(t, 16, 16, color.RGBA{1, 2, 3, 255})
	apng := append(append(append([]byte{}, still[:33]...), pngChunk("acTL", make([]byte, 8))...), still[33:]...)
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], 5100)
	binary.BigEndian.PutUint32(ihdr[4:], 5100)
	ihdr[8], ihdr[9] = 8, 2
	bomb := append(append([]byte("\x89PNG\r\n\x1a\n"), pngChunk("IHDR", ihdr)...), pngChunk("IEND", nil)...)
	huge := append(colourPNG(t, 8, 8, color.RGBA{1, 2, 3, 255}), make([]byte, 5<<20)...)
	for name, c := range map[string]struct {
		file   []byte
		status int
		code   string
	}{
		"text":     {[]byte("just some text, not a picture"), 415, "unsupported_image"},
		"svg":      {[]byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), 415, "unsupported_image"},
		"gif":      {animatedGIFBytes(t), 415, "unsupported_image"},
		"apng":     {apng, 415, "animated_image"},
		"bomb":     {bomb, 422, "image_too_large"},
		"5 MB+":    {huge, 413, "photo_too_large"},
		"no field": {nil, 400, "bad_request"},
	} {
		r := uploadAvatar(t, e, e.bob, c.file)
		if got := codeOf(t, r); r.StatusCode != c.status || got != c.code {
			t.Errorf("%s: %d %s, want %d %s", name, r.StatusCode, got, c.status, c.code)
		}
	}
	if meAvatar(t, e, e.bob) != "" {
		t.Fatal("a refused upload left a picture")
	}
	if _, err := os.Stat(filepath.Join(e.dataDir, "avatars")); !os.IsNotExist(err) {
		t.Fatalf("a refused upload wrote files: %v", err)
	}
}

func TestAvatarUploadsAreRateLimited(t *testing.T) {
	e := newAvatarEnv(t)
	for i := 0; i < 10; i++ {
		if r := uploadAvatar(t, e, e.bob, colourPNG(t, 8, 8, color.RGBA{uint8(i), 2, 3, 255})); r.StatusCode != http.StatusOK {
			t.Fatalf("upload %d: %d", i+1, r.StatusCode)
		}
	}
	r := uploadAvatar(t, e, e.bob, colourPNG(t, 8, 8, color.RGBA{99, 2, 3, 255}))
	if r.StatusCode != http.StatusTooManyRequests || codeOf(t, r) != "rate_limited" || r.Header.Get("Retry-After") == "" {
		t.Fatalf("11th upload: %d %v", r.StatusCode, r.Header)
	}
	// Another user has an hour of their own.
	if r := uploadAvatar(t, e, e.root, colourPNG(t, 8, 8, color.RGBA{1, 2, 3, 255})); r.StatusCode != http.StatusOK {
		t.Fatalf("root's upload: %d", r.StatusCode)
	}
}

func TestAccountDeletionRemovesThePicture(t *testing.T) {
	e := newAvatarEnv(t)
	bobURL := avatarURLOf(t, uploadAvatar(t, e, e.bob, colourPNG(t, 40, 40, color.RGBA{10, 200, 10, 255})))
	var preview struct {
		Avatar int `json:"avatar"`
	}
	decodeJSON(t, doJSON(t, http.MethodGet, e.url, "/api/account/deletion-preview", e.bob, nil), &preview)
	if preview.Avatar != 1 {
		t.Fatalf("the deletion preview counts %d pictures, want 1", preview.Avatar)
	}
	if r := doJSON(t, http.MethodDelete, e.url, "/api/account", e.bob, map[string]string{"password": "secret-pass-bobby", "confirm": "bobby"}); r.StatusCode != http.StatusNoContent {
		t.Fatalf("delete account: %d %s", r.StatusCode, body(t, r))
	}
	if r := doJSON(t, http.MethodGet, e.url, bobURL, e.root, nil); r.StatusCode != http.StatusNotFound {
		t.Fatalf("the deleted account's picture is still served: %d", r.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(e.dataDir, "avatars", strconv.FormatInt(e.bobID, 10))); !os.IsNotExist(err) {
		t.Fatalf("files are left: %v", err)
	}
}

// An upload whose account is deleted (or disabled) while its picture is
// being decoded stores nothing: no row, no files, no picture served.
func TestAvatarUploadRacingAnAccountDeletionStoresNothing(t *testing.T) {
	for _, gone := range []string{"deleted", "disabled"} {
		t.Run(gone, func(t *testing.T) {
			var e avatarEnv
			hook := func() {
				path := "/api/admin/users/" + strconv.FormatInt(e.bobID, 10)
				var r *http.Response
				if gone == "deleted" {
					r = doJSON(t, http.MethodDelete, e.url, path, e.root, map[string]string{"currentPassword": "secret-pass-root", "confirm": "bobby"})
				} else {
					r = doJSON(t, http.MethodPatch, e.url, path, e.root, map[string]any{"disabled": true})
				}
				if r.StatusCode >= 300 {
					t.Errorf("%s bob in the hook: %d %s", gone, r.StatusCode, body(t, r))
				}
			}
			sqlDB := dbtest.Open(t)
			dataDir := t.TempDir()
			ts := newTestServer(sqlDB, api.New(sqlDB, dataDir, nil, api.WithAvatarHook(func() { hook() })))
			t.Cleanup(ts.Close)
			root := registerUser(t, ts.URL, "root", "")
			e = avatarEnv{url: ts.URL, dataDir: dataDir, root: root, bob: registerUser(t, ts.URL, "bobby", root),
				rootID: userID(t, sqlDB, "root"), bobID: userID(t, sqlDB, "bobby")}
			r := uploadAvatar(t, e, e.bob, colourPNG(t, 40, 40, color.RGBA{10, 200, 10, 255}))
			if r.StatusCode != http.StatusUnauthorized || codeOf(t, r) != "unauthorized" {
				t.Fatalf("upload of a %s account: %d", gone, r.StatusCode)
			}
			var rows int
			sqlDB.QueryRow(`SELECT COUNT(*) FROM user_avatars WHERE user_id = ?`, e.bobID).Scan(&rows)
			if rows != 0 {
				t.Fatalf("%d picture rows for the %s account", rows, gone)
			}
			if _, err := os.Stat(filepath.Join(dataDir, "avatars", strconv.FormatInt(e.bobID, 10))); !os.IsNotExist(err) {
				t.Fatalf("files for the %s account: %v", gone, err)
			}
		})
	}
}
