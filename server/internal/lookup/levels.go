package lookup

import (
	"context"

	"qinqin/internal/levels"
)

// Level is the shared levels helper's type (internal/levels).
type Level = levels.Level

// levels returns the levels of each entry id through the shared batched
// query; the segmenter never asks for them.
func (s Service) levels(ctx context.Context, ids []int64) (map[int64][]Level, error) {
	return levels.LowestPerScheme(ctx, s.DB, ids)
}
