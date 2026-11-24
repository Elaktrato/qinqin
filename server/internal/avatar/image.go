// Package avatar stores the profile pictures (#189, docs/contracts/auth/avatar.json):
// an upload is decoded and written again as two fresh square JPEGs, so
// nothing of the uploaded file but its pixels is kept.
package avatar

import (
	"bytes"
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
	quality   = 85
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

// Normalize turns an upload into the two stored files: the type sniffed
// from the content (JPEG, PNG, WebP; anything else, SVG and GIF included, is
// ErrUnsupported), animation refused (ErrAnimated), the size checked from
// the header before any pixel is decoded (ErrTooLarge), the EXIF orientation
// of a JPEG applied, transparency flattened onto white, the centre square
// cropped and scaled to 256 and 64 px, each encoded as a new JPEG. EXIF, XMP,
// ICC profiles and text chunks do not survive: only pixels are copied.
func Normalize(data []byte) (Images, error) {
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
	if cfg.Width > MaxSide || cfg.Height > MaxSide || int64(cfg.Width)*int64(cfg.Height) > MaxPixels {
		return Images{}, ErrTooLarge
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return Images{}, ErrUnsupported
	}
	b := src.Bounds()
	flat := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	xdraw.Draw(flat, flat.Bounds(), image.NewUniform(color.White), image.Point{}, xdraw.Src)
	xdraw.Draw(flat, flat.Bounds(), src, b.Min, xdraw.Over)
	var upright image.Image = flat
	if k == kindJPEG {
		upright = imaging.Orient(flat, imaging.JPEGOrientation(data))
	}
	ub := upright.Bounds()
	side := min(ub.Dx(), ub.Dy())
	x0, y0 := ub.Min.X+(ub.Dx()-side)/2, ub.Min.Y+(ub.Dy()-side)/2
	square := image.Rect(x0, y0, x0+side, y0+side)
	var out Images
	for _, s := range []struct {
		size int
		dst  *[]byte
	}{{LargeSize, &out.Large}, {SmallSize, &out.Small}} {
		dst := image.NewRGBA(image.Rect(0, 0, s.size, s.size))
		xdraw.CatmullRom.Scale(dst, dst.Bounds(), upright, square, xdraw.Src, nil)
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: quality}); err != nil {
			return Images{}, err
		}
		*s.dst = buf.Bytes()
	}
	return out, nil
}
