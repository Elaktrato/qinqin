// Package radicals owns the table of the 214 Kangxi radicals: each
// number's unified character, its classical stroke count and the
// alternative shapes (positional, simplified and Japanese forms) a learner
// sees. The data is the contract fixture docs/contracts/radicals/kangxi.json,
// embedded from a byte-identical copy (a test keeps the two equal), so
// the Go server and the web client read one table.
package radicals

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed kangxi.json
var kangxiJSON []byte

// Row is one radical of the table. C is the unified (everyday) character
// a dictionary uses, such as 水 for 85 — not the Kangxi Radicals block
// look-alike. S is the classical Kangxi stroke count of the radical.
// Forms holds the display aliases by "all", "zh" and "ja".
type Row struct {
	N     int                 `json:"n"`
	C     string              `json:"c"`
	S     int                 `json:"s"`
	Forms map[string][]string `json:"forms"`
}

var (
	rows   []Row
	byN    = map[int]*Row{}
	number = map[string]int{}
)

func init() {
	var doc struct {
		Rows []Row `json:"rows"`
	}
	if err := json.Unmarshal(kangxiJSON, &doc); err != nil {
		panic(fmt.Sprintf("radicals: decode kangxi.json: %v", err))
	}
	rows = doc.Rows
	for i := range rows {
		r := &rows[i]
		byN[r.N] = r
		number[r.C] = r.N
	}
	// A form maps to the lowest number listing it, unless it is itself a
	// radical's own character (月 is 74, though 130 lists it as a form).
	for _, r := range rows {
		for _, k := range []string{"all", "zh", "ja"} {
			for _, f := range r.Forms[k] {
				if _, ok := number[f]; !ok {
					number[f] = r.N
				}
			}
		}
	}
}

// Rows returns the table in number order. Callers must not modify it.
func Rows() []Row { return rows }

// Valid reports whether n is a Kangxi radical number, 1–214.
func Valid(n int) bool { return byN[n] != nil }

// Char returns the unified character of radical n.
func Char(n int) (string, bool) {
	if r := byN[n]; r != nil {
		return r.C, true
	}
	return "", false
}

// Strokes returns the classical stroke count of radical n, 0 when n is
// not a radical number.
func Strokes(n int) int {
	if r := byN[n]; r != nil {
		return r.S
	}
	return 0
}

// Number returns the radical number of char: the radical whose character
// it is, otherwise the lowest radical listing it among its forms; 0 when
// none.
func Number(char string) int { return number[char] }
