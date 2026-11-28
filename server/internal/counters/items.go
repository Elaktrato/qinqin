package counters

import (
	"regexp"
	"strconv"
	"strings"
)

// The drills of #179 (docs/contracts/counters/items.json).
const (
	MeasureWordsDrill = "measure-words"    // Chinese: a noun's measure word; item <entryId>
	CountersDrill     = "counters"         // Japanese: a noun's counter; item <entryId>
	ReadingsDrill     = "counter-readings" // Japanese: number + counter; item <counterId>:<number>
)

// What is the number 何 in a reading item.
const What = "nan"

var (
	entryItem   = regexp.MustCompile(`^[1-9][0-9]*$`)
	counterID   = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)
	numberToken = regexp.MustCompile(`^(?:[1-9][0-9]?|nan)$`)
)

// maxEntryID is the largest entry id a client can hold exactly (2^53 - 1).
const maxEntryID = 1<<53 - 1

// ParseEntryItem reads a noun drill's item: a positive entry id.
func ParseEntryItem(item string) (int64, bool) {
	if !entryItem.MatchString(item) {
		return 0, false
	}
	id, err := strconv.ParseInt(item, 10, 64)
	if err != nil || id > maxEntryID {
		return 0, false
	}
	return id, true
}

// ParseReadingItem reads a readings drill's item: <counterId>:<number>.
func ParseReadingItem(item string) (counter, number string, ok bool) {
	counter, number, found := strings.Cut(item, ":")
	if !found || len(counter) > 32 || !counterID.MatchString(counter) || !numberToken.MatchString(number) {
		return "", "", false
	}
	return counter, number, true
}

// ReadingItem is the item key of a counter and a number.
func ReadingItem(counter, number string) string { return counter + ":" + number }

// ValidItem reports whether item is an item of drill (one of the three).
func ValidItem(drill, item string) bool {
	switch drill {
	case MeasureWordsDrill, CountersDrill:
		_, ok := ParseEntryItem(item)
		return ok
	case ReadingsDrill:
		_, _, ok := ParseReadingItem(item)
		return ok
	}
	return false
}
