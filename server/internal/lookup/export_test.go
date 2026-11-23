package lookup

import "qinqin/internal/lemma"

// ProbeStats builds the probes of window with rules and reports how many
// there are, how many are compound stem probes, whether two compound
// probes share a (stem, class), and the Deinflect work the window spent.
func ProbeStats(rules *lemma.Table, window string) (probes, compounds int, duplicate bool, work int) {
	ps, w := buildProbes(rules, []rune(window))
	seen := map[compoundKey]bool{}
	for _, p := range ps {
		if p.compound {
			compounds++
			k := compoundKey{p.term, p.class, p.length}
			duplicate = duplicate || seen[k]
			seen[k] = true
		}
	}
	return len(ps), compounds, duplicate, w
}
