package avatar

import (
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/color/palette"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"testing"
)

// picture is w×h with a red block in the top-left quarter on a green-blue
// gradient, so crops and rotations are visible in the pixels.
func picture(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := color.RGBA{0, uint8(x * 255 / w), uint8(y * 255 / h), 255}
			if x < w/4 && y < h/4 {
				c = color.RGBA{255, 0, 0, 255}
			}
			img.Set(x, y, c)
		}
	}
	return img
}

func jpegOf(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 92}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func pngOf(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

const gpsMark = "QINQIN-GPS-48.8584N-2.2945E"

// withExif puts an APP1 Exif segment after the SOI: IFD0 with an
// orientation, a camera model and a GPS IFD pointer; the GPS IFD with
// GPSLatitudeRef "N" and an ASCII GPS area name holding gpsMark.
func withExif(t *testing.T, jpg []byte, orientation uint16) []byte {
	t.Helper()
	le := binary.LittleEndian
	model := "QinqinCam 3000\x00"
	area := gpsMark + "\x00"
	// Layout: header 8, IFD0 at 8 (3 entries: 2+36+4 = 42 bytes), model at 50,
	// GPS IFD after it (2 entries: 2+24+4 = 30), the area string after that.
	modelOff := uint32(8 + 42)
	gpsOff := modelOff + uint32(len(model))
	areaOff := gpsOff + 30
	tiff := []byte{'I', 'I', 42, 0, 8, 0, 0, 0}
	tiff = le.AppendUint16(tiff, 3)
	entry := func(tag, typ uint16, count, value uint32) {
		tiff = le.AppendUint16(tiff, tag)
		tiff = le.AppendUint16(tiff, typ)
		tiff = le.AppendUint32(tiff, count)
		tiff = le.AppendUint32(tiff, value)
	}
	entry(0x0110, 2, uint32(len(model)), modelOff) // Model
	entry(0x0112, 3, 1, uint32(orientation))       // Orientation (SHORT in the low bytes)
	entry(0x8825, 4, 1, gpsOff)                    // GPS IFD pointer
	tiff = le.AppendUint32(tiff, 0)
	tiff = append(tiff, model...)
	tiff = le.AppendUint16(tiff, 2)
	entry(0x0001, 2, 2, uint32('N'))             // GPSLatitudeRef "N"
	entry(0x001C, 7, uint32(len(area)), areaOff) // GPSAreaInformation
	tiff = le.AppendUint32(tiff, 0)
	tiff = append(tiff, area...)
	payload := append([]byte("Exif\x00\x00"), tiff...)
	seg := []byte{0xFF, 0xE1, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}
	out := append(append(append([]byte{}, jpg[:2]...), seg...), payload...)
	return append(out, jpg[2:]...)
}

func chunk(typ string, data []byte) []byte {
	var b bytes.Buffer
	binary.Write(&b, binary.BigEndian, uint32(len(data)))
	b.WriteString(typ)
	b.Write(data)
	binary.Write(&b, binary.BigEndian, crc32.ChecksumIEEE(append([]byte(typ), data...)))
	return b.Bytes()
}

// insertBeforeIDAT puts extra PNG chunks right after IHDR.
func insertAfterIHDR(t *testing.T, p []byte, extra ...[]byte) []byte {
	t.Helper()
	const ihdrEnd = 8 + 8 + 13 + 4
	if string(p[12:16]) != "IHDR" {
		t.Fatal("not a PNG")
	}
	out := append([]byte{}, p[:ihdrEnd]...)
	for _, e := range extra {
		out = append(out, e...)
	}
	return append(out, p[ihdrEnd:]...)
}

func pngHeaderOnly(w, h uint32) []byte {
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], w)
	binary.BigEndian.PutUint32(ihdr[4:], h)
	ihdr[8], ihdr[9] = 8, 2
	var b bytes.Buffer
	b.WriteString("\x89PNG\r\n\x1a\n")
	b.Write(chunk("IHDR", ihdr))
	b.Write(chunk("IDAT", []byte{0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01}))
	b.Write(chunk("IEND", nil))
	return b.Bytes()
}

func riffChunk(typ string, data []byte) []byte {
	out := append([]byte(typ), 0, 0, 0, 0)
	binary.LittleEndian.PutUint32(out[4:], uint32(len(data)))
	out = append(out, data...)
	if len(data)%2 == 1 {
		out = append(out, 0)
	}
	return out
}

func riff(chunks ...[]byte) []byte {
	var body []byte
	body = append(body, "WEBP"...)
	for _, c := range chunks {
		body = append(body, c...)
	}
	out := append([]byte("RIFF"), 0, 0, 0, 0)
	binary.LittleEndian.PutUint32(out[4:], uint32(len(body)))
	return append(out, body...)
}

func vp8x(flags byte, w, h int) []byte {
	d := make([]byte, 10)
	d[0] = flags
	put24 := func(at, v int) { d[at], d[at+1], d[at+2] = byte(v), byte(v>>8), byte(v>>16) }
	put24(4, w-1)
	put24(7, h-1)
	return riffChunk("VP8X", d)
}

func stillWebP(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/still.webp")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// vp8Chunk is the VP8 chunk of the still WebP (everything after "WEBP").
func vp8Chunk(t *testing.T) []byte {
	t.Helper()
	return stillWebP(t)[12:]
}

func jpegSize(t *testing.T, b []byte) (int, int) {
	t.Helper()
	cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil || format != "jpeg" {
		t.Fatalf("output is not a JPEG: %v %q", err, format)
	}
	return cfg.Width, cfg.Height
}

// segments lists the marker bytes of a JPEG up to the start of the scan.
func segments(t *testing.T, b []byte) []byte {
	t.Helper()
	var out []byte
	i := 2
	for i+4 <= len(b) {
		if b[i] != 0xFF {
			t.Fatalf("malformed JPEG at %d", i)
		}
		m := b[i+1]
		out = append(out, m)
		if m == 0xDA {
			return out
		}
		i += 2 + int(binary.BigEndian.Uint16(b[i+2:]))
	}
	return out
}

func checkClean(t *testing.T, name string, b []byte, secrets ...string) {
	t.Helper()
	for _, m := range segments(t, b) {
		if (m >= 0xE0 && m <= 0xEF) || m == 0xFE {
			t.Errorf("%s: output carries an APP%d or comment segment (0x%X)", name, m-0xE0, m)
		}
	}
	for _, s := range append(secrets, "Exif", "QinqinCam", "http://ns.adobe.com/xap") {
		if bytes.Contains(b, []byte(s)) {
			t.Errorf("%s: output still holds %q", name, s)
		}
	}
}

func TestNormalizeStripsExifAndGPS(t *testing.T) {
	in := withExif(t, jpegOf(t, picture(300, 300)), 1)
	if !bytes.Contains(in, []byte(gpsMark)) || !bytes.Contains(in, []byte("Exif\x00\x00")) {
		t.Fatal("the fixture carries no EXIF or GPS")
	}
	got, err := Normalize(in)
	if err != nil {
		t.Fatal(err)
	}
	checkClean(t, "large", got.Large, gpsMark)
	checkClean(t, "small", got.Small, gpsMark)
}

func TestNormalizeStripsPNGTextAndExifChunks(t *testing.T) {
	secret := "Comment\x00home address: 1 Example Street"
	in := insertAfterIHDR(t, pngOf(t, picture(120, 120)),
		chunk("tEXt", []byte(secret)),
		chunk("iTXt", []byte("XML:com.adobe.xmp\x00\x00\x00\x00\x00<x:xmpmeta>http://ns.adobe.com/xap/1.0/</x:xmpmeta>")),
		chunk("eXIf", []byte("MM\x00\x2a"+gpsMark)))
	if _, err := png.Decode(bytes.NewReader(in)); err != nil {
		t.Fatalf("the fixture is not a valid PNG: %v", err)
	}
	got, err := Normalize(in)
	if err != nil {
		t.Fatal(err)
	}
	for name, b := range map[string][]byte{"large": got.Large, "small": got.Small} {
		checkClean(t, name, b, "home address", gpsMark, "xmpmeta")
	}
}

func TestNormalizeMakesTwoSquares(t *testing.T) {
	for name, in := range map[string][]byte{
		"jpeg": jpegOf(t, picture(300, 200)),
		"png":  pngOf(t, picture(200, 300)),
		"webp": stillWebP(t),
		"tiny": pngOf(t, picture(4, 4)),
	} {
		got, err := Normalize(in)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if w, h := jpegSize(t, got.Large); w != LargeSize || h != LargeSize {
			t.Errorf("%s: large is %dx%d", name, w, h)
		}
		if w, h := jpegSize(t, got.Small); w != SmallSize || h != SmallSize {
			t.Errorf("%s: small is %dx%d", name, w, h)
		}
	}
}

func TestNormalizeCropsTheCentre(t *testing.T) {
	// 400×200 with red in x < 100: the centre square is x 100..300, so no red.
	img := picture(400, 200)
	for y := 0; y < 200; y++ {
		for x := 0; x < 100; x++ {
			img.Set(x, y, color.RGBA{255, 0, 0, 255})
		}
	}
	got, err := Normalize(pngOf(t, img))
	if err != nil {
		t.Fatal(err)
	}
	dec, err := jpeg.Decode(bytes.NewReader(got.Large))
	if err != nil {
		t.Fatal(err)
	}
	if r, g, _, _ := dec.At(2, 128).RGBA(); r>>8 > 100 && g>>8 < 60 {
		t.Fatalf("the left edge is red: the crop is not centred")
	}
}

func TestNormalizeAppliesOrientation(t *testing.T) {
	// Orientation 3 is a half turn: the red top-left block ends bottom-right.
	got, err := Normalize(withExif(t, jpegOf(t, picture(64, 64)), 3))
	if err != nil {
		t.Fatal(err)
	}
	dec, err := jpeg.Decode(bytes.NewReader(got.Large))
	if err != nil {
		t.Fatal(err)
	}
	if r, g, _, _ := dec.At(250, 250).RGBA(); r>>8 < 200 || g>>8 > 80 {
		t.Fatalf("bottom-right is not red: %d %d", r>>8, g>>8)
	}
}

func TestNormalizeFlattensTransparencyOnWhite(t *testing.T) {
	got, err := Normalize(pngOf(t, image.NewNRGBA(image.Rect(0, 0, 10, 10))))
	if err != nil {
		t.Fatal(err)
	}
	dec, _ := jpeg.Decode(bytes.NewReader(got.Small))
	if r, g, b, _ := dec.At(30, 30).RGBA(); r>>8 < 245 || g>>8 < 245 || b>>8 < 245 {
		t.Fatalf("transparent pixels became %d %d %d, want white", r>>8, g>>8, b>>8)
	}
}

func animatedGIF(t *testing.T) []byte {
	t.Helper()
	frame := func(c uint8) *image.Paletted {
		p := image.NewPaletted(image.Rect(0, 0, 8, 8), palette.Plan9)
		for i := range p.Pix {
			p.Pix[i] = c
		}
		return p
	}
	var b bytes.Buffer
	if err := gif.EncodeAll(&b, &gif.GIF{Image: []*image.Paletted{frame(1), frame(2)}, Delay: []int{10, 10}}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestNormalizeRefusesOtherTypes(t *testing.T) {
	for name, in := range map[string][]byte{
		"empty":         nil,
		"text":          []byte("hello, this is not a picture at all"),
		"svg":           []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="5"/></svg>`),
		"svg with bom":  []byte("\xef\xbb\xbf<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
		"gif":           animatedGIF(t),
		"bmp":           append([]byte("BM"), make([]byte, 60)...),
		"html":          []byte("<!doctype html><img src=x onerror=alert(1)>"),
		"jpeg header":   {0xFF, 0xD8, 0xFF, 0xE0, 0, 0},
		"truncated png": pngOf(t, picture(50, 50))[:60],
	} {
		if _, err := Normalize(in); !errors.Is(err, ErrUnsupported) {
			t.Errorf("%s: err = %v, want ErrUnsupported", name, err)
		}
	}
}

func TestNormalizeRefusesAnimation(t *testing.T) {
	actl := make([]byte, 8)
	binary.BigEndian.PutUint32(actl[0:], 2) // frames
	apng := insertAfterIHDR(t, pngOf(t, picture(16, 16)), chunk("acTL", actl))
	if _, err := png.Decode(bytes.NewReader(apng)); err != nil {
		t.Fatalf("the APNG fixture does not decode as a still PNG: %v", err)
	}
	vp8 := vp8Chunk(t)
	for name, in := range map[string][]byte{
		"apng":                apng,
		"animated webp":       riff(vp8x(0x02, 150, 100), riffChunk("ANIM", make([]byte, 6)), riffChunk("ANMF", append(make([]byte, 16), vp8...))),
		"webp frame, no flag": riff(vp8x(0x00, 150, 100), riffChunk("ANMF", append(make([]byte, 16), vp8...))),
		"webp anim flag only": riff(vp8x(0x02, 150, 100), vp8),
	} {
		if _, err := Normalize(in); !errors.Is(err, ErrAnimated) {
			t.Errorf("%s: err = %v, want ErrAnimated", name, err)
		}
	}
	// A still extended WebP (VP8X without the animation flag) is fine.
	if _, err := Normalize(riff(vp8x(0x00, 150, 100), vp8)); err != nil {
		t.Errorf("still VP8X WebP: %v", err)
	}
}

func TestNormalizeRefusesHugeDimensionsBeforeDecoding(t *testing.T) {
	// Headers only: a full decode of these would fail as malformed, so
	// ErrTooLarge proves the size was refused from the header.
	for name, in := range map[string][]byte{
		"26 megapixels": pngHeaderOnly(5100, 5100),
		"9000 px wide":  pngHeaderOnly(9000, 10),
		"9000 px high":  pngHeaderOnly(10, 9000),
		"webp 16k":      riff(vp8x(0x00, 16000, 16000), vp8Chunk(t)),
	} {
		if _, err := Normalize(in); !errors.Is(err, ErrTooLarge) {
			t.Errorf("%s: err = %v, want ErrTooLarge", name, err)
		}
	}
}

func TestNormalizeRefusesTooManyBytes(t *testing.T) {
	big := append(pngOf(t, picture(8, 8)), make([]byte, MaxBytes)...)
	if _, err := Normalize(big); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err = %v, want ErrTooLarge", err)
	}
}

func TestNormalizeIsDeterministic(t *testing.T) {
	in := pngOf(t, picture(90, 70))
	a, err := Normalize(in)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := Normalize(in)
	if !bytes.Equal(a.Large, b.Large) || !bytes.Equal(a.Small, b.Small) {
		t.Fatal("the same input gave different files (the hash would change)")
	}
}
