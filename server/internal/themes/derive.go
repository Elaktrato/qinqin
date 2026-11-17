package themes

import "fmt"

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
	HighlightWash   string            `json:"highlightWash"`
	WordMarks       map[string]Mark   `json:"wordMarks"`       // new, learning (known: none)
	CorrectionMarks map[string]Mark   `json:"correctionMarks"` // mistake, suggestion
	AccentChoices   []string          `json:"accentChoices"`
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
	return Derived{
		AccentKey: key, Accent: acc, OnAccent: on, Hair: hair, AccentTints: tints,
		PrimaryWash: tints["14"], SelectedWash: tints["14"],
		Mastery:       []string{hair, tints["14"], tints["32"], tints["58"], tints["100"]},
		ReadingAccent: reading,
		HighlightWash: WithAlpha(c.Warn, 24),
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
