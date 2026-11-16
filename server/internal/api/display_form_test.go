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
