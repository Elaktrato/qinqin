package journal

import "fmt"

// TextHash is FNV-1a 64 over the UTF-8 bytes of text, written
// "fnv1a64:<16 hex>". The web computes the same value (crypto.subtle is
// missing on plain-HTTP installs); it only detects edits, it is not a
// security measure.
func TextHash(text string) string {
	h := uint64(0xcbf29ce484222325)
	for i := 0; i < len(text); i++ {
		h ^= uint64(text[i])
		h *= 0x100000001b3
	}
	return fmt.Sprintf("fnv1a64:%016x", h)
}
