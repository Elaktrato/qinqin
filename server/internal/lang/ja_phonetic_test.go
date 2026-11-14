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
		"watashi wa":             "watashiha", "watashi-wa": "watashiha",
		"neko e iku": "nekoheiku", "ねこへいく": "nekoheiku",
		"wasabi": "wasabi", "wa": "ha", "e": "he", "kawa": "kawa", "sore wa": "soreha",
		"わ": "wa", "え": "e", "wagahaiwa": "wagahaiwa", "kae": "kae",
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
