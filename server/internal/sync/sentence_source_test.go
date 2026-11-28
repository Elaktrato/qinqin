package sync

import (
	"context"
	"encoding/json"
	"testing"
)

// An own sentence's source (#280) ships on its pull row: the object when it
// has one (bookId null once the book is gone), null when it has none.
func TestPullShipsSentenceSources(t *testing.T) {
	w := newWorld(t)
	w.addWorkspace("z", "alice", "zh", "2026-11-12T07:00:00Z")
	alice := w.users["alice"]
	w.entry("e", "zh")
	e := w.entries["e"]
	w.exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at,
		source_kind, source_book_id, source_title, source_chapter, source_paragraph, source_start, source_end)
		VALUES (?, '', ?, '一。', '', '', '2026-11-12T08:00:00Z', 'book', 5, 'Book five', 1, 2, 3, 5),
		       (?, '', ?, '二。', '', '', '2026-11-12T08:01:00Z', 'book', NULL, 'Gone', 0, 0, 0, 1),
		       (?, '', ?, '三。', '', '', '2026-11-12T08:02:00Z', '', NULL, '', 0, 0, 0, 0)`,
		e, alice, e, alice, e, alice)
	p, err := PullPage(context.Background(), w.db, alice, PageRequest{Only: map[string]bool{"sentences": true}, Now: at("2026-12-01T00:00:00Z")}, testCatalogue)
	if err != nil {
		t.Fatal(err)
	}
	var list []struct {
		Hanzi  string           `json:"hanzi"`
		Source *json.RawMessage `json:"source"`
	}
	var raw []map[string]json.RawMessage
	json.Unmarshal(p.Collections["sentences"], &list)
	json.Unmarshal(p.Collections["sentences"], &raw)
	if len(list) != 3 {
		t.Fatalf("sentences = %s", p.Collections["sentences"])
	}
	want := map[string]string{
		"一。": `{"kind":"book","bookId":5,"title":"Book five","chapter":1,"paragraph":2,"start":3,"end":5}`,
		"二。": `{"kind":"book","bookId":null,"title":"Gone","chapter":0,"paragraph":0,"start":0,"end":1}`,
	}
	for i, s := range list {
		if _, present := raw[i]["source"]; !present {
			t.Fatalf("%s: no source key", s.Hanzi)
		}
		got := "null"
		if s.Source != nil {
			got = string(*s.Source)
		}
		if w, ok := want[s.Hanzi]; ok && got != w || !ok && got != "null" {
			t.Errorf("%s: source = %s", s.Hanzi, got)
		}
	}
}
