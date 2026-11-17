package themes

import (
	"math"
	"strconv"
)

// Contrast minimums of the review (design §7).
const (
	MinText  = 4.5 // text and muted on panel and chrome; accent text that is small
	MinGraph = 3.0 // accents and grades on panel
)

// channel is one sRGB channel (0..255) in linear light (WCAG 2.2).
func channel(v int64) float64 {
	c := float64(v) / 255
	if c <= 0.04045 {
		return c / 12.92
	}
	return math.Pow((c+0.055)/1.055, 2.4)
}

// Luminance is the WCAG relative luminance of "#rrggbb".
func Luminance(hex string) float64 {
	n, err := strconv.ParseUint(hex[1:], 16, 32)
	if len(hex) != 7 || err != nil {
		return 0
	}
	r, g, b := int64(n>>16&0xff), int64(n>>8&0xff), int64(n&0xff)
	return 0.2126*channel(r) + 0.7152*channel(g) + 0.0722*channel(b)
}

// Ratio is the contrast ratio of two colours, rounded to two decimals
// half up (the value every check compares).
func Ratio(a, b string) float64 {
	la, lb := Luminance(a), Luminance(b)
	if la < lb {
		la, lb = lb, la
	}
	r := (la + 0.05) / (lb + 0.05)
	return math.Floor(r*100+0.5) / 100
}

// Check is one measured pair of the review.
type Check struct {
	FG    string  `json:"fg"` // a colour key, or "accent:<key>"
	BG    string  `json:"bg"`
	Min   float64 `json:"min"`
	Ratio float64 `json:"ratio"`
	Pass  bool    `json:"pass"`
}

// reviewPairs are the fixed checks, in order; on-accent on the default
// accent and the accents follow.
var reviewPairs = []struct {
	fg, bg string
	min    float64
}{
	{"text", "panel", MinText}, {"text", "chrome", MinText}, {"muted", "panel", MinText}, {"muted", "chrome", MinText},
	{"muted", "raised", MinText}, {"bad", "panel", MinText},
	{"gradeAgain", "panel", MinGraph}, {"gradeHard", "panel", MinGraph}, {"gradeGood", "panel", MinGraph}, {"gradeEasy", "panel", MinGraph},
}

// Review measures a theme the way the staged-upload review reports it.
func Review(t Theme) []Check {
	out := make([]Check, 0, len(reviewPairs)+1+len(t.Accents))
	for _, p := range reviewPairs {
		r := Ratio(t.Colors.Get(p.fg), t.Colors.Get(p.bg))
		out = append(out, Check{FG: p.fg, BG: p.bg, Min: p.min, Ratio: r, Pass: r >= p.min})
	}
	// Button text on a filled accent: the derived on-accent colour on the
	// default accent (the one painted when the person chose none).
	acc, _ := t.Accent(t.DefaultAccent)
	r := Ratio(onAccent(t.Colors.Chrome, acc), acc)
	out = append(out, Check{FG: "onAccent", BG: "accent:" + t.DefaultAccent, Min: MinText, Ratio: r, Pass: r >= MinText})
	for _, a := range t.Accents {
		r := Ratio(a.Color, t.Colors.Panel)
		out = append(out, Check{FG: "accent:" + a.Key, BG: "panel", Min: MinGraph, Ratio: r, Pass: r >= MinGraph})
	}
	return out
}

// Failing counts the checks that do not pass.
func Failing(checks []Check) int {
	n := 0
	for _, c := range checks {
		if !c.Pass {
			n++
		}
	}
	return n
}
