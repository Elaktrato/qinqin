package lexicon_test

import (
	"context"
	"errors"
	"testing"

	"qinqin/internal/lexicon"
)

// TestBestWordReadingIDMatchesBestWordReading: the id-only resolution
// answers exactly what BestWordReading answers — the same entry's id, or
// ErrNotFound — on every Best/BestWord/BestWordReading fixture.
func TestBestWordReadingIDMatchesBestWordReading(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name, xml string
		lookups   [][2]string // form, reading
	}{
		{"reading", readingJMdict, [][2]string{
			{"風", "かぜ"}, {"風", "カゼ"}, {"風", "ふり"}, {"風", ""}, {"風", "ほげ"}, {"ふり", "ふり"}, {"雨", ""},
		}},
		{"script", scriptJMdict, [][2]string{
			{"もの", ""}, {"モノ", ""}, {"ダレ", ""}, {"テレビ", ""}, {"だれ", ""}, {"てれび", ""},
		}},
		{"bestword", bestWordJMdict, [][2]string{
			{"する", ""}, {"これ", ""}, {"テレビ", ""}, {"ここ", ""}, {"それ", ""}, {"いる", ""},
			{"すり", ""}, {"刷", ""}, {"おる", ""}, {"為る", "する"},
		}},
	} {
		st := newStore(t)
		importJMdict(t, st, tc.xml)
		for _, l := range tc.lookups {
			want, wantErr := st.BestWordReading(ctx, "ja", l[0], l[1])
			id, err := st.BestWordReadingID(ctx, "ja", l[0], l[1])
			switch {
			case errors.Is(wantErr, lexicon.ErrNotFound):
				if !errors.Is(err, lexicon.ErrNotFound) {
					t.Errorf("%s: BestWordReadingID(%s, %s) = %d, %v; want ErrNotFound", tc.name, l[0], l[1], id, err)
				}
			case wantErr != nil:
				t.Fatalf("%s: BestWordReading(%s, %s): %v", tc.name, l[0], l[1], wantErr)
			case err != nil || id != want.ID:
				t.Errorf("%s: BestWordReadingID(%s, %s) = %d, %v; want %d (%s)", tc.name, l[0], l[1], id, err, want.ID, want.Key)
			}
		}
	}
}
