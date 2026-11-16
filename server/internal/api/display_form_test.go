package api_test

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/lang"
)

// displayJMdict holds の (both written forms search-only), 為る (usually
// kana) and 犬 (uk on a later sense only).
const displayJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY uk "word usually written using kana alone">
]>
<JMdict>
<entry>
<ent_seq>1469800</ent_seq>
<k_ele><keb>乃</keb><ke_inf>&sK;</ke_inf></k_ele>
<k_ele><keb>之</keb><ke_inf>&sK;</ke_inf></k_ele>
<r_ele><reb>の</reb><re_pri>spec1</re_pri></r_ele>
<sense><pos>&prt;</pos><gloss>indicates possessive</gloss></sense>
</entry>
<entry>
<ent_seq>1157170</ent_seq>
<k_ele><keb>為る</keb><ke_inf>&rK;</ke_inf></k_ele>
<r_ele><reb>する</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&vs-i;</pos><misc>&uk;</misc><gloss>to do</gloss></sense>
</entry>
<entry>
<ent_seq>1258330</ent_seq>
<k_ele><keb>犬</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>いぬ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>dog</gloss></sense>
<sense><pos>&n;</pos><misc>&derog;</misc><misc>&uk;</misc><gloss>snoop</gloss></sense>
</entry>
</JMdict>
`

// TestEntryShowsTheDisplayForm: an entry's written is its display form;
// its forms still list every written form with its flags.
func TestEntryShowsTheDisplayForm(t *testing.T) {
	lang.Register(lang.Ja{})
	ts, sqlDB := newServer(t)
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", displayJMdict)
	for _, tt := range []struct{ key, written, forms string }{
		{"j:1469800", "の", "乃:sK,之:sK"},
		{"j:1157170", "する", "為る:rK"},
		{"j:1258330", "犬", "犬:"},
	} {
		id := lexID(t, sqlDB, "ja", "word", tt.key)
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/entries/"+strconv.FormatInt(id, 10), "", nil)
		var body struct {
			Written string `json:"written"`
			Forms   []struct {
				Text  string   `json:"text"`
				Flags []string `json:"flags"`
			} `json:"forms"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		var forms []string
		for _, f := range body.Forms {
			forms = append(forms, f.Text+":"+strings.Join(f.Flags, " "))
		}
		if body.Written != tt.written || strings.Join(forms, ",") != tt.forms {
			t.Errorf("%s: written %q forms %v, want %q %s", tt.key, body.Written, forms, tt.written, tt.forms)
		}
	}
}

// TestFrequencyTopShowsTheListKana: a starter deck word whose row is
// written in kana is served (and so snapshotted) in that kana when it is
// one of the entry's readings — いぬ for a row いぬ, although 犬's display
// form is 犬 (uk on a later sense only); する for the usually-kana 為る.
func TestFrequencyTopShowsTheListKana(t *testing.T) {
	lang.Register(lang.Ja{})
	ts, sqlDB := newServer(t)
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", displayJMdict)
	packID := importFreqPack(t, sqlDB, "toy-freq", "ja", "いぬ,,1\nする,,2\n")
	alice := registerUser(t, ts.URL, "alice", "")
	var got topBody
	decodeJSON(t, getTop(t, ts.URL, alice, packID, "?size=500"), &got)
	var written []string
	for _, e := range got.Entries {
		written = append(written, e.Written)
	}
	if strings.Join(written, ",") != "いぬ,する" {
		t.Errorf("written = %v, want いぬ,する", written)
	}
}

// TestSearchShowsTheMatchedForm: a written-form hit shows the form that
// matched (為る searched shows 為る, as a lookup does), unless that form is
// search-only (之 shows の); a reading hit shows the display form.
func TestSearchShowsTheMatchedForm(t *testing.T) {
	lang.Register(lang.Ja{})
	ts, sqlDB := newServer(t)
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", displayJMdict)
	for _, tt := range []struct{ q, written string }{{"為る", "為る"}, {"之", "の"}, {"する", "する"}} {
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/search?lang=ja&q="+tt.q, "", nil)
		var hits []struct {
			Written string `json:"written"`
			Source  string `json:"source"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&hits); err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if len(hits) == 0 || hits[0].Written != tt.written {
			t.Errorf("search %s = %+v, want first written %s", tt.q, hits, tt.written)
		}
	}
}

// TestFrequencyTopServesAGloss: every starter word carries the first gloss
// of its first sense, so a list can tell two words of one display form
// apart.
func TestFrequencyTopServesAGloss(t *testing.T) {
	lang.Register(lang.Ja{})
	ts, sqlDB := newServer(t)
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", displayJMdict)
	packID := importFreqPack(t, sqlDB, "toy-freq", "ja", "いぬ,,1\nする,,2\n")
	alice := registerUser(t, ts.URL, "alice", "")
	var got struct {
		Entries []struct {
			Written string `json:"written"`
			Gloss   string `json:"gloss"`
		} `json:"entries"`
	}
	decodeJSON(t, getTop(t, ts.URL, alice, packID, "?size=500"), &got)
	if len(got.Entries) != 2 || got.Entries[0].Gloss != "dog" || got.Entries[1].Gloss != "to do" {
		t.Errorf("entries = %+v, want glosses dog, to do", got.Entries)
	}
}
