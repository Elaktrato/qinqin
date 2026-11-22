package api_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"qinqin/internal/events"
)

// docs/contracts/events/page.json: the page shape of the paged
// GET /api/events and what each request answers.

type eventsPageFixture struct {
	Version int    `json:"version"`
	Rule    string `json:"rule"`
	Doc     string `json:"_doc"`
	Budget  struct {
		MaxLimit     int      `json:"maxLimit"`
		MaxPageBytes int      `json:"maxPageBytes"`
		TokenPrefix  string   `json:"tokenPrefix"`
		ItemKeys     []string `json:"itemKeys"`
	} `json:"budget"`
	Valid []struct {
		Name string          `json:"name"`
		Page json.RawMessage `json:"page"`
	} `json:"valid"`
	Invalid []struct {
		Name   string          `json:"name"`
		Page   json.RawMessage `json:"page"`
		Reason string          `json:"reason"`
	} `json:"invalid"`
	Requests []struct {
		Name   string `json:"name"`
		Query  string `json:"query"`
		Status int    `json:"status"`
		Form   string `json:"form"`
		Error  string `json:"error"`
		Text   string `json:"text"`
	} `json:"requests"`
}

func loadEventsPageFixture(t *testing.T) eventsPageFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "events", "page.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f eventsPageFixture
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		t.Fatalf("page.json: %v", err)
	}
	return f
}

// checkEventsPage is the contract's page check: exactly {events, more,
// next}, next a string with the token prefix exactly when more, at least
// one item when more, items with exactly the item keys in (ts, id) order.
func checkEventsPage(raw []byte, itemKeys []string, prefix string) error {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		return errors.New("not an object")
	}
	if len(top) != 3 || top["events"] == nil || top["more"] == nil || top["next"] == nil {
		return errors.New("keys")
	}
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(top["events"], &items); err != nil || items == nil {
		return errors.New("events is an array")
	}
	var more bool
	if err := json.Unmarshal(top["more"], &more); err != nil {
		return errors.New("more is a boolean")
	}
	var next *string
	if err := json.Unmarshal(top["next"], &next); err != nil || (next != nil) != more {
		return errors.New("next must be a string exactly when more")
	}
	if more && !strings.HasPrefix(*next, prefix) {
		return errors.New("next starts with " + prefix)
	}
	if more && len(items) == 0 {
		return errors.New("a page holds at least one row while rows remain")
	}
	prevTS, prevID := "", ""
	for _, it := range items {
		if len(it) != len(itemKeys) {
			return errors.New("item keys")
		}
		for _, k := range itemKeys {
			if it[k] == nil {
				return errors.New("item keys")
			}
		}
		var id, ts, typ string
		var ws int64
		if json.Unmarshal(it["id"], &id) != nil || id == "" {
			return errors.New("id is a non-empty string")
		}
		if json.Unmarshal(it["ts"], &ts) != nil {
			return errors.New("ts is UTC whole seconds")
		}
		if p, err := time.Parse(time.RFC3339, ts); err != nil || p.UTC().Format(time.RFC3339) != ts {
			return errors.New("ts is UTC whole seconds")
		}
		if json.Unmarshal(it["workspaceId"], &ws) != nil {
			return errors.New("workspaceId is an integer")
		}
		if json.Unmarshal(it["type"], &typ) != nil {
			return errors.New("type is a string")
		}
		if ts < prevTS || (ts == prevTS && id <= prevID) {
			return errors.New("items are in (ts, id) order")
		}
		prevTS, prevID = ts, id
	}
	return nil
}

func TestEventsPageContractShapes(t *testing.T) {
	f := loadEventsPageFixture(t)
	if f.Budget.MaxLimit != events.MaxPageLimit || f.Budget.MaxPageBytes != events.MaxPageBytes || f.Budget.TokenPrefix != "e1." {
		t.Errorf("budget %+v differs from the server's", f.Budget)
	}
	for _, v := range f.Valid {
		if err := checkEventsPage(v.Page, f.Budget.ItemKeys, f.Budget.TokenPrefix); err != nil {
			t.Errorf("valid %q refused: %v", v.Name, err)
		}
	}
	for _, v := range f.Invalid {
		if err := checkEventsPage(v.Page, f.Budget.ItemKeys, f.Budget.TokenPrefix); err == nil || err.Error() != v.Reason {
			t.Errorf("invalid %q: err = %v, want %q", v.Name, err, v.Reason)
		}
	}
}

func TestEventsPageContractRequests(t *testing.T) {
	f := loadEventsPageFixture(t)
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	ws := createWorkspace(t, ts.URL, alice, "zh", "Chinese")
	other := createWorkspace(t, ts.URL, alice, "ja", "Japanese")
	bobWS := createWorkspace(t, ts.URL, bob, "zh", "Chinese")
	base := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	postEvents(t, ts.URL, alice, ws, 5, base)
	postEvents(t, ts.URL, alice, other, 1, base)
	postEvents(t, ts.URL, bob, bobWS, 1, base)

	if _, pages := walkEvents(t, ts.URL, alice, "/api/events?limit=2&workspace="+strconv.FormatInt(ws, 10), strconv.FormatInt(ws, 10)); pages != 3 {
		t.Fatalf("setup: limit=2 walk has %d pages, want 3", pages)
	}
	_, _, body := get(t, ts.URL, "/api/events?limit=2&since=1970-01-01T00:00:00Z&workspace="+strconv.FormatInt(ws, 10), alice)
	var first eventsPage
	if err := json.Unmarshal(body, &first); err != nil || first.Next == nil {
		t.Fatalf("setup first page: %s", body)
	}
	expand := strings.NewReplacer("$ws", strconv.FormatInt(ws, 10), "$otherWs", strconv.FormatInt(other, 10),
		"$bobWs", strconv.FormatInt(bobWS, 10), "$next", url.QueryEscape(*first.Next))

	for _, rq := range f.Requests {
		st, _, body := get(t, ts.URL, "/api/events?"+expand.Replace(rq.Query), alice)
		if st != rq.Status {
			t.Errorf("%s: %d %s, want %d", rq.Name, st, body, rq.Status)
			continue
		}
		switch {
		case rq.Form == "page":
			if err := checkEventsPage(body, f.Budget.ItemKeys, f.Budget.TokenPrefix); err != nil {
				t.Errorf("%s: page refused: %v", rq.Name, err)
			}
		case rq.Form == "legacy":
			var list []json.RawMessage
			if err := json.Unmarshal(body, &list); err != nil || len(list) != 5 {
				t.Errorf("%s: legacy answer %s", rq.Name, body)
			}
		case rq.Error != "":
			if code, _ := jsonError(t, body); code != rq.Error {
				t.Errorf("%s: code %q, want %q", rq.Name, code, rq.Error)
			}
		case rq.Text != "":
			if got := strings.TrimSuffix(string(body), "\n"); got != rq.Text {
				t.Errorf("%s: body %q, want %q", rq.Name, got, rq.Text)
			}
		default:
			t.Errorf("%s: the case names no form, error or text", rq.Name)
		}
	}
	foreign := false
	for _, rq := range f.Requests {
		foreign = foreign || rq.Status == http.StatusNotFound
	}
	if !foreign {
		t.Error("the fixture has no foreign-workspace case")
	}
}
