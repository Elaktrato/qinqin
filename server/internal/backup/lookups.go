package backup

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strconv"
	"time"
)

// The qinqin-core lookup history row (docs/contracts/lookups/README.md):
// one per workspace, {version: 1, clearedAt, items: [...], ...unknown}. The
// server never reads it except here: an export names the items' entries in
// refs/entries.json, a restore moves the items to the target's entries and
// books. The parse rules mirror apps/web/src/lib/lookups/lookups.ts.
const (
	lookupsKey      = "lookups"
	lookupCap       = 500
	lookupMaxCount  = 1_000_000
	lookupMaxBooks  = 3
	maxSafeJSONInts = 1<<53 - 1
)

var rfc3339Re = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`)

type lookupSource struct {
	key string
	n   int64
}

type lookupItem struct {
	entryID         int64
	count           int64
	firstAt, lastAt string
	first, last     time.Time
	sources         []lookupSource
	books           []int64
}

func isLookupsRow(r PluginRow) bool { return r.PluginID == CorePlugin && r.Key == lookupsKey }

// jsonInt reads a JSON number that is an integer (no fraction; 1.0 counts,
// as in JavaScript) within the safe integer range.
func jsonInt(raw json.RawMessage) (int64, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || !(raw[0] == '-' || (raw[0] >= '0' && raw[0] <= '9')) {
		return 0, false
	}
	f, err := strconv.ParseFloat(string(raw), 64)
	if err != nil || f != math.Trunc(f) || math.Abs(f) > maxSafeJSONInts {
		return 0, false
	}
	return int64(f), true
}

func jsonTime(raw json.RawMessage) (string, time.Time, bool) {
	var s string
	if len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, &s) != nil || !rfc3339Re.MatchString(s) {
		return "", time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return "", time.Time{}, false
	}
	return s, t, true
}

// lookupsObject decodes the row's data: an object, or a JSON string holding
// one (as the web SDK reads it). False when it is not a version 1 object.
func lookupsObject(data json.RawMessage) ([]kv, bool) {
	data = bytes.TrimSpace(data)
	if len(data) > 0 && data[0] == '"' {
		var s string
		if json.Unmarshal(data, &s) != nil {
			return nil, false
		}
		data = json.RawMessage(s)
	}
	members, ok := parseObject(data)
	if !ok {
		return nil, false
	}
	for _, m := range members {
		if m.key == "version" {
			v, ok := jsonInt(m.raw)
			return members, ok && v == 1
		}
	}
	return nil, false
}

func parseLookupItem(raw json.RawMessage) (lookupItem, bool) {
	members, ok := parseObject(raw)
	if !ok {
		return lookupItem{}, false
	}
	get := map[string]json.RawMessage{}
	for _, m := range members {
		if _, dup := get[m.key]; !dup {
			get[m.key] = m.raw
		}
	}
	var it lookupItem
	if it.entryID, ok = jsonInt(get["entryId"]); !ok || it.entryID < 1 {
		return it, false
	}
	if it.count, ok = jsonInt(get["count"]); !ok || it.count < 1 {
		return it, false
	}
	it.count = min(it.count, lookupMaxCount)
	if it.firstAt, it.first, ok = jsonTime(get["firstAt"]); !ok {
		return it, false
	}
	if it.lastAt, it.last, ok = jsonTime(get["lastAt"]); !ok {
		return it, false
	}
	if it.first.After(it.last) {
		it.firstAt, it.first = it.lastAt, it.last
	}
	if src, ok := parseObject(get["sources"]); ok {
		for _, m := range src {
			if n, ok := jsonInt(m.raw); ok && n >= 0 {
				it.sources = addSource(it.sources, m.key, n)
			}
		}
	}
	var books []json.RawMessage
	if json.Unmarshal(get["books"], &books) == nil {
		for _, b := range books {
			if id, ok := jsonInt(b); ok && id >= 1 {
				it.books = appendBook(it.books, id)
			}
		}
	}
	return it, true
}

// addSource adds n to the source key (a new key goes last), clamped.
func addSource(s []lookupSource, key string, n int64) []lookupSource {
	for i := range s {
		if s[i].key == key {
			s[i].n = min(s[i].n+n, lookupMaxCount)
			return s
		}
	}
	return append(s, lookupSource{key, min(n, lookupMaxCount)})
}

// appendBook appends a distinct book while fewer than lookupMaxBooks are held.
func appendBook(books []int64, id int64) []int64 {
	if len(books) >= lookupMaxBooks {
		return books
	}
	for _, b := range books {
		if b == id {
			return books
		}
	}
	return append(books, id)
}

func (it lookupItem) json() json.RawMessage {
	src := make([]kv, 0, len(it.sources))
	for _, s := range it.sources {
		src = append(src, kv{s.key, num(s.n)})
	}
	books := it.books
	if books == nil {
		books = []int64{}
	}
	b, _ := json.Marshal(books)
	first, _ := json.Marshal(it.firstAt)
	last, _ := json.Marshal(it.lastAt)
	return buildObject([]kv{
		{"entryId", num(it.entryID)}, {"count", num(it.count)}, {"firstAt", first}, {"lastAt", last},
		{"sources", buildObject(src)}, {"books", b},
	})
}

// lookups remaps a lookups row (workspace already mapped): every item
// follows its entry (unresolved: dropped) and its books (unresolved ids
// removed); items landing on one target entry merge; the list is sorted
// newest first and capped. Every other top-level member keeps its bytes.
// A row that is not a version 1 object, or has no workspace, is dropped.
func (m *Maps) lookups(r PluginRow) (PluginRow, bool) {
	if r.WorkspaceID == nil {
		return r, true
	}
	members, ok := lookupsObject(r.Data)
	if !ok {
		return r, true
	}
	var rawItems []json.RawMessage
	for _, mb := range members {
		if mb.key == "items" {
			if json.Unmarshal(mb.raw, &rawItems) != nil {
				rawItems = nil
			}
		}
	}
	seen := map[int64]bool{}
	groups := map[int64][]lookupItem{}
	var order []int64
	for _, raw := range rawItems {
		it, ok := parseLookupItem(raw)
		if !ok || seen[it.entryID] {
			continue
		}
		seen[it.entryID] = true
		target, ok := m.Entries[it.entryID]
		if !ok {
			continue
		}
		var books []int64
		for _, b := range it.books {
			if nb, ok := m.Books[b]; ok {
				books = appendBook(books, nb)
			}
		}
		it.entryID, it.books = target, books
		if _, has := groups[target]; !has {
			order = append(order, target)
		}
		groups[target] = append(groups[target], it)
	}
	items := make([]lookupItem, 0, len(order))
	for _, target := range order {
		items = append(items, mergeLookupItems(groups[target]))
	}
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if !a.last.Equal(b.last) {
			return a.last.After(b.last)
		}
		if a.count != b.count {
			return a.count > b.count
		}
		return a.entryID < b.entryID
	})
	if len(items) > lookupCap {
		items = items[:lookupCap]
	}
	var list bytes.Buffer
	list.WriteByte('[')
	for i, it := range items {
		if i > 0 {
			list.WriteByte(',')
		}
		list.Write(it.json())
	}
	list.WriteByte(']')
	out := make([]kv, 0, len(members)+1)
	hasItems := false
	for _, mb := range members {
		if mb.key == "items" {
			if hasItems {
				continue
			}
			hasItems = true
			mb.raw = list.Bytes()
		}
		out = append(out, mb)
	}
	if !hasItems {
		out = append(out, kv{"items", list.Bytes()})
	}
	r.Data = buildObject(out)
	return r, false
}

// mergeLookupItems folds the items of one target entry: counts and sources
// summed (clamped), the earliest firstAt, the latest lastAt, books from the
// newest item first, distinct, at most three.
func mergeLookupItems(group []lookupItem) lookupItem {
	byNewest := append([]lookupItem(nil), group...)
	sort.SliceStable(byNewest, func(i, j int) bool { return byNewest[i].last.After(byNewest[j].last) })
	out := lookupItem{entryID: group[0].entryID}
	for i, it := range group {
		if i == 0 {
			out.firstAt, out.first, out.lastAt, out.last = it.firstAt, it.first, it.lastAt, it.last
		} else {
			if it.first.Before(out.first) {
				out.firstAt, out.first = it.firstAt, it.first
			}
			if it.last.After(out.last) {
				out.lastAt, out.last = it.lastAt, it.last
			}
		}
		out.count = min(out.count+it.count, lookupMaxCount)
		for _, s := range it.sources {
			out.sources = addSource(out.sources, s.key, s.n)
		}
	}
	for _, it := range byNewest {
		for _, b := range it.books {
			out.books = appendBook(out.books, b)
		}
	}
	return out
}

// lookupEntryIDs lists the entry ids of a lookups row's valid items (for
// refs/entries.json); nil for any other row.
func lookupEntryIDs(r PluginRow) []int64 {
	if !isLookupsRow(r) {
		return nil
	}
	members, ok := lookupsObject(r.Data)
	if !ok {
		return nil
	}
	var ids []int64
	for _, mb := range members {
		if mb.key != "items" {
			continue
		}
		var rawItems []json.RawMessage
		if json.Unmarshal(mb.raw, &rawItems) != nil {
			return nil
		}
		for _, raw := range rawItems {
			if it, ok := parseLookupItem(raw); ok {
				ids = append(ids, it.entryID)
			}
		}
		return ids
	}
	return nil
}
