package lookup

import (
	"slices"
	"testing"
)

// base is a candidate every per-key test starts from.
func base(id int64) candidate {
	return candidate{matchedLen: 2, dictOrder: 1, headword: "x", entryID: id}
}

// TestRankKeys checks each key of the sort chain: winner beats loser on
// the key under test while loser is better on every LATER key, so
// dropping the key (or moving it below a later one) flips the order.
func TestRankKeys(t *testing.T) {
	tests := []struct {
		name          string
		winner, loser func(c *candidate)
	}{
		{"primary reading match", func(c *candidate) {
			c.primary = true
		}, func(c *candidate) {
			c.matchedLen, c.freqRank, c.headword = 3, 1, "a"
		}},
		{"matched source length", func(c *candidate) {
			c.matchedLen = 3
		}, func(c *candidate) {
			c.freqRank, c.exactCount, c.ukPri, c.pri, c.headword = 1, 5, true, 100, "a"
		}},
		{"frequency order", func(c *candidate) {
			c.freqRank = 10
		}, func(c *candidate) {
			c.freqRank, c.chainLen, c.exactCount, c.headword = 20, 0, 5, "a"
		}},
		{"entries with frequency data before those without", func(c *candidate) {
			c.freqRank, c.chainLen = 50000, 2
		}, func(c *candidate) {
			c.freqRank, c.chainLen, c.exactCount, c.headword = 0, 0, 5, "a"
		}},
		{"inflection chain length", func(c *candidate) {
			c.chainLen = 0
		}, func(c *candidate) {
			c.chainLen, c.exactCount, c.ukPri, c.pri, c.headword = 1, 5, true, 100, "a"
		}},
		{"exact source-term matches", func(c *candidate) {
			c.exactCount = 2
		}, func(c *candidate) {
			c.exactCount, c.dictOrder, c.pri, c.headword = 1, 0, 100, "a"
		}},
		{"dictionary order", func(c *candidate) {
			c.dictOrder = 1
		}, func(c *candidate) {
			c.dictOrder, c.ukPri, c.pri, c.headword = 2, true, 100, "a"
		}},
		{"entry score: usually kana with priority", func(c *candidate) {
			c.ukPri, c.pri = true, 10
		}, func(c *candidate) {
			c.pri, c.headword = 100, "a"
		}},
		{"entry score: priority", func(c *candidate) {
			c.pri = 100
		}, func(c *candidate) {
			c.pri, c.headword = 10, "a"
		}},
		{"headword text", func(c *candidate) {
			c.headword = "a"
		}, func(c *candidate) {
			c.headword = "b"
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// The loser has the lower entry id, so even the final tiebreak
			// favours it.
			w, l := base(2), base(1)
			tt.winner(&w)
			tt.loser(&l)
			for _, in := range [][]candidate{{w, l}, {l, w}} {
				got := slices.Clone(in)
				sortCandidates(got)
				if got[0].entryID != w.entryID {
					t.Errorf("sorted %+v first, want %+v", got[0], w)
				}
			}
		})
	}
}

func TestRankFinalTiebreakIsEntryID(t *testing.T) {
	got := []candidate{base(9), base(3), base(5)}
	sortCandidates(got)
	var ids []int64
	for _, c := range got {
		ids = append(ids, c.entryID)
	}
	if want := []int64{3, 5, 9}; !slices.Equal(ids, want) {
		t.Errorf("ids = %v, want %v", ids, want)
	}
}

func TestRankingPackIsFirstPackWithAnyData(t *testing.T) {
	packs := []int64{7, 8, 9}
	freqs := [][]Frequency{
		{{PackID: 9, Rank: 1}},
		{{PackID: 8, Rank: 40}, {PackID: 9, Rank: 2}},
		nil,
	}
	got := rankingRanks(packs, freqs)
	// Pack 7 has no data at all, so pack 8 ranks: only the second entry
	// has data there; the others sort after it (0 = no data).
	if want := []int{0, 40, 0}; !slices.Equal(got, want) {
		t.Errorf("rankingRanks = %v, want %v", got, want)
	}
	if got := rankingRanks(packs, [][]Frequency{nil, nil}); !slices.Equal(got, []int{0, 0}) {
		t.Errorf("rankingRanks without data = %v, want all 0", got)
	}
}
