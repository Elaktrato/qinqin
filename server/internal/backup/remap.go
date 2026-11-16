package backup

import (
	"bytes"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"time"
)

// Maps translate the archive's source ids into this server's ids. An id
// that is absent is unresolved: whatever refers to it is dropped (never
// guessed). Workspace and book ids are always new rows.
type Maps struct {
	Entries    map[int64]int64
	Sentences  map[int64]int64 // pack sentences resolved by the plan; own ones are added as they are inserted
	Workspaces map[int64]int64
	Books      map[int64]int64
	Dicts      map[int64]int64
	// Cards maps every old card id of the archive to its new id, or to
	// "orphan:<old>" for a dropped card. Filled by RegisterCard.
	Cards map[string]string
	// noteWinner names, per (source workspace, target note key), the
	// archive note row that is restored there. Filled by RegisterNote.
	noteWinner map[string]noteCandidate
}

type noteCandidate struct {
	sourceID int64
	at       time.Time
}

// NewMaps returns Maps with every table allocated.
func NewMaps() *Maps {
	return &Maps{Entries: map[int64]int64{}, Sentences: map[int64]int64{}, Workspaces: map[int64]int64{},
		Books: map[int64]int64{}, Dicts: map[int64]int64{}, Cards: map[string]string{},
		noteWinner: map[string]noteCandidate{}}
}

const (
	cardKeyPrefix     = "card:"
	vacationKeyPrefix = "vacation:"
	orphanPrefix      = "orphan:"
	noteKeyPrefix     = "note:"
)

type kv struct {
	key string
	raw json.RawMessage
}

// parseObject splits a JSON object into its members in order, keeping the
// bytes of every value untouched.
func parseObject(raw json.RawMessage) ([]kv, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil, false
	}
	var out []kv
	for dec.More() {
		t, err := dec.Token()
		key, ok := t.(string)
		if err != nil || !ok {
			return nil, false
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, false
		}
		out = append(out, kv{key, v})
	}
	if t, err := dec.Token(); err != nil || t != json.Delim('}') {
		return nil, false
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, false
	}
	return out, true
}

func buildObject(members []kv) json.RawMessage {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, m := range members {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(m.key)
		b.Write(k)
		b.WriteByte(':')
		b.Write(m.raw)
	}
	b.WriteByte('}')
	return b.Bytes()
}

// rewriteObject applies repl to the top-level members of raw: a non-nil
// value replaces the member, a nil value removes it. Member order and the
// bytes of every other value are kept. A non-object is returned unchanged.
func rewriteObject(raw json.RawMessage, repl map[string]json.RawMessage) json.RawMessage {
	members, ok := parseObject(raw)
	if !ok || len(repl) == 0 {
		return raw
	}
	out := members[:0:0]
	for _, m := range members {
		if r, has := repl[m.key]; has {
			if r == nil {
				continue
			}
			m.raw = r
		}
		out = append(out, m)
	}
	return buildObject(out)
}

func num(n int64) json.RawMessage { return json.RawMessage(strconv.FormatInt(n, 10)) }

func member(raw json.RawMessage, key string) (json.RawMessage, bool) {
	members, ok := parseObject(raw)
	if !ok {
		return nil, false
	}
	for _, m := range members {
		if m.key == key {
			return m.raw, true
		}
	}
	return nil, false
}

func intMember(raw json.RawMessage, key string) (int64, bool) {
	v, ok := member(raw, key)
	if !ok {
		return 0, false
	}
	var n json.Number
	if json.Unmarshal(v, &n) != nil {
		return 0, false
	}
	i, err := n.Int64()
	return i, err == nil
}

// mapCard decides one card row: its new id and data, or a drop. A card id
// c-<kind>-<n> whose number is the card's own entryId is DERIVED and follows
// the entry; any other id (a ULID) is kept.
func (m *Maps) mapCard(oldID string, data json.RawMessage) (newID string, newData json.RawMessage, drop bool) {
	entryID, hasEntry := intMember(data, "entryId")
	sentID, hasSent := intMember(data, "sentenceId")
	repl := map[string]json.RawMessage{}
	newID = oldID
	if hasEntry && entryID > 0 {
		ne, ok := m.Entries[entryID]
		if !ok {
			return "", nil, true
		}
		repl["entryId"] = num(ne)
		if kind, n, derived := ParseDerivedCardID(oldID); derived && n == entryID {
			newID = "c-" + kind + "-" + strconv.FormatInt(ne, 10)
		}
	}
	if hasSent && sentID > 0 {
		ns, ok := m.Sentences[sentID]
		if !ok {
			return "", nil, true
		}
		repl["sentenceId"] = num(ns)
	}
	if v, ok := member(data, "id"); ok && newID != oldID {
		var s string
		if json.Unmarshal(v, &s) == nil && s == oldID {
			b, _ := json.Marshal(newID)
			repl["id"] = b
		}
	}
	return newID, rewriteObject(data, repl), false
}

// RegisterCard records the old -> new id of a card row (call it for every
// card row before remapping events, so every id is decided in one pass over
// the OLD ids and swapped ids never chain).
func (m *Maps) RegisterCard(key string, data json.RawMessage) {
	old := strings.TrimPrefix(key, cardKeyPrefix)
	newID, _, drop := m.mapCard(old, data)
	if drop {
		m.Cards[old] = orphanPrefix + old
		return
	}
	m.Cards[old] = newID
}

// Card remaps one card row of qinqin-flashcards (key card:<id>).
func (m *Maps) Card(key string, data json.RawMessage) (newKey string, newData json.RawMessage, drop bool) {
	old := strings.TrimPrefix(key, cardKeyPrefix)
	newID, nd, drop := m.mapCard(old, data)
	if drop {
		return "", nil, true
	}
	return cardKeyPrefix + newID, nd, false
}

// cardID maps the cardId of a review event.
func (m *Maps) cardID(old string) string {
	if n, ok := m.Cards[old]; ok {
		return n
	}
	if kind, n, derived := ParseDerivedCardID(old); derived {
		// No row in the archive (the card was deleted): the id still names a word.
		if ne, ok := m.Entries[n]; ok {
			return "c-" + kind + "-" + strconv.FormatInt(ne, 10)
		}
		return orphanPrefix + old
	}
	return old
}

// Event remaps an event's workspace and the ids inside its payload. It
// returns drop when the workspace is not in the archive's map.
func (m *Maps) Event(e Event) (Event, bool) {
	ws, ok := m.Workspaces[e.WorkspaceID]
	if !ok {
		return e, true
	}
	e.WorkspaceID = ws
	switch e.Type {
	case "review":
		if v, ok := member(e.Payload, "cardId"); ok {
			var id string
			if json.Unmarshal(v, &id) == nil {
				b, _ := json.Marshal(m.cardID(id))
				e.Payload = rewriteObject(e.Payload, map[string]json.RawMessage{"cardId": b})
			}
		}
	case "read":
		if old, ok := intMember(e.Payload, "bookId"); ok {
			var r json.RawMessage // nil: removed when the book is unknown
			if nb, found := m.Books[old]; found {
				r = num(nb)
			}
			e.Payload = rewriteObject(e.Payload, map[string]json.RawMessage{"bookId": r})
		}
	case "view":
		if old, ok := intMember(e.Payload, "entryId"); ok {
			var r json.RawMessage
			if ne, found := m.Entries[old]; found {
				r = num(ne)
			}
			e.Payload = rewriteObject(e.Payload, map[string]json.RawMessage{"entryId": r})
		}
	}
	return e, false
}

// WorkspaceSettings remaps settings.hiddenDictionaries (by dictionary pack,
// through Dicts); ids this server has no dictionary for are dropped.
func (m *Maps) WorkspaceSettings(raw json.RawMessage) json.RawMessage {
	v, ok := member(raw, "hiddenDictionaries")
	if !ok {
		return raw
	}
	var ids []json.Number
	if json.Unmarshal(v, &ids) != nil {
		return raw
	}
	mapped := []int64{}
	for _, n := range ids {
		if id, err := n.Int64(); err == nil {
			if nd, found := m.Dicts[id]; found {
				mapped = append(mapped, nd)
			}
		}
	}
	b, _ := json.Marshal(mapped)
	return rewriteObject(raw, map[string]json.RawMessage{"hiddenDictionaries": b})
}

// vacationScope remaps scope.workspaces of a vacation row. "all" is kept; a
// period whose workspace list becomes empty is dropped (widening it to "all"
// would be wrong).
func (m *Maps) vacationScope(data json.RawMessage) (json.RawMessage, bool) {
	scope, ok := member(data, "scope")
	if !ok {
		return data, false
	}
	wsRaw, ok := member(scope, "workspaces")
	if !ok {
		return data, false // "all" or a shape this build does not know: untouched
	}
	var ids []json.Number
	if json.Unmarshal(wsRaw, &ids) != nil {
		return data, false
	}
	mapped := []int64{}
	for _, n := range ids {
		if id, err := n.Int64(); err == nil {
			if nw, found := m.Workspaces[id]; found {
				mapped = append(mapped, nw)
			}
		}
	}
	if len(mapped) == 0 {
		return nil, true
	}
	b, _ := json.Marshal(mapped)
	newScope := rewriteObject(scope, map[string]json.RawMessage{"workspaces": b})
	return rewriteObject(data, map[string]json.RawMessage{"scope": newScope}), false
}

// PluginRow remaps one plugin data row: its workspace (null stays null),
// flashcards card rows, vacation periods and qinqin-core notes. Every other
// row is restored as it is. drop is true for a row of an unknown workspace,
// a card of an unresolved entry or sentence, a vacation with no workspace
// left, and a note of an unresolved entry or one that loses its target to a
// newer note (RegisterNote).
func (m *Maps) PluginRow(r PluginRow) (PluginRow, bool) {
	src := r
	if r.WorkspaceID != nil {
		nw, ok := m.Workspaces[*r.WorkspaceID]
		if !ok {
			return r, true
		}
		r.WorkspaceID = &nw
	}
	if r.PluginID == CorePlugin {
		return m.note(src, r)
	}
	if r.PluginID != FlashcardsPlugin {
		return r, false
	}
	switch {
	case strings.HasPrefix(r.Key, cardKeyPrefix):
		nk, nd, drop := m.Card(r.Key, r.Data)
		if drop {
			return r, true
		}
		r.Key, r.Data = nk, nd
	case strings.HasPrefix(r.Key, vacationKeyPrefix):
		nd, drop := m.vacationScope(r.Data)
		if drop {
			return r, true
		}
		r.Data = nd
	}
	return r, false
}

// noteEntryID is the entry id of a qinqin-core note row: the key is
// note:<n> with n canonical decimal (positive, no sign, no leading zero)
// and data.entryId is the same n. Anything else is not a note.
func noteEntryID(r PluginRow) (int64, bool) {
	if r.PluginID != CorePlugin || !strings.HasPrefix(r.Key, noteKeyPrefix) {
		return 0, false
	}
	digits := strings.TrimPrefix(r.Key, noteKeyPrefix)
	if digits == "" || digits[0] < '1' || digits[0] > '9' {
		return 0, false
	}
	for _, c := range digits {
		if c < '0' || c > '9' {
			return 0, false
		}
	}
	n, err := strconv.ParseInt(digits, 10, 64)
	if err != nil {
		return 0, false
	}
	if id, ok := intMember(r.Data, "entryId"); !ok || id != n {
		return 0, false
	}
	return n, true
}

// noteSlot is the winner-map key of a note's target: the source workspace
// (workspaces map one to one) and the target entry.
func noteSlot(r PluginRow, target int64) string {
	ws := "null"
	if r.WorkspaceID != nil {
		ws = strconv.FormatInt(*r.WorkspaceID, 10)
	}
	return ws + "\x00" + strconv.FormatInt(target, 10)
}

func noteTime(r PluginRow) time.Time {
	s := r.UpdatedAt
	if r.ModifiedAt != nil && *r.ModifiedAt != "" {
		s = *r.ModifiedAt
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// RegisterNote records, per target note, the archive row that wins it: the
// newest modifiedAt ?? updatedAt, ties to the smaller source entry id. Call
// it for every archive row (non-notes are ignored) before PluginRow; without
// it every note is its own winner.
func (m *Maps) RegisterNote(r PluginRow) {
	src, ok := noteEntryID(r)
	if !ok {
		return
	}
	target, ok := m.Entries[src]
	if !ok {
		return
	}
	if m.noteWinner == nil {
		m.noteWinner = map[string]noteCandidate{}
	}
	cand := noteCandidate{sourceID: src, at: noteTime(r)}
	slot := noteSlot(r, target)
	cur, has := m.noteWinner[slot]
	if !has || cand.at.After(cur.at) || (cand.at.Equal(cur.at) && cand.sourceID < cur.sourceID) {
		m.noteWinner[slot] = cand
	}
}

// IsNoteLoser reports a note row that maps to a resolved entry but loses
// that target to another archive note (see RegisterNote).
func (m *Maps) IsNoteLoser(r PluginRow) bool {
	src, ok := noteEntryID(r)
	if !ok {
		return false
	}
	target, ok := m.Entries[src]
	if !ok {
		return false
	}
	w, has := m.noteWinner[noteSlot(r, target)]
	return has && w.sourceID != src
}

// NoteEntryID is the source entry id of a qinqin-core note row, if it is one.
func NoteEntryID(r PluginRow) (int64, bool) { return noteEntryID(r) }

// note remaps a qinqin-core row (src as in the archive, r with its
// workspace already mapped): a note
// follows its entry (key and entryId rewritten together, other bytes kept),
// is dropped when the entry is unresolved or another note wins the target;
// any other core row is restored as it is.
func (m *Maps) note(src, r PluginRow) (PluginRow, bool) {
	id, ok := noteEntryID(src)
	if !ok {
		return r, false
	}
	target, ok := m.Entries[id]
	if !ok {
		return r, true
	}
	if m.IsNoteLoser(src) {
		return r, true
	}
	r.Key = noteKeyPrefix + strconv.FormatInt(target, 10)
	r.Data = rewriteObject(r.Data, map[string]json.RawMessage{"entryId": num(target)})
	return r, false
}
