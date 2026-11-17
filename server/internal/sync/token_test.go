package sync

import (
	"encoding/base64"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestPageTokenRoundTrip(t *testing.T) {
	tok := pageToken{User: 3, Since: "2026-11-12T09:00:00Z", Until: "2026-11-12T10:00:00Z",
		Pos:     position{Seg: 1, Stamp: "2026-11-12T09:10:00Z", RowID: 42},
		Filters: filters{Collections: []string{"alpha", "beta"}, Workspace: 7}, Limit: 500,
		Languages: []string{"ja", "zh"}, Restarted: true}
	s := tok.encode()
	if !strings.HasPrefix(s, "p2.") {
		t.Fatalf("token %q lacks the p2. prefix", s)
	}
	got, err := decodePage(s, 3, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, tok) {
		t.Errorf("round trip = %+v, want %+v", got, tok)
	}
}

func TestCursorTokenRoundTrip(t *testing.T) {
	f := filters{Collections: []string{"alpha"}, Workspace: 0}
	tok := cursorToken{User: 3, Time: "2026-11-12T09:59:30Z", Filters: f, Languages: []string{"zh"}}
	s := tok.encode()
	if !strings.HasPrefix(s, "c2.") {
		t.Fatalf("cursor %q lacks the c2. prefix", s)
	}
	got, err := decodeCursor(s, 3, f)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, tok) {
		t.Errorf("round trip = %+v, want %+v", got, tok)
	}
}

func TestTokensRefused(t *testing.T) {
	good := pageToken{User: 3, Until: "2026-11-12T10:00:00Z", Filters: filters{Collections: []string{"alpha"}}, Limit: 10, Languages: []string{}}
	f := filters{Collections: []string{"alpha"}}
	cur := cursorToken{User: 3, Time: "2026-11-12T09:59:30Z", Filters: f, Languages: []string{}}
	raw := func(prefix, body string) string { return prefix + base64.RawURLEncoding.EncodeToString([]byte(body)) }
	mod := func(fn func(*pageToken)) string { t := good; fn(&t); return t.encode() }
	pages := map[string]string{
		"another user":       mod(func(t *pageToken) { t.User = 4 }),
		"garbled base64":     "p2.not-base64!",
		"no prefix":          strings.TrimPrefix(good.encode(), "p2."),
		"a cursor as a page": cur.encode(),
		"unknown member":     raw("p2.", `{"u":3,"n":"2026-11-12T10:00:00Z","k":{"i":0,"t":"","r":0},"f":{"c":["alpha"],"w":0},"m":10,"l":[],"x":false,"zz":1}`),
		"trailing data":      good.encode() + base64.RawURLEncoding.EncodeToString([]byte(" {}")),
		"not JSON":           raw("p2.", `hello`),
		"segment past end":   mod(func(t *pageToken) { t.Pos.Seg = 2 }),
		"negative segment":   mod(func(t *pageToken) { t.Pos.Seg = -1 }),
		"limit 0":            mod(func(t *pageToken) { t.Limit = 0 }),
		"limit 2001":         mod(func(t *pageToken) { t.Limit = 2001 }),
		"bad until":          mod(func(t *pageToken) { t.Until = "yesterday" }),
		"bad since":          mod(func(t *pageToken) { t.Since = "2026-11-12" }),
		"bad key stamp":      mod(func(t *pageToken) { t.Pos.Stamp = "2026-11-12 10:00" }),
		"no collections":     mod(func(t *pageToken) { t.Filters.Collections = nil }),
		"unsorted languages": mod(func(t *pageToken) { t.Languages = []string{"zh", "ja"} }),
	}
	for name, s := range pages {
		if _, err := decodePage(s, 3, 2); !errors.Is(err, ErrPageInvalid) {
			t.Errorf("page %s: err = %v, want ErrPageInvalid", name, err)
		}
	}
	modc := func(fn func(*cursorToken)) string { t := cur; fn(&t); return t.encode() }
	cursors := map[string]string{
		"another user":       modc(func(t *cursorToken) { t.User = 4 }),
		"other collections":  modc(func(t *cursorToken) { t.Filters.Collections = []string{"alpha", "beta"} }),
		"other workspace":    modc(func(t *cursorToken) { t.Filters.Workspace = 7 }),
		"a page as a cursor": good.encode(),
		"an RFC 3339 time":   "2026-11-12T09:00:00Z",
		"garbled":            "c2.%%%",
		"bad time":           modc(func(t *cursorToken) { t.Time = "" }),
	}
	for name, s := range cursors {
		if _, err := decodeCursor(s, 3, f); !errors.Is(err, ErrPageInvalid) {
			t.Errorf("cursor %s: err = %v, want ErrPageInvalid", name, err)
		}
	}
}
