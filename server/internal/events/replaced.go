package events

import (
	"encoding/json"
	"math"
	"time"
)

// Review is a stored event as the replaced-review rule reads it
// (docs/contracts/events/review-replace.json, #131).
type Review struct {
	ID          string
	WorkspaceID int64
	TS          string
	Type        string
	Payload     json.RawMessage
}

// reviewPayload holds the members the rule reads; Grade stays a number
// so 3.0 is grade 3 like on every client (review-parse.json).
type reviewPayload struct {
	CardID   any `json:"cardId"`
	Grade    any `json:"grade"`
	Replaces any `json:"replaces"`
}

// parsed returns the review's card and its replaces reference ("" when
// absent or not a non-empty string), and whether it is a valid review.
func (r Review) parsed() (card, replaces string, ok bool) {
	if r.Type != "review" {
		return "", "", false
	}
	var p reviewPayload
	if json.Unmarshal(r.Payload, &p) != nil {
		return "", "", false
	}
	card, isString := p.CardID.(string)
	if !isString || card == "" {
		return "", "", false
	}
	grade, isNumber := p.Grade.(float64)
	if !isNumber || grade != math.Trunc(grade) || grade < 1 || grade > 4 {
		return "", "", false
	}
	replaces, _ = p.Replaces.(string)
	return card, replaces, true
}

// valid reports whether r counts as a review (parses, and its ts is an
// instant) and returns the instant.
func (r Review) valid() (time.Time, bool) {
	if _, _, ok := r.parsed(); !ok {
		return time.Time{}, false
	}
	at, err := time.Parse(time.RFC3339, r.TS)
	if err != nil {
		return time.Time{}, false
	}
	return at, true
}

// Replaced returns the ids of the reviews that a changed grade replaced:
// a valid review links to the review its "replaces" names when both are
// valid reviews of one workspace and card in the same whole second;
// links join reviews into families, and only the greatest id of each
// family counts. Other references are ignored. The order of reviews does
// not matter. Callers pass one user's events only.
func Replaced(reviews []Review) map[string]bool {
	type node struct {
		ws       int64
		card     string
		replaces string
		second   int64
	}
	nodes := map[string]node{}
	linking := false
	for _, r := range reviews {
		at, ok := r.valid()
		if !ok {
			continue
		}
		card, replaces, _ := r.parsed()
		nodes[r.ID] = node{r.WorkspaceID, card, replaces, at.Unix()}
		if replaces != "" {
			linking = true
		}
	}
	out := map[string]bool{}
	if !linking {
		return out
	}
	parent := map[string]string{}
	var find func(string) string
	find = func(id string) string {
		p, ok := parent[id]
		if !ok || p == id {
			return id
		}
		root := find(p)
		parent[id] = root
		return root
	}
	for id, n := range nodes {
		if n.replaces == "" || n.replaces == id {
			continue
		}
		t, ok := nodes[n.replaces]
		if !ok || t.ws != n.ws || t.card != n.card || t.second != n.second {
			continue
		}
		a, b := find(id), find(n.replaces)
		if a == b {
			continue
		}
		// The root of a family is its greatest id.
		if a > b {
			parent[b] = a
		} else {
			parent[a] = b
		}
	}
	for id := range nodes {
		if find(id) != id {
			out[id] = true
		}
	}
	return out
}
