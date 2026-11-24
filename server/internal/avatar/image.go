// Package avatar stores the profile pictures (#189, docs/contracts/auth/avatar.json):
// an upload is decoded and written again as two fresh square JPEGs, so
// nothing of the uploaded file but its pixels is kept.
package avatar

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png" // registers the PNG decoder

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // registers the WebP decoder

	"qinqin/internal/imaging"
)

// The sizes kept, the upload cap and the decode caps.
const (
	LargeSize = 256
	SmallSize = 64
	MaxBytes  = 5 << 20    // an upload, counted while it is read
	MaxSide   = 8192       // px, either side, from the header
	MaxPixels = 25_000_000 // from the header, before any pixel is decoded
	// MaxDecodedBytes caps the decoded picture: 25 MP at 4 bytes a pixel,
	// so a 16-bit picture (8 bytes a pixel) may have half as many pixels.
	MaxDecodedBytes = 100 << 20
	quality         = 85
)

var (
	ErrUnsupported = errors.New("avatar: not a JPEG, PNG or WebP image")
	ErrAnimated    = errors.New("avatar: an animated image")
	ErrTooLarge    = errors.New("avatar: image too large")
)

// Images are the two files of one picture.
type Images struct{ Large, Small []byte }

type kind int

const (
	kindNone kind = iota
	kindJPEG
	kindPNG
	kindWebP
)

// sniff tells the type from the first bytes only; the extension and any
// declared content type are never consulted.
func sniff(b []byte) kind {
	switch {
	case len(b) >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF:
		return kindJPEG
	case len(b) >= 8 && string(b[:8]) == "\x89PNG\r\n\x1a\n":
		return kindPNG
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return kindWebP
	}
	return kindNone
}

// pngAnimated reports an APNG: an acTL chunk before the first IDAT.
func pngAnimated(b []byte) bool {
	for i := 8; i+8 <= len(b); {
		n := int(binary.BigEndian.Uint32(b[i:]))
		typ := string(b[i+4 : i+8])
		switch typ {
		case "acTL", "fcTL", "fdAT":
			return true
		case "IDAT", "IEND":
			return false
		}
		if n < 0 || n > len(b) {
			return false
		}
		i += 12 + n
	}
	return false
}

// webpAnimated reports an animated WebP: a VP8X header with the animation
// flag, or an ANIM or ANMF chunk anywhere.
func webpAnimated(b []byte) bool {
	for i := 12; i+8 <= len(b); {
		typ := string(b[i : i+4])
		n := int(binary.LittleEndian.Uint32(b[i+4:]))
		switch typ {
		case "ANIM", "ANMF":
			return true
		case "VP8X":
			if i+9 <= len(b) && b[i+8]&0x02 != 0 {
				return true
			}
		}
		if n < 0 || n > len(b) {
			return false
		}
		i += 8 + n + n%2
	}
	return false
}

// bytesPerPixel is what the standard decoders allocate per pixel for a
// colour model (YCbCr counted as 4:4:4, the largest).
func bytesPerPixel(m color.Model) int64 {
	switch m {
	case color.RGBA64Model, color.NRGBA64Model:
		return 8
	case color.Gray16Model:
		return 2
	case color.GrayModel, color.AlphaModel:
		return 1
	case color.YCbCrModel:
		return 3
	}
	if _, ok := m.(color.Palette); ok {
		return 1
	}
	return 4
}

// Normalize turns an upload into the two stored files: the type sniffed
// from the content (JPEG, PNG, WebP; anything else, SVG and GIF included, is
// ErrUnsupported), animation refused (ErrAnimated), the size checked from
// the header before any pixel is decoded (ErrTooLarge: pixels, sides and the
// decoded bytes), the decode in one of the shared decode slots
// (imaging.AcquireDecode; ctx ends the wait), the centre square scaled
// straight from the decoded picture onto white 256 and 64 px squares (no
// full-size copy), the EXIF orientation of a JPEG applied to those squares,
// each encoded as a new JPEG. EXIF, XMP, ICC profiles and text chunks do not
// survive: only pixels are copied.
func Normalize(ctx context.Context, data []byte) (Images, error) {
	if len(data) > MaxBytes {
		return Images{}, ErrTooLarge
	}
	k := sniff(data)
	switch {
	case k == kindNone:
		return Images{}, ErrUnsupported
	case k == kindPNG && pngAnimated(data), k == kindWebP && webpAnimated(data):
		return Images{}, ErrAnimated
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return Images{}, ErrUnsupported
	}
	px := int64(cfg.Width) * int64(cfg.Height)
	if cfg.Width > MaxSide || cfg.Height > MaxSide || px > MaxPixels || px*bytesPerPixel(cfg.ColorModel) > MaxDecodedBytes {
		return Images{}, ErrTooLarge
	}
	release, err := imaging.AcquireDecode(ctx)
	if err != nil {
		return Images{}, err
	}
	defer release()
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return Images{}, ErrUnsupported
	}
	orientation := 1
	if k == kindJPEG {
		orientation = imaging.JPEGOrientation(data)
	}
	// Every orientation turns or flips about the centre, so the centre
	// square of the upright picture is the centre square of the source.
	b := src.Bounds()
	side := min(b.Dx(), b.Dy())
	x0, y0 := b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2
	square := image.Rect(x0, y0, x0+side, y0+side)
	// Halve the square (a 2×2 average each time) while it is at least twice
	// the large size, so CatmullRom, whose buffer is the target's width times
	// the source's height, works on at most about 512 px.
	var from image.Image = src
	fromRect := square
	for fromRect.Dx() >= 2*LargeSize {
		half := image.NewRGBA(image.Rect(0, 0, fromRect.Dx()/2, fromRect.Dy()/2))
		xdraw.ApproxBiLinear.Scale(half, half.Bounds(), from, fromRect, xdraw.Src, nil)
		from, fromRect = half, half.Bounds()
	}
	var out Images
	for _, s := range []struct {
		size int
		dst  *[]byte
	}{{LargeSize, &out.Large}, {SmallSize, &out.Small}} {
		dst := image.NewRGBA(image.Rect(0, 0, s.size, s.size))
		xdraw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, xdraw.Src)
		xdraw.CatmullRom.Scale(dst, dst.Bounds(), from, fromRect, xdraw.Over, nil)
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, imaging.Orient(dst, orientation), &jpeg.Options{Quality: quality}); err != nil {
			return Images{}, err
		}
		*s.dst = buf.Bytes()
	}
	return out, nil
}
