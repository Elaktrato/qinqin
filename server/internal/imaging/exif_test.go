package imaging

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
)

func solid(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 90, 255})
		}
	}
	return img
}

func jpegBytes(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// exifJPEG inserts an APP1 Exif segment holding only an orientation after
// the SOI of a JPEG.
func exifJPEG(t *testing.T, base []byte, orientation uint16) []byte {
	t.Helper()
	le := binary.LittleEndian
	tiff := []byte{'I', 'I', 42, 0, 8, 0, 0, 0}
	tiff = le.AppendUint16(tiff, 1)
	tiff = le.AppendUint16(tiff, 0x0112)
	tiff = le.AppendUint16(tiff, 3)
	tiff = le.AppendUint32(tiff, 1)
	tiff = le.AppendUint16(tiff, orientation)
	tiff = append(tiff, 0, 0)
	tiff = le.AppendUint32(tiff, 0)
	payload := append([]byte("Exif\x00\x00"), tiff...)
	seg := []byte{0xFF, 0xE1, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}
	out := append(append(append([]byte{}, base[:2]...), seg...), payload...)
	return append(out, base[2:]...)
}

func TestOrientRotates(t *testing.T) {
	img := solid(4, 2)
	img.Set(0, 0, color.RGBA{255, 0, 0, 255})
	cases := map[int]struct{ w, h, x, y int }{1: {4, 2, 0, 0}, 3: {4, 2, 3, 1}, 6: {2, 4, 1, 0}, 8: {2, 4, 0, 3}}
	for o, want := range cases {
		out := Orient(img, o)
		if b := out.Bounds(); b.Dx() != want.w || b.Dy() != want.h {
			t.Fatalf("orientation %d: %dx%d, want %dx%d", o, b.Dx(), b.Dy(), want.w, want.h)
		}
		if r, g, _, _ := out.At(want.x, want.y).RGBA(); r>>8 != 255 || g>>8 != 0 {
			t.Errorf("orientation %d: the red corner is not at %d,%d", o, want.x, want.y)
		}
	}
}

func TestExifOrientationMalformed(t *testing.T) {
	cases := map[string][]byte{
		"nil":       nil,
		"soi only":  {0xFF, 0xD8},
		"truncated": {0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x20, 'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42},
		"bad order": {0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10, 'E', 'x', 'i', 'f', 0, 0, 'X', 'X', 42, 0, 8, 0, 0, 0},
		"garbage":   []byte("not a jpeg at all"),
		"huge ifd":  {0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x18, 'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 0xFF, 0xFF, 0xFF, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF},
	}
	for name, in := range cases {
		if got := JPEGOrientation(in); got != 1 {
			t.Errorf("%s: got %d, want 1", name, got)
		}
	}
}

func TestExifOrientationValue(t *testing.T) {
	for _, o := range []uint16{1, 3, 6, 8} {
		if got := JPEGOrientation(exifJPEG(t, jpegBytes(t, solid(8, 8)), o)); got != int(o) {
			t.Errorf("orientation %d read as %d", o, got)
		}
	}
	if got := JPEGOrientation(exifJPEG(t, jpegBytes(t, solid(8, 8)), 9)); got != 1 {
		t.Errorf("out of range orientation read as %d, want 1", got)
	}
}

func FuzzExifOrientation(f *testing.F) {
	f.Add([]byte{0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10, 'E', 'x', 'i', 'f', 0, 0, 'M', 'M', 0, 42, 0, 0, 0, 8})
	f.Add([]byte("garbage"))
	f.Fuzz(func(t *testing.T, in []byte) {
		if o := JPEGOrientation(in); o < 1 || o > 8 {
			t.Fatalf("orientation %d out of range", o)
		}
	})
}
