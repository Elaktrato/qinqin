package journal

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

func TestOCRLanguages(t *testing.T) {
	for in, want := range map[string]string{"zh": "chi_sim+chi_tra", "ja": "jpn", "es": "eng", "en": "eng", "ko": "", "": ""} {
		if got := OCRLanguages(in); got != want {
			t.Errorf("OCRLanguages(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDetectTesseractMissing(t *testing.T) {
	tess := DetectTesseract(context.Background(), "/nonexistent/tesseract")
	if tess.Available() || tess.HasLanguages("eng") {
		t.Fatal("a missing binary must be unavailable")
	}
	if _, err := tess.Recognize(context.Background(), []byte("x"), "eng"); !errors.Is(err, ErrOCRUnavailable) {
		t.Fatalf("Recognize: %v", err)
	}
	var nilT *Tesseract
	if nilT.Available() || nilT.HasLanguages("eng") {
		t.Fatal("nil receiver")
	}
	if _, err := nilT.Recognize(context.Background(), nil, "eng"); !errors.Is(err, ErrOCRUnavailable) {
		t.Fatalf("nil Recognize: %v", err)
	}
}

func fakeTesseract(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "tesseract")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestDetectTesseractParsesLanguages(t *testing.T) {
	bin := fakeTesseract(t, `echo 'List of available languages in "/usr/share/tessdata/" (3):'; echo chi_sim; echo eng; echo osd`)
	tess := DetectTesseract(context.Background(), bin)
	if !tess.Available() || !tess.HasLanguages("eng") || !tess.HasLanguages("chi_sim+eng") || tess.HasLanguages("chi_sim+jpn") || tess.HasLanguages("") {
		t.Fatalf("languages: %+v", tess)
	}
	if _, err := tess.Recognize(context.Background(), []byte("x"), "jpn"); !errors.Is(err, ErrOCRLanguageMissing) {
		t.Fatalf("missing model: %v", err)
	}
}

// TestTesseractInvocation pins the exact argument vector, the environment and the
// temp file lifecycle with a script that records them.
func TestTesseractInvocation(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)
	t.Setenv("SECRET_ENV_VALUE", "leak")
	rec := filepath.Join(t.TempDir(), "rec")
	bin := fakeTesseract(t, `if [ "$1" = "--list-langs" ]; then echo header; echo eng; exit 0; fi
echo "$#|$2|$3|$4|$5|$6|$OMP_THREAD_LIMIT|$SECRET_ENV_VALUE" > `+rec+`
test -s "$1" && echo "  hello world  "`)
	tess := DetectTesseract(context.Background(), bin)
	got, err := tess.Recognize(context.Background(), []byte("jpegbytes"), "eng")
	if err != nil || got != "hello world" {
		t.Fatalf("Recognize = %q, %v", got, err)
	}
	b, _ := os.ReadFile(rec)
	if want := "6|stdout|-l|eng|--psm|3|1|\n"; string(b) != want {
		t.Fatalf("invocation = %q, want %q", b, want)
	}
	if left, _ := os.ReadDir(tmp); len(left) != 0 {
		t.Fatalf("temp files left: %v", left)
	}
}

func TestTesseractTimeout(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)
	bin := fakeTesseract(t, `if [ "$1" = "--list-langs" ]; then echo header; echo eng; exit 0; fi
exec sleep 10`)
	tess := DetectTesseract(context.Background(), bin)
	tess.timeout = 100 * time.Millisecond
	start := time.Now()
	if _, err := tess.Recognize(context.Background(), []byte("x"), "eng"); err == nil {
		t.Fatal("want a timeout error")
	}
	if time.Since(start) > 5*time.Second {
		t.Fatal("the process was not killed")
	}
	if left, _ := os.ReadDir(tmp); len(left) != 0 {
		t.Fatalf("temp files left after a timeout: %v", left)
	}
}

func TestTesseractBusyAndConcurrencyCap(t *testing.T) {
	bin := fakeTesseract(t, `if [ "$1" = "--list-langs" ]; then echo header; echo eng; exit 0; fi
exec sleep 3`)
	tess := DetectTesseract(context.Background(), bin)
	tess.timeout = 10 * time.Second
	tess.wait = 100 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for i := 0; i < 2; i++ {
		go tess.Recognize(ctx, []byte("x"), "eng")
	}
	time.Sleep(300 * time.Millisecond)
	if _, err := tess.Recognize(ctx, []byte("x"), "eng"); !errors.Is(err, ErrOCRBusy) {
		t.Fatalf("third reader: %v, want ErrOCRBusy", err)
	}
}

func TestTesseractRecognizesFixture(t *testing.T) {
	path, err := exec.LookPath("tesseract")
	if err != nil {
		if os.Getenv("QINQIN_REQUIRE_TESSERACT") == "1" {
			t.Fatal("QINQIN_REQUIRE_TESSERACT=1 but tesseract is not installed")
		}
		t.Skip("tesseract not installed")
	}
	src := image.NewRGBA(image.Rect(0, 0, 96, 30))
	draw.Draw(src, src.Bounds(), image.White, image.Point{}, draw.Src)
	d := font.Drawer{Dst: src, Src: image.NewUniform(color.Black), Face: basicfont.Face7x13, Dot: fixed.P(8, 19)}
	d.DrawString("QINQIN 2026")
	// The 7x13 bitmap font is tiny: scale it up with smoothing so the glyph
	// edges look like a scanned page rather than a staircase.
	big := image.NewRGBA(image.Rect(0, 0, 96*12, 30*12))
	xdraw.CatmullRom.Scale(big, big.Bounds(), src, src.Bounds(), xdraw.Src, nil)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, big, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	tess := DetectTesseract(context.Background(), path)
	if !tess.Available() || !tess.HasLanguages("eng") {
		t.Fatalf("tesseract at %s has no eng model", path)
	}
	got, err := tess.Recognize(context.Background(), buf.Bytes(), "eng")
	if err != nil {
		t.Fatal(err)
	}
	if norm := strings.ReplaceAll(strings.ToUpper(got), " ", ""); !strings.Contains(norm, "QINQIN") {
		t.Fatalf("read %q, want it to contain QINQIN", got)
	}
}
