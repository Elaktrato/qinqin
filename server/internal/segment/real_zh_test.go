package segment_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/levels"
	"qinqin/internal/lookup"
	"qinqin/internal/pack"
	"qinqin/internal/realdict"
)

// zhRealWords lists every window prefix of texts, for realdict.
func zhRealWords(texts []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, t := range texts {
		r := []rune(t)
		for i := range r {
			for j := i + 1; j <= len(r) && j-i <= lookup.MaxWindowRunes; j++ {
				if s := string(r[i:j]); !seen[s] {
					seen[s] = true
					out = append(out, s)
				}
			}
		}
	}
	return out
}

// #349 on the shipped CC-CEDICT with the shipped HSK word list: the issue's
// sentences (greedy read 那 nā, 着 zhāo, 得 dé, 打 dá, 这不｜是, 一个,
// 中国人, 明天见, 有时｜间, 得很, 在教｜室) and ordinary ones, with the
// match's reading; function words marked *.
func TestRealChineseSentences(t *testing.T) {
	cases := []struct{ text, want string }{
		{"那是我的书。", "那(nà)｜是(shì)｜我(wǒ)｜的(de)*｜书(shū)"},
		{"他看着我。", "他(tā)｜看(kàn)｜着(zhe)*｜我(wǒ)"},
		{"他学得很好。", "他(tā)｜学(xué)｜得(de)*｜很(hěn)｜好(hǎo)"},
		{"他打我。", "他(tā)｜打(dǎ)｜我(wǒ)"},
		{"我打电话。", "我(wǒ)｜打电话(dǎ diàn huà)"},
		{"我有时间。", "我(wǒ)｜有(yǒu)｜时间(shí jiān)"},
		{"我在教室。", "我(wǒ)｜在(zài)｜教室(jiào shì)"},
		{"这不是我的。", "这(zhè)｜不(bù)｜是(shì)｜我(wǒ)｜的(de)*"},
		{"我有一个朋友。", "我(wǒ)｜有(yǒu)｜一(yī)｜个(gè)｜朋友(péng you)"},
		{"他是中国人。", "他(tā)｜是(shì)｜中国(zhōng guó)｜人(rén)"},
		{"明天见！", "明天(míng tiān)｜见(jiàn)"},
		{"你好吗？", "你好(nǐ hǎo)｜吗(ma)*"},
		{"我们走吧。", "我们(wǒ men)｜走(zǒu)｜吧(ba)*"},
		{"他来了。", "他(tā)｜来(lái)｜了(le)*"},
		{"她说她不想去。", "她(tā)｜说(shuō)｜她(tā)｜不(bù)｜想(xiǎng)｜去(qù)"},
		{"你会说汉语吗？", "你(nǐ)｜会(huì)｜说(shuō)｜汉语(hàn yǔ)｜吗(ma)*"},
		{"今天天气很好。", "今天(jīn tiān)｜天气(tiān qì)｜很(hěn)｜好(hǎo)"},
		{"我想去中国学习。", "我(wǒ)｜想(xiǎng)｜去(qù)｜中国(zhōng guó)｜学习(xué xí)"},
		{"这本书多少钱？", "这(zhè)｜本(běn)｜书(shū)｜多少(duō shǎo)｜钱(qián)"},
		{"我的家在北京。", "我(wǒ)｜的(de)*｜家(jiā)｜在(zài)｜北京(běi jīng)"},
		{"你叫什么名字？", "你(nǐ)｜叫(jiào)｜什么(shén me)｜名字(míng zi)"},
		{"老师在教室里。", "老师(lǎo shī)｜在(zài)｜教室(jiào shì)｜里(lǐ)"},
		{"我觉得这个很好吃。", "我(wǒ)｜觉得(jué de)｜这个(zhè ge)｜很(hěn)｜好吃(hǎo chī)"},
		{"他还没来。", "他(tā)｜还(hái)｜没(méi)｜来(lái)"},
		{"我都知道了。", "我(wǒ)｜都(dōu)｜知道(zhī dào)｜了(le)*"},
		{"他坐在地上。", "他(tā)｜坐(zuò)｜在(zài)｜地上(dì shang)"},
	}
	var texts []string
	for _, c := range cases {
		texts = append(texts, c.text)
	}
	sqlDB := dbtest.Open(t)
	realdict.Import(t, sqlDB, "zh", zhRealWords(texts)...)
	p, err := pack.LoadPack(filepath.Join("..", "..", "..", "plugins", "data", "hsk-words"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := levels.Import(context.Background(), sqlDB, p); err != nil {
		t.Fatal(err)
	}
	svc := service(sqlDB)
	svc.WithReadings = true
	for _, c := range cases {
		ms, err := svc.Segment(context.Background(), "zh", c.text)
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for _, m := range ms {
			s := m.Surface
			if m.Reading != nil {
				s += "(" + m.Reading.Value + ")"
			}
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
