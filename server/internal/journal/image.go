package journal

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png" // registers the PNG decoder

	xdraw "golang.org/x/image/draw"

	_ "golang.org/x/image/webp" // registers the WebP decoder
	"qinqin/internal/imaging"
)

var (
	ErrUnsupportedImage = errors.New("journal: not a JPEG, PNG or WebP image")
	ErrImageTooLarge    = errors.New("journal: image over 25 megapixels")
)

const (
	maxMegapixels = 25
	maxLongEdge   = 2576
	minLongEdge   = 600
)

// maxResult is the largest JPEG we keep: 3.75 MB raw is 5 MB as base64, the
// API's image limit. A variable so tests can force the shrinking loop.
var maxResult = 3_750_000

var jpegQualities = []int{85, 70, 55, 40}

func sniffImage(b []byte) (jpegFile bool, ok bool) {
	switch {
	case len(b) >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF:
		return true, true
	case len(b) >= 8 && string(b[:8]) == "\x89PNG\r\n\x1a\n":
		return false, true
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return false, true
	}
	return false, false
}

// NormalizePhoto turns an uploaded JPEG, PNG or WebP into the JPEG the app
// keeps and sends: type sniffed from the content, size checked from the
// header before any pixel is decoded, long edge at most 2576 px, at most 3.75 MB (so 5 MB as base64), EXIF
// orientation applied and every metadata segment (GPS included) dropped by
// re-encoding, transparency flattened onto white.
func NormalizePhoto(data []byte) ([]byte, error) {
	isJPEG, ok := sniffImage(data)
	if !ok {
		return nil, ErrUnsupportedImage
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, ErrUnsupportedImage
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, ErrUnsupportedImage
	}
	if int64(cfg.Width)*int64(cfg.Height) > maxMegapixels*1_000_000 {
		return nil, ErrImageTooLarge
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, ErrUnsupportedImage
	}
	orientation := 1
	if isJPEG {
		orientation = imaging.JPEGOrientation(data)
	}
	// The API takes at most 5 MB after base64, so the JPEG must fit maxResult
	// raw bytes: step the quality down, then the long edge, until it does.
	edge := min(max(cfg.Width, cfg.Height), maxLongEdge)
	var last []byte
	for {
		w, h := cfg.Width, cfg.Height
		if long := max(w, h); long > edge {
			w, h = max(1, w*edge/long), max(1, h*edge/long)
		}
		dst := image.NewRGBA(image.Rect(0, 0, w, h))
		xdraw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, xdraw.Src)
		if w == cfg.Width && h == cfg.Height {
			xdraw.Draw(dst, dst.Bounds(), src, src.Bounds().Min, xdraw.Over)
		} else {
			xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), xdraw.Over, nil)
		}
		var out image.Image = dst
		if isJPEG {
			out = imaging.Orient(dst, orientation)
		}
		for _, q := range jpegQualities {
			var b bytes.Buffer
			if err := jpeg.Encode(&b, out, &jpeg.Options{Quality: q}); err != nil {
				return nil, err
			}
			last = b.Bytes()
			if len(last) <= maxResult {
				return last, nil
			}
		}
		if edge <= minLongEdge {
			return last, nil
		}
		edge = max(minLongEdge, edge*4/5)
	}
}
