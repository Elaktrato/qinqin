package datapkg_test

import (
	"slices"
	"testing"

	"qinqin/internal/datapkg"
)

// TestSentencesPackageCarriesTheirCredits: a credited pack sentence (its Tatoeba
// id and owner, and its translation's id and owner) keeps its credit in the
// package, on the sentence row, so an offline client can credit the author with
// no second lookup (CC BY 2.0 FR); an uncredited sentence has 0 and "". The
// sentences package is format 2 (the credit columns); every other type is still
// format 1, so installed packages of those are not rebuilt.
func TestSentencesPackageCarriesTheirCredits(t *testing.T) {
	s := seedAll(t)
	if _, err := s.db.Exec(`UPDATE sentences SET credit_id = 4706, credit_owner = 'bunbuku', credit_tr_id = 355041, credit_tr_owner = 'CK'
		WHERE hanzi = '你好！'`); err != nil {
		t.Fatal(err)
	}
	sp := openPackage(t, build(t, s, "sentences.zh-sent", 1).Path)
	if got := sp.strings(t, `SELECT credit_id || '|' || credit_owner || '|' || credit_tr_id || '|' || credit_tr_owner FROM sentences ORDER BY hanzi`); !slices.Equal(got, []string{"0||0|", "4706|bunbuku|355041|CK"}) {
		t.Errorf("credits = %q", got)
	}
	if got := sp.strings(t, `SELECT value FROM qq_package WHERE key = 'formatVersion'`); !slices.Equal(got, []string{"2"}) {
		t.Errorf("sentences formatVersion = %q, want 2", got)
	}
	m, err := datapkg.ParseManifest(sp.members["manifest.json"])
	if err != nil {
		t.Fatal(err)
	}
	if m.FormatVersion != 2 {
		t.Errorf("sentences manifest formatVersion = %d, want 2", m.FormatVersion)
	}
	fp := openPackage(t, build(t, s, "frequency.zh-freq", 1).Path)
	fm, err := datapkg.ParseManifest(fp.members["manifest.json"])
	if err != nil {
		t.Fatal(err)
	}
	if fm.FormatVersion != 1 || datapkg.FormatVersionOf(datapkg.TypeFrequency) != 1 || datapkg.FormatVersionOf(datapkg.TypeSentences) != 2 {
		t.Errorf("frequency formatVersion = %d", fm.FormatVersion)
	}
}
