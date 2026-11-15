package journal

import "testing"

func TestJoinCJKSpaces(t *testing.T) {
	cases := map[string]string{
		"我 今 天 去 学 校 了 。\n我 喜 欢 学 习 汉 语 。": "我今天去学校了。\n我喜欢学习汉语。",
		"私 は 今日 学校 に 行 き ま し た 。":          "私は今日学校に行きました。",
		"I like 学 习 and tea":               "I like 学习 and tea",
		"hello  world":                     "hello  world",
		"":                                 "",
	}
	for in, want := range cases {
		if got := joinCJKSpaces(in); got != want {
			t.Errorf("joinCJKSpaces(%q) = %q, want %q", in, got, want)
		}
	}
}
