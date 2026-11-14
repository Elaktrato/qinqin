package lang_test

import (
	"testing"

	"qinqin/internal/lang"
)

func TestPhoneticKey(t *testing.T) {
	for in, want := range map[string]string{
		// every spelling of Tōkyō reaches one key
		"tokyo":   "tokyo",
		"toukyou": "tokyo",
		"Tōkyō":   "tokyo",
		"TÔKYÔ":   "tokyo",
		"ＴＯＫＹＯ":   "tokyo",
		"ToKyO":   "tokyo",
		"to-kyo":  "tokyo",
		"to kyo":  "tokyo",
		"とうきょう":   "tokyo",
		"トウキョウ":   "tokyo",
		"ﾄｳｷｮｳ":   "tokyo",
		// readings as the Aozora catalog writes them
		"とうきょうはっけい":    "tokyohakkei",
		"なつめそうせき":      "natsumesoseki",
		"コーヒー":         "kohi",
		"ウェストミンスターじいん": "uesutominsutajin",
		// kunrei-shiki / Nihon-shiki spellings meet Hepburn
		"sinkansen": "shinkansen", "tikatetu": "chikatetsu", "huzisan": "fujisan",
		"zisin": "jishin", "sya": "sha", "syu": "shu", "syo": "sho",
		"tya": "cha", "tyu": "chu", "tyo": "cho", "zya": "ja", "zyu": "ju",
		"zyo": "jo", "kodi": "koji", "kadu": "kazu", "natume": "natsume",
		"tuki": "tsuki", "si": "shi", "hunsui": "funsui",
		"しんかんせん": "shinkansen", "shinkansen": "shinkansen",
		// を reads o, wo folds to it
		"wo": "o", "を": "o", "hon wo yomu": "honoyomu", "ほんをよむ": "honoyomu",
		// the particles は/へ are ha/he in readings; a lone query token folds to them
		"わがはいはねこである":             "wagahaihanekodearu",
		"wagahai wa neko de aru": "wagahaihanekodearu",
		"watashi wa":             "watashiha",
		"neko e iku":             "nekoheiku", "ねこへいく": "nekoheiku",
		"wasabi": "wasabi", "wa": "ha", "e": "he", "kawa": "kawa", "sore wa": "soreha",
		"わ": "wa", "え": "e", "wagahaiwa": "wagahaiwa", "kae": "kae",
		// only whitespace separates a particle: hyphen pieces stay words
		"e-hon": "ehon", "えほん": "ehon", "wa-fuu": "wafu", "わふう": "wafu",
		"watashi-wa": "watashiwa", "e no michi": "henomichi",
		// fixed expressions
		"konnichiwa": "konnichiha", "konnichi wa": "konnichiha", "こんにちは": "konnichiha",
		"Konbanwa": "konbanha", "こんばんは": "konbanha", "konbanha": "konbanha",
		// nothing phonetic: kanji only
		"東京": "",
		"":   "",
	} {
		if got := lang.PhoneticKey(in); got != want {
			t.Errorf("PhoneticKey(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestPhoneticKeySameWord keys one word through every route — kana from a
// catalog reading, a kunrei/Nihon-shiki query, a Hepburn query — and
// requires one key, so the Hepburn fold never corrupts kana-derived
// romaji (しゅ is shu, not sfu).
func TestPhoneticKeySameWord(t *testing.T) {
	for _, tc := range []struct {
		want      string
		spellings []string
	}{
		{"shujin", []string{"しゅじん", "シュジン", "syujin", "shujin"}},
		{"chugoku", []string{"ちゅうごく", "チュウゴク", "tyuugoku", "chuugoku", "chūgoku"}},
		{"shuppatsu", []string{"しゅっぱつ", "syuppatu", "shuppatsu"}},
		{"fuji", []string{"ふじ", "huzi", "fuji"}},
		{"shukudai", []string{"しゅくだい", "syukudai", "shukudai"}},
		{"benkyochu", []string{"べんきょうちゅう", "benkyoutyuu", "benkyouchuu"}},
		{"shinshutsu", []string{"しんしゅつ", "sinsyutu", "shinshutsu"}},
		{"tokushu", []string{"とくしゅう", "tokusyuu", "tokushuu"}},
		{"mitchu", []string{"みっちゅう", "mittyuu", "mitchuu"}},
		{"jushin", []string{"じゅしん", "zyusin", "jushin"}},
		{"hyuga", []string{"ひゅうが", "hyuuga", "hyūga"}},
		{"tsutsumi", []string{"つつみ", "tutumi", "tsutsumi"}},
		{"matsu", []string{"まつ", "matu", "matsu"}},
		{"chikatetsu", []string{"ちかてつ", "tikatetu", "chikatetsu"}},
		{"shinkansen", []string{"しんかんせん", "sinkansen", "shinkansen"}},
		{"funsui", []string{"ふんすい", "hunsui", "funsui"}},
		{"natsumesoseki", []string{"なつめそうせき", "natume souseki", "natsume soseki"}},
		{"chashitsu", []string{"ちゃしつ", "tyasitu", "chashitsu"}},
		{"shokuji", []string{"しょくじ", "syokuzi", "shokuji"}},
	} {
		for _, s := range tc.spellings {
			if got := lang.PhoneticKey(s); got != tc.want {
				t.Errorf("PhoneticKey(%q) = %q, want %q", s, got, tc.want)
			}
		}
	}
}
