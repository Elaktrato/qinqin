package lang

import (
	"strings"

	"qinqin/internal/model"
	"qinqin/internal/pinyin"
)

// Zh is the Mandarin Chinese language pack: pinyin readings normalize to
// a toneless plain form via pinyin.Plain, search queries normalize the
// same way, and a bopomofo reading derives from the pinyin one via
// pinyin.ToBopomofo.
type Zh struct{}

// Code is "zh".
func (Zh) Code() string { return "zh" }

// NormalizeReading returns the plain search form of one reading: pinyin
// readings go through pinyin.Plain (tones, tone digits, and spaces
// stripped), other readings are lowercased — bopomofo has no case, so its
// plain form is the reading itself.
func (Zh) NormalizeReading(readType, value string) string {
	if readType == "pinyin" {
		return pinyin.Plain(value)
	}
	return strings.ToLower(value)
}

// SearchPlain returns the toneless plain form of a pinyin query.
func (Zh) SearchPlain(query string) string {
	return pinyin.Plain(query)
}

// DeriveReadings appends a bopomofo reading converted from the entry's
// pinyin reading. Nothing derives when there is no pinyin reading, when a
// bopomofo reading is already present, or when the pinyin cannot be
// converted — derivation never fails and never mutates its input.
func (z Zh) DeriveReadings(readings []model.Reading) []model.Reading {
	py := ""
	hasBopomofo := false
	for _, r := range readings {
		switch r.Type {
		case "pinyin":
			if py == "" {
				py = r.Value
			}
		case "bopomofo":
			hasBopomofo = true
		}
	}
	if py == "" || hasBopomofo {
		return readings
	}
	bopomofo, err := pinyin.ToBopomofo(py)
	if err != nil {
		return readings
	}
	out := make([]model.Reading, len(readings), len(readings)+1)
	copy(out, readings)
	return append(out, model.Reading{
		Type:  "bopomofo",
		Value: bopomofo,
		Plain: z.NormalizeReading("bopomofo", bopomofo),
	})
}
