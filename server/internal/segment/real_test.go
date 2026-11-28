package segment_test

import (
	"context"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lang"
	"qinqin/internal/lookup"
	"qinqin/internal/realdict"
)

// realWords lists every text a lookup of texts can probe — each window
// prefix, its deinflections and their compound stems — for realdict.
func realWords(texts []string) []string {
	rules := lang.For("ja").(lang.Deinflector).Rules()
	seen := map[string]bool{}
	var out []string
	add := func(s string) {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	for _, t := range texts {
		r := []rune(t)
		for i := range r {
			for j := i + 1; j <= len(r) && j-i <= lookup.MaxWindowRunes; j++ {
				add(string(r[i:j]))
				for _, c := range rules.Deinflect(string(r[i:j])) {
					add(c.Form)
					for _, cp := range rules.Compounds {
						if st, ok := strings.CutSuffix(c.Form, cp.Suffix); ok && st != "" {
							add(st)
						}
					}
				}
			}
		}
	}
	return out
}

// #348 on the shipped JMdict: ordinary sentences read as whole sentences
// (the issue's four among them; greedy read 仕事｜はち｜と, 妹｜がい｜ます,
// 花｜がき｜れい and 名前｜はア; 今日は was the greeting), particles marked (*)
// as function words.
func TestRealJapaneseSentences(t *testing.T) {
	cases := []struct{ text, want string }{
		{"私の名前はアンナです。", "私｜の*｜名前｜は*｜ン｜です*"},
		{"仕事はちょっと忙しいです。", "仕事｜は*｜ちょっと｜忙しい｜です*"},
		{"父と母と妹がいます。", "父｜と*｜母｜と*｜妹｜が*｜います"},
		{"春は暖かくて、花がきれいです。", "春｜は*｜暖かくて｜花｜が*｜きれい｜です*"},
		{"毎朝コーヒーを飲みます。", "毎朝｜コーヒー｜を*｜飲みます"},
		{"昨日、友達と映画を見ました。", "昨日｜友達｜と*｜映画｜を*｜見ました"},
		{"この部屋は静かで広い。", "この｜部屋｜は*｜静か｜で*｜広い"},
		{"りんごを三つ買いました。", "りんご｜を*｜三つ｜買いました"},
		{"駅まで歩いて十分かかります。", "駅｜まで*｜歩いて｜十分｜かかります"},
		{"日本語の本を読んでいます。", "日本語｜の*｜本｜を*｜読んでいます"},
		{"今日はとても寒くないですね。", "今日｜は*｜とても｜寒くない｜です*｜ね*"},
		{"彼女はテレビを見ながらご飯を食べた。", "彼女｜は*｜テレビ｜を*｜見ながら｜ご飯｜を*｜食べた"},
	}
	var texts []string
	for _, c := range cases {
		texts = append(texts, c.text)
	}
	sqlDB := dbtest.Open(t)
	realdict.Import(t, sqlDB, "ja", realWords(texts)...)
	svc := service(sqlDB)
	for _, c := range cases {
		ms, err := svc.Segment(context.Background(), "ja", c.text)
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for _, m := range ms {
			s := m.Surface
			if m.Function {
				s += "*"
			}
			got = append(got, s)
		}
		if g := strings.Join(got, "｜"); g != c.want {
			t.Errorf("Segment(%q) = %s, want %s", c.text, g, c.want)
		}
	}
}
