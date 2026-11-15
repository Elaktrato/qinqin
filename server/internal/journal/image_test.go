package journal

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math/rand"
	"os"
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

func dims(t *testing.T, data []byte) (int, int) {
	t.Helper()
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || format != "jpeg" {
		t.Fatalf("output is not a JPEG: %v %q", err, format)
	}
	return cfg.Width, cfg.Height
}

func TestNormalizePhotoTypes(t *testing.T) {
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, solid(30, 20)); err != nil {
		t.Fatal(err)
	}
	webp, err := os.ReadFile("testdata/photo.webp")
	if err != nil {
		t.Fatal(err)
	}
	for name, in := range map[string][]byte{"jpeg": jpegBytes(t, solid(30, 20)), "png": pngBuf.Bytes(), "webp": webp} {
		out, err := NormalizePhoto(in)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		dims(t, out)
	}
	for name, in := range map[string][]byte{"gif": []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"), "text": []byte("hello world, not an image"), "empty": nil} {
		if _, err := NormalizePhoto(in); err != ErrUnsupportedImage {
			t.Fatalf("%s: err = %v, want ErrUnsupportedImage", name, err)
		}
	}
}

func TestNormalizePhotoDownscales(t *testing.T) {
	out, err := NormalizePhoto(jpegBytes(t, image.NewGray(image.Rect(0, 0, 4000, 3000))))
	if err != nil {
		t.Fatal(err)
	}
	if w, h := dims(t, out); w != 2576 || h != 1932 {
		t.Fatalf("got %dx%d, want 2576x1932", w, h)
	}
}

func TestNormalizePhotoRejectsBomb(t *testing.T) {
	chunk := func(typ string, data []byte) []byte {
		var b bytes.Buffer
		binary.Write(&b, binary.BigEndian, uint32(len(data)))
		b.WriteString(typ)
		b.Write(data)
		binary.Write(&b, binary.BigEndian, crc32.ChecksumIEEE(append([]byte(typ), data...)))
		return b.Bytes()
	}
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], 5100)
	binary.BigEndian.PutUint32(ihdr[4:], 5100) // 26 MP
	ihdr[8], ihdr[9] = 8, 2
	var b bytes.Buffer
	b.WriteString("\x89PNG\r\n\x1a\n")
	b.Write(chunk("IHDR", ihdr))
	b.Write(chunk("IDAT", []byte{0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01}))
	b.Write(chunk("IEND", nil))
	if _, err := NormalizePhoto(b.Bytes()); err != ErrImageTooLarge {
		t.Fatalf("err = %v, want ErrImageTooLarge", err)
	}
}

// exifJPEG inserts an APP1 Exif segment (orientation + a GPS IFD pointer)
// after the SOI of a JPEG.
func exifJPEG(t *testing.T, base []byte, orientation uint16) []byte {
	t.Helper()
	le := binary.LittleEndian
	tiff := make([]byte, 0, 64)
	tiff = append(tiff, 'I', 'I', 42, 0, 8, 0, 0, 0)
	tiff = le.AppendUint16(tiff, 2) // two IFD0 entries
	tiff = le.AppendUint16(tiff, 0x0112)
	tiff = le.AppendUint16(tiff, 3)
	tiff = le.AppendUint32(tiff, 1)
	tiff = le.AppendUint16(tiff, orientation)
	tiff = append(tiff, 0, 0)
	tiff = le.AppendUint16(tiff, 0x8825) // GPS IFD pointer
	tiff = le.AppendUint16(tiff, 4)
	tiff = le.AppendUint32(tiff, 1)
	tiff = le.AppendUint32(tiff, 40)
	tiff = le.AppendUint32(tiff, 0)
	tiff = le.AppendUint16(tiff, 0) // GPS IFD: no entries
	payload := append([]byte("Exif\x00\x00"), tiff...)
	seg := []byte{0xFF, 0xE1, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}
	seg = append(seg, payload...)
	out := append([]byte{}, base[:2]...)
	out = append(out, seg...)
	return append(out, base[2:]...)
}

func TestNormalizePhotoAppliesOrientationAndStripsExif(t *testing.T) {
	in := exifJPEG(t, jpegBytes(t, solid(40, 20)), 6)
	if !bytes.Contains(in, []byte("Exif\x00\x00")) {
		t.Fatal("fixture has no Exif")
	}
	out, err := NormalizePhoto(in)
	if err != nil {
		t.Fatal(err)
	}
	if w, h := dims(t, out); w != 20 || h != 40 {
		t.Fatalf("got %dx%d, want 20x40", w, h)
	}
	if bytes.Contains(out, []byte("Exif\x00\x00")) {
		t.Fatal("output still carries Exif")
	}
}

func TestNormalizePhotoOrientationPixels(t *testing.T) {
	// Orientation 3 rotates 180 degrees: a red top-left pixel ends bottom-right.
	img := image.NewRGBA(image.Rect(0, 0, 16, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			img.Set(x, y, color.RGBA{255, 255, 255, 255})
		}
	}
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, color.RGBA{255, 0, 0, 255})
		}
	}
	out, err := NormalizePhoto(exifJPEG(t, jpegBytes(t, img), 3))
	if err != nil {
		t.Fatal(err)
	}
	dec, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	r, g, _, _ := dec.At(12, 12).RGBA()
	if r>>8 < 200 || g>>8 > 80 {
		t.Fatalf("bottom-right pixel is not red: %d %d", r>>8, g>>8)
	}
}

func TestNormalizePhotoFitsTheAPILimit(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	img := image.NewRGBA(image.Rect(0, 0, 3000, 2250))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = byte(rng.Intn(256)), byte(rng.Intn(256)), byte(rng.Intn(256)), 255
	}
	var in bytes.Buffer
	if err := png.Encode(&in, img); err != nil {
		t.Fatal(err)
	}
	out, err := NormalizePhoto(in.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(out) > 3_750_000 {
		t.Fatalf("output is %d bytes, over the 3.75 MB that fits 5 MB as base64", len(out))
	}
	dims(t, out)
}

func TestNormalizePhotoShrinksUntilItFits(t *testing.T) {
	old := maxResult
	maxResult = 300_000
	t.Cleanup(func() { maxResult = old })
	rng := rand.New(rand.NewSource(2))
	img := image.NewRGBA(image.Rect(0, 0, 2000, 1500))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = byte(rng.Intn(256)), byte(rng.Intn(256)), byte(rng.Intn(256)), 255
	}
	out, err := NormalizePhoto(jpegBytes(t, img))
	if err != nil {
		t.Fatal(err)
	}
	w, _ := dims(t, out)
	if len(out) > maxResult || w >= 2000 {
		t.Fatalf("output %d bytes, width %d: not shrunk to fit", len(out), w)
	}
}
