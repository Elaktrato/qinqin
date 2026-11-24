package api_test

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"io"
	"net/http"
	"strconv"
	"testing"
)

// TestAvatarContractMatchesTheServer drives every case of
// docs/contracts/auth/avatar.json against a real server: JSON cases by shape
// and error code, the picture cases by status, headers and decoded size.
func TestAvatarContractMatchesTheServer(t *testing.T) {
	e := newAvatarEnv(t)
	bob := strconv.FormatInt(e.bobID, 10)
	jsonOf := func(r *http.Response) (int, any) {
		defer r.Body.Close()
		raw, _ := io.ReadAll(r.Body)
		if len(bytes.TrimSpace(raw)) == 0 {
			return r.StatusCode, nil
		}
		var v any
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("not JSON: %q", raw)
		}
		return r.StatusCode, v
	}
	first := avatarURLOf(t, uploadAvatar(t, e, e.root, colourPNG(t, 30, 30, color.RGBA{1, 2, 3, 255})))
	still := colourPNG(t, 16, 16, color.RGBA{1, 2, 3, 255})
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], 9000)
	binary.BigEndian.PutUint32(ihdr[4:], 10)
	ihdr[8], ihdr[9] = 8, 2
	var current string
	jsonCases := map[string]func() (int, any){
		"upload": func() (int, any) {
			r := uploadAvatar(t, e, e.root, colourPNG(t, 30, 30, color.RGBA{200, 2, 3, 255}))
			st, v := jsonOf(r)
			if m, ok := v.(map[string]any); ok {
				current, _ = m["avatarUrl"].(string)
			}
			return st, v
		},
		"me":                 func() (int, any) { return jsonOf(doJSON(t, http.MethodGet, e.url, "/api/auth/me", e.root, nil)) },
		"picture_other_size": func() (int, any) { return jsonOf(doJSON(t, http.MethodGet, e.url, current+"?size=128", e.root, nil)) },
		"picture_anonymous":  func() (int, any) { return jsonOf(doJSON(t, http.MethodGet, e.url, current, "", nil)) },
		"picture_replaced":   func() (int, any) { return jsonOf(doJSON(t, http.MethodGet, e.url, first, e.root, nil)) },
		"unsupported":        func() (int, any) { return jsonOf(uploadAvatar(t, e, e.bob, []byte("<svg/>"))) },
		"animated": func() (int, any) {
			return jsonOf(uploadAvatar(t, e, e.bob, append(append(append([]byte{}, still[:33]...), pngChunk("acTL", make([]byte, 8))...), still[33:]...)))
		},
		"too_many_pixels": func() (int, any) {
			return jsonOf(uploadAvatar(t, e, e.bob, append(append([]byte("\x89PNG\r\n\x1a\n"), pngChunk("IHDR", ihdr)...), pngChunk("IEND", nil)...)))
		},
		"too_large": func() (int, any) { return jsonOf(uploadAvatar(t, e, e.bob, append(still, make([]byte, 5<<20)...))) },
		"admin_remove": func() (int, any) {
			uploadAvatar(t, e, e.bob, still)
			return jsonOf(doJSON(t, http.MethodDelete, e.url, "/api/admin/users/"+bob+"/avatar", e.root, nil))
		},
		"admin_remove_none": func() (int, any) {
			return jsonOf(doJSON(t, http.MethodDelete, e.url, "/api/admin/users/"+bob+"/avatar", e.root, nil))
		},
		"remove": func() (int, any) {
			return jsonOf(doJSON(t, http.MethodDelete, e.url, "/api/account/avatar", e.bob, nil))
		},
	}
	order := []string{"upload", "me", "picture", "picture_small", "picture_other_size", "picture_anonymous", "picture_replaced",
		"unsupported", "animated", "too_many_pixels", "too_large", "admin_remove", "admin_remove_none", "remove"}
	fx := readFixture(t, "avatar.json")
	for _, name := range order {
		var c struct {
			Status  int               `json:"status"`
			Body    any               `json:"body"`
			Headers map[string]string `json:"headers"`
			Image   *struct {
				Format        string `json:"format"`
				Width, Height int
			} `json:"image"`
		}
		if err := json.Unmarshal(fx[name], &c); err != nil || fx[name] == nil {
			t.Fatalf("avatar.json/%s: %v", name, err)
		}
		if c.Image != nil {
			q := ""
			if c.Image.Width == 64 {
				q = "?size=64"
			}
			r := doJSON(t, http.MethodGet, e.url, current+q, e.bob, nil)
			raw, _ := io.ReadAll(r.Body)
			r.Body.Close()
			if r.StatusCode != c.Status {
				t.Errorf("avatar.json/%s: status %d, fixture says %d", name, r.StatusCode, c.Status)
			}
			for k, v := range c.Headers {
				if got := r.Header.Get(k); got != v {
					t.Errorf("avatar.json/%s: %s = %q, fixture says %q", name, k, got, v)
				}
			}
			cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
			if err != nil || format != c.Image.Format || cfg.Width != c.Image.Width || cfg.Height != c.Image.Height {
				t.Errorf("avatar.json/%s: %v %s %dx%d", name, err, format, cfg.Width, cfg.Height)
			}
			continue
		}
		status, got := jsonCases[name]()
		if status != c.Status {
			t.Errorf("avatar.json/%s: status %d, fixture says %d (%v)", name, status, c.Status, got)
		}
		if c.Body == nil {
			if got != nil {
				t.Errorf("avatar.json/%s: expected no body, got %v", name, got)
			}
			continue
		}
		sameShape(t, "avatar.json/"+name, c.Body, got)
		if want, ok := c.Body.(map[string]any)["error"]; ok {
			if g, _ := got.(map[string]any); g["error"] != want {
				t.Errorf("avatar.json/%s: error %v, fixture says %v", name, g["error"], want)
			}
		}
	}
	for name := range fx {
		if name[0] == '_' {
			continue
		}
		found := false
		for _, o := range order {
			found = found || o == name
		}
		if !found {
			t.Errorf("avatar.json: case %q is not exercised", name)
		}
	}
}
