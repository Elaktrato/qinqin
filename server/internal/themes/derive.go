package themes

import (
	"fmt"
	"math"
	"strconv"
)

// Mark is a line drawn under text: its colour and style (solid, dotted, wavy).
type Mark struct {
	Color string `json:"color"`
	Style string `json:"style"`
}

// Derived are the tokens computed from a theme and the person's accent
// (docs/contracts/themes/README.md, "Derived tokens"). They are never
// stored in a theme file.
type Derived struct {
	AccentKey       string            `json:"accentKey"`
	Accent          string            `json:"accent"`
	OnAccent        string            `json:"onAccent"`
	Hair            string            `json:"hair"`
	AccentTints     map[string]string `json:"accentTints"` // "14", "32", "58", "100"
	PrimaryWash     string            `json:"primaryWash"`
	SelectedWash    string            `json:"selectedWash"`
	Mastery         []string          `json:"mastery"` // stage 0 (an outline in hair) .. 4
	ReadingAccent   string            `json:"readingAccent"`
	ReadableBad     string            `json:"readableBad"`   // error text: bad when it reads on panel, else text
	ReadableMuted   string            `json:"readableMuted"` // secondary text: muted when it reads on panel, else text
	FocusRing       string            `json:"focusRing"`     // accent when 3:1 on panel, raised and chrome, else text
	HighlightWash   string            `json:"highlightWash"`
	Highlights      Highlights        `json:"highlights"`
	WordMarks       map[string]Mark   `json:"wordMarks"`       // new, learning (known: none)
	CorrectionMarks map[string]Mark   `json:"correctionMarks"` // mistake, suggestion
	AccentChoices   []string          `json:"accentChoices"`
}

// Highlights are the reader's highlight colours, named by their hue.
type Highlights struct {
	Yellow string `json:"yellow"`
	Green  string `json:"green"`
	Blue   string `json:"blue"`
	Pink   string `json:"pink"`
}

// Hue is color with its largest and smallest channel kept (HSL saturation
// and lightness stay) and its spread put on hue deg; channels round half up.
func Hue(color string, deg float64) string {
	var ch [3]int
	for i := range ch {
		v, _ := strconv.ParseUint(color[1+2*i:3+2*i], 16, 8)
		ch[i] = int(v)
	}
	hi := max(ch[0], ch[1], ch[2])
	lo := min(ch[0], ch[1], ch[2])
	h := deg / 60
	x := lo + int(math.Floor(float64(hi-lo)*(1-math.Abs(math.Mod(h, 2)-1))+0.5))
	rgb := [6][3]int{
		{hi, x, lo}, {x, hi, lo}, {lo, hi, x}, {lo, x, hi}, {x, lo, hi}, {hi, lo, x},
	}[int(math.Floor(h))%6]
	return fmt.Sprintf("#%02x%02x%02x", rgb[0], rgb[1], rgb[2])
}

// WithAlpha appends the alpha of percent p to "#rrggbb":
// floor((p*255 + 50) / 100) as two lower-case hex digits.
func WithAlpha(color string, p int) string {
	return color + fmt.Sprintf("%02x", (p*255+50)/100)
}

// onAccent is the text colour on a filled accent: chrome when it contrasts
// at least as much as white, else white.
func onAccent(chrome, accent string) string {
	if Ratio(chrome, accent) >= Ratio("#ffffff", accent) {
		return chrome
	}
	return "#ffffff"
}

// AccentChoices are the accents offered in the picker: those at least 3:1
// on panel, in file order; never empty (the default accent alone).
func AccentChoices(t Theme) []string {
	var out []string
	for _, a := range t.Accents {
		if Ratio(a.Color, t.Colors.Panel) >= MinGraph {
			out = append(out, a.Key)
		}
	}
	if len(out) == 0 {
		out = []string{t.DefaultAccent}
	}
	return out
}

// Derive computes the derived tokens of t with the requested accent key
// ("" or a key not offered = the theme's default accent).
func Derive(t Theme, accent string) Derived {
	choices := AccentChoices(t)
	key := t.DefaultAccent
	for _, k := range choices {
		if k == accent {
			key = accent
		}
	}
	acc, _ := t.Accent(key)
	c := t.Colors
	on := onAccent(c.Chrome, acc)
	tints := map[string]string{}
	for _, p := range []int{14, 32, 58, 100} {
		tints[fmt.Sprint(p)] = WithAlpha(acc, p)
	}
	hair := WithAlpha(c.Line, 55)
	reading := c.Text
	if Ratio(acc, c.Panel) >= MinText {
		reading = acc
	}
	readableBad := c.Text
	if Ratio(c.Bad, c.Panel) >= MinText {
		readableBad = c.Bad
	}
	readableMuted := c.Text
	if Ratio(c.Muted, c.Panel) >= MinText {
		readableMuted = c.Muted
	}
	focusRing := acc
	for _, s := range []string{c.Panel, c.Raised, c.Chrome} {
		if Ratio(acc, s) < MinGraph {
			focusRing = c.Text
		}
	}
	return Derived{
		AccentKey: key, Accent: acc, OnAccent: on, Hair: hair, AccentTints: tints,
		PrimaryWash: tints["14"], SelectedWash: tints["14"],
		Mastery:       []string{hair, tints["14"], tints["32"], tints["58"], tints["100"]},
		ReadingAccent: reading,
		ReadableBad:   readableBad,
		ReadableMuted: readableMuted,
		FocusRing:     focusRing,
		HighlightWash: WithAlpha(c.Warn, 24),
		Highlights: Highlights{
			Yellow: c.Warn, Green: Hue(c.Warn, 135), Blue: Hue(c.Warn, 225), Pink: Hue(c.Warn, 330),
		},
		WordMarks: map[string]Mark{
			"new":      {Color: acc, Style: "solid"},
			"learning": {Color: c.Warn, Style: "dotted"},
		},
		CorrectionMarks: map[string]Mark{
			"mistake":    {Color: c.GradeAgain, Style: "wavy"},
			"suggestion": {Color: c.GradeEasy, Style: "dotted"},
		},
		AccentChoices: choices,
	}
}
