package imaging

import (
	"context"
	"sync"
)

// DecodeSlots is how many pictures the server decodes at once, for every
// caller together (journal photos, profile pictures, profile pictures in a
// restored archive): a 25 megapixel decode holds about 100 MB.
const DecodeSlots = 2

var slots = make(chan struct{}, DecodeSlots)

// AcquireDecode waits for a decode slot or for ctx to end. The release
// gives the slot back; calling it more than once is harmless.
func AcquireDecode(ctx context.Context) (release func(), err error) {
	select {
	case slots <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	var once sync.Once
	return func() { once.Do(func() { <-slots }) }, nil
}
