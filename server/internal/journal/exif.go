package journal

import "encoding/binary"

// exifOrientation returns the EXIF orientation (1..8) of a JPEG, or 1 when
// there is none or the data is malformed. Every read is bounds-checked.
func exifOrientation(jpeg []byte) int {
	if len(jpeg) < 4 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
		return 1
	}
	i := 2
	for i+4 <= len(jpeg) {
		if jpeg[i] != 0xFF {
			return 1
		}
		m := jpeg[i+1]
		if m == 0xFF { // fill byte
			i++
			continue
		}
		if m == 0xD8 || m == 0x01 || (m >= 0xD0 && m <= 0xD7) { // no length
			i += 2
			continue
		}
		if m == 0xDA || m == 0xD9 { // scan data or end: no more headers
			return 1
		}
		n := int(binary.BigEndian.Uint16(jpeg[i+2:]))
		if n < 2 || i+2+n > len(jpeg) {
			return 1
		}
		seg := jpeg[i+4 : i+2+n]
		if m == 0xE1 && len(seg) >= 6 && string(seg[:6]) == "Exif\x00\x00" {
			return tiffOrientation(seg[6:])
		}
		i += 2 + n
	}
	return 1
}

func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 1
	}
	var bo binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 1
	}
	if bo.Uint16(t[2:]) != 42 {
		return 1
	}
	off := uint64(bo.Uint32(t[4:]))
	if off+2 > uint64(len(t)) {
		return 1
	}
	count := uint64(bo.Uint16(t[off:]))
	for k := uint64(0); k < count; k++ {
		e := off + 2 + k*12
		if e+12 > uint64(len(t)) {
			return 1
		}
		if bo.Uint16(t[e:]) != 0x0112 {
			continue
		}
		if bo.Uint16(t[e+2:]) != 3 || bo.Uint32(t[e+4:]) != 1 {
			return 1
		}
		if v := int(bo.Uint16(t[e+8:])); v >= 1 && v <= 8 {
			return v
		}
		return 1
	}
	return 1
}
