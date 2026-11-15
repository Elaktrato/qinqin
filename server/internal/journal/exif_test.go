package journal

import "testing"

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
		if got := exifOrientation(in); got != 1 {
			t.Errorf("%s: got %d, want 1", name, got)
		}
	}
}

func TestExifOrientationValue(t *testing.T) {
	for _, o := range []uint16{1, 3, 6, 8} {
		if got := exifOrientation(exifJPEG(t, jpegBytes(t, solid(8, 8)), o)); got != int(o) {
			t.Errorf("orientation %d read as %d", o, got)
		}
	}
	if got := exifOrientation(exifJPEG(t, jpegBytes(t, solid(8, 8)), 9)); got != 1 {
		t.Errorf("out of range orientation read as %d, want 1", got)
	}
}

func FuzzExifOrientation(f *testing.F) {
	f.Add([]byte{0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10, 'E', 'x', 'i', 'f', 0, 0, 'M', 'M', 0, 42, 0, 0, 0, 8})
	f.Add([]byte("garbage"))
	f.Fuzz(func(t *testing.T, in []byte) {
		if o := exifOrientation(in); o < 1 || o > 8 {
			t.Fatalf("orientation %d out of range", o)
		}
	})
}
