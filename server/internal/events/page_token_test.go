package events

import (
	"encoding/base64"
	"errors"
	"net/url"
	"testing"
	"time"
)

// TestParsePageRequest: the paged form is chosen by limit or page; a
// continuation repeats neither since nor limit; limit is 1..MaxPageLimit.
func TestParsePageRequest(t *testing.T) {
	since := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		query string
		want  PageRequest
		err   error
	}{
		{query: "", want: PageRequest{}},
		{query: "since=2026-11-01T09:00:00Z&workspace=3", want: PageRequest{Since: since}},
		{query: "since=2026-11-01T10:00:00.700%2B01:00", want: PageRequest{Since: since}},
		{query: "limit=1", want: PageRequest{Paged: true, Limit: 1}},
		{query: "limit=2000&since=2026-11-01T09:00:00Z", want: PageRequest{Paged: true, Limit: 2000, Since: since}},
		{query: "page=e1.abc", want: PageRequest{Paged: true, Page: "e1.abc"}},
		{query: "page=e1.abc&workspace=4", want: PageRequest{Paged: true, Page: "e1.abc"}},
		{query: "since=yesterday", err: ErrSinceInvalid},
		{query: "limit=0", err: ErrPageInvalid},
		{query: "limit=2001", err: ErrPageInvalid},
		{query: "limit=ten", err: ErrPageInvalid},
		{query: "limit=", err: ErrPageInvalid},
		{query: "limit=5&limit=6", err: ErrPageInvalid},
		{query: "page=", err: ErrPageInvalid},
		{query: "page=e1.a&page=e1.b", err: ErrPageInvalid},
		{query: "page=e1.abc&since=2026-11-01T09:00:00Z", err: ErrPageInvalid},
		{query: "page=e1.abc&limit=5", err: ErrPageInvalid},
	} {
		q, err := url.ParseQuery(tc.query)
		if err != nil {
			t.Fatal(err)
		}
		got, err := ParsePageRequest(q)
		if tc.err != nil {
			if !errors.Is(err, tc.err) {
				t.Errorf("%q: err = %v, want %v", tc.query, err, tc.err)
			}
			continue
		}
		if err != nil {
			t.Errorf("%q: err = %v", tc.query, err)
			continue
		}
		if !got.Since.Equal(tc.want.Since) || got.Paged != tc.want.Paged || got.Limit != tc.want.Limit || got.Page != tc.want.Page {
			t.Errorf("%q = %+v, want %+v", tc.query, got, tc.want)
		}
	}
}

// TestPageTokenRoundTrip: a token decodes to what was encoded, for its
// own user only, and only the e1. prefix is accepted.
func TestPageTokenRoundTrip(t *testing.T) {
	tok := pageToken{User: 7, Workspace: 3, Since: "0001-01-01T00:00:00Z", Limit: 500,
		TS: "2026-11-01T09:00:00Z", ID: "01JC0000000000000000000000"}
	s := tok.encode()
	if s[:3] != "e1." {
		t.Fatalf("token %q lacks the e1. prefix", s)
	}
	got, err := decodePageToken(s, 7)
	if err != nil || got != tok {
		t.Fatalf("decode = %+v, %v; want %+v", got, err, tok)
	}
	if _, err := decodePageToken(s, 8); !errors.Is(err, ErrPageInvalid) {
		t.Errorf("another user's token: err = %v, want ErrPageInvalid", err)
	}
	raw := func(body string) string { return "e1." + base64.RawURLEncoding.EncodeToString([]byte(body)) }
	for name, bad := range map[string]string{
		"prefix":       "p2." + s[3:],
		"encoding":     "e1.***",
		"not json":     raw("nope"),
		"unknown key":  raw(`{"u":7,"w":0,"s":"0001-01-01T00:00:00Z","m":5,"t":"2026-11-01T09:00:00Z","i":"x","z":1}`),
		"trailing":     raw(`{"u":7,"w":0,"s":"0001-01-01T00:00:00Z","m":5,"t":"2026-11-01T09:00:00Z","i":"x"}{}`),
		"limit 0":      raw(`{"u":7,"w":0,"s":"0001-01-01T00:00:00Z","m":0,"t":"2026-11-01T09:00:00Z","i":"x"}`),
		"limit 2001":   raw(`{"u":7,"w":0,"s":"0001-01-01T00:00:00Z","m":2001,"t":"2026-11-01T09:00:00Z","i":"x"}`),
		"workspace -1": raw(`{"u":7,"w":-1,"s":"0001-01-01T00:00:00Z","m":5,"t":"2026-11-01T09:00:00Z","i":"x"}`),
		"since":        raw(`{"u":7,"w":0,"s":"yesterday","m":5,"t":"2026-11-01T09:00:00Z","i":"x"}`),
		"position ts":  raw(`{"u":7,"w":0,"s":"0001-01-01T00:00:00Z","m":5,"t":"2026-11-01T10:00:00+01:00","i":"x"}`),
		"position id":  raw(`{"u":7,"w":0,"s":"0001-01-01T00:00:00Z","m":5,"t":"2026-11-01T09:00:00Z","i":""}`),
	} {
		if _, err := decodePageToken(bad, 7); !errors.Is(err, ErrPageInvalid) {
			t.Errorf("%s: err = %v, want ErrPageInvalid", name, err)
		}
	}
}
