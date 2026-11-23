package rows

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"
)

type codecFixture struct {
	Version    int    `json:"version"`
	Rule       string `json:"rule"`
	Namespace  string `json:"namespace"`
	ModifiedAt string `json:"modifiedAt"`
	Families   []struct {
		Key        string  `json:"key"`
		Collection *string `json:"collection"`
	} `json:"families"`
	Cases []struct {
		Name      string          `json:"name"`
		Key       string          `json:"key"`
		Data      json.RawMessage `json:"data"`
		Expect    json.RawMessage `json:"expect"`
		RoundTrip json.RawMessage `json:"roundTrip"`
	} `json:"cases"`
}

func TestLegacyCodecFixture(t *testing.T) {
	var fx codecFixture
	readFixture(t, "../backup/study-rows.json", &fx)
	if fx.Namespace != Namespace {
		t.Fatalf("namespace %q, want %q", fx.Namespace, Namespace)
	}
	mod, err := time.Parse(time.RFC3339, fx.ModifiedAt)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range fx.Families {
		got, ok := FamilyOf(f.Key)
		if f.Collection == nil {
			if ok {
				t.Errorf("FamilyOf(%q) = %s, want none", f.Key, got)
			}
		} else if !ok || string(got) != *f.Collection {
			t.Errorf("FamilyOf(%q) = %s %v, want %s", f.Key, got, ok, *f.Collection)
		}
	}
	unreadable, readable := 0, 0
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			r, err := FromLegacy(c.Key, c.Data)
			if string(c.Expect) == `"unreadable"` {
				unreadable++
				if !errors.Is(err, ErrUnreadable) {
					t.Fatalf("FromLegacy = %+v, %v; want ErrUnreadable", r, err)
				}
				return
			}
			readable++
			if err != nil {
				t.Fatalf("FromLegacy: %v", err)
			}
			var exp struct {
				Collection string          `json:"collection"`
				Row        json.RawMessage `json:"row"`
			}
			if err := json.Unmarshal(c.Expect, &exp); err != nil {
				t.Fatal(err)
			}
			if string(r.Family()) != exp.Collection {
				t.Errorf("family %s, want %s", r.Family(), exp.Collection)
			}
			r.M().WorkspaceID = 7 // FromLegacy leaves meta zero; Validate needs a workspace
			if err := Validate(r); err != nil {
				t.Errorf("Validate(FromLegacy) = %v", err)
			}
			enc, _ := json.Marshal(r)
			var body map[string]any
			json.Unmarshal(enc, &body)
			for _, k := range []string{"workspaceId", "version", "updatedAt", "deletedAt"} {
				delete(body, k)
			}
			bodyRaw, _ := json.Marshal(body)
			if got, want := jsonValue(t, bodyRaw), jsonValue(t, exp.Row); !reflect.DeepEqual(got, want) {
				t.Errorf("typed row:\n got %s\nwant %s", bodyRaw, exp.Row)
			}
			r.M().ModifiedAt = mod
			key, data := ToLegacy(r)
			if key != c.Key {
				t.Errorf("ToLegacy key %q, want %q", key, c.Key)
			}
			if got, want := jsonValue(t, data), jsonValue(t, c.RoundTrip); !reflect.DeepEqual(got, want) {
				t.Errorf("ToLegacy data:\n got %s\nwant %s", data, c.RoundTrip)
			}
			// What ToLegacy writes reads back to the same typed row.
			again, err := FromLegacy(key, data)
			if err != nil {
				t.Fatalf("FromLegacy(ToLegacy): %v", err)
			}
			if !Equal(again, r) {
				t.Errorf("FromLegacy(ToLegacy(r)) differs from r")
			}
		})
	}
	if unreadable == 0 || readable == 0 {
		t.Errorf("readable %d unreadable %d", readable, unreadable)
	}
}

// A key outside the families is not a legacy typed row.
func TestFromLegacyRefusesOtherKeys(t *testing.T) {
	for _, key := range []string{"goals:workspace", "known:5", "limits:other", ""} {
		if _, err := FromLegacy(key, json.RawMessage(`{"version":1}`)); !errors.Is(err, ErrUnreadable) {
			t.Errorf("FromLegacy(%q) = %v, want ErrUnreadable", key, err)
		}
	}
}

// ToLegacy writes extra first and every typed member over it, so a typed
// member always wins over an extra member of the same name, even for a row
// that was never validated (review fix, phase A: pins the order).
func TestToLegacyTypedMembersWinOverExtra(t *testing.T) {
	r := &Card{ID: "c-vocab-1", Kind: "vocab", EntryID: 1, DeckIDs: []string{"general"}, CreatedAt: "t",
		Extra: json.RawMessage(`{"id":"other","kind":"tone","entryId":9,"deckIds":["x"],"createdAt":"never","color":"red"}`)}
	key, data := ToLegacy(r)
	if key != "card:c-vocab-1" {
		t.Fatalf("key %q", key)
	}
	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"id": "c-vocab-1", "kind": "vocab", "entryId": float64(1), "deckIds": []any{"general"}, "createdAt": "t", "color": "red"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ToLegacy = %s, want typed members over extra", data)
	}
	s := &DeckSettingsRow{DeckID: "d1", CardTypes: []string{"cloze"}, NewOrder: &NewOrder{By: "frequency"},
		Extra: json.RawMessage(`{"deckId":"x","cardTypes":["reverse"],"newOrder":{"by":"added"},"updatedAt":"old"}`)}
	s.ModifiedAt = time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)
	_, data = ToLegacy(s)
	got = nil
	json.Unmarshal(data, &got)
	want = map[string]any{"deckId": "d1", "cardTypes": []any{"cloze"}, "newOrder": map[string]any{"by": "frequency"}, "updatedAt": "2026-11-12T10:00:00Z"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ToLegacy(deck settings) = %s", data)
	}
}
