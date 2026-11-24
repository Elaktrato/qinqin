package rows

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"
)

// Legacy key prefixes of the typed families (v0.3.0 apps/web/src/lib/study).
const (
	cardPrefix       = "card:"
	deckPrefix       = "deck:"
	deckcfgPrefix    = "deckcfg:"
	limitsWorkspace  = "limits:workspace"
	limitsDeckPrefix = "limits:deck:"
	setPrefix        = "fsrs:set:"
	activeKey        = "fsrs:active"
)

// FamilyOf reports the typed family a legacy qinqin-flashcards key belongs
// to. A key of a family may still be unreadable (FromLegacy decides); every
// other key stays a keyed plugin-data row.
func FamilyOf(key string) (Family, bool) {
	switch {
	case strings.HasPrefix(key, cardPrefix):
		return Cards, true
	case strings.HasPrefix(key, deckPrefix):
		return Decks, true
	case strings.HasPrefix(key, deckcfgPrefix):
		return DeckSettings, true
	case key == limitsWorkspace, strings.HasPrefix(key, limitsDeckPrefix):
		return Limits, true
	case strings.HasPrefix(key, setPrefix):
		return FsrsSets, true
	case key == activeKey:
		return FsrsActive, true
	}
	return "", false
}

// LegacyKey is the qinqin-flashcards key of a typed row.
func LegacyKey(r Row) string {
	switch x := r.(type) {
	case *Card:
		return cardPrefix + x.ID
	case *Deck:
		return deckPrefix + x.ID
	case *DeckSettingsRow:
		return deckcfgPrefix + x.DeckID
	case *LimitsRow:
		if x.DeckID == nil {
			return limitsWorkspace
		}
		return limitsDeckPrefix + *x.DeckID
	case *FsrsSet:
		return setPrefix + x.ID
	case *FsrsActiveRow:
		return activeKey
	}
	return ""
}

// object is a legacy payload being read: members are taken out as they are
// consumed; what is left is extra.
type object map[string]json.RawMessage

func unreadable(key, why string) error {
	return fmt.Errorf("%w: %s: %s", ErrUnreadable, key, why)
}

// value decodes a member as a JSON value with numbers as json.Number.
func value(raw json.RawMessage) any {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if dec.Decode(&v) != nil {
		return nil
	}
	return v
}

func (o object) take(name string) (json.RawMessage, bool) {
	v, ok := o[name]
	if ok {
		delete(o, name)
	}
	return v, ok
}

// keep puts a member back into extra (a known member the shape cannot carry).
func (o object) keep(name string, raw json.RawMessage) { o[name] = raw }

func (o object) str(name string) (string, bool) {
	s, ok := value(o[name]).(string)
	return s, ok
}

func (o object) extra() json.RawMessage {
	if len(o) == 0 {
		return json.RawMessage(`{}`)
	}
	raw, _ := json.Marshal(map[string]json.RawMessage(o))
	return raw
}

// number reads a JSON number as the web parsers saw it (a float64).
func number(raw json.RawMessage) (float64, bool) {
	n, ok := value(raw).(json.Number)
	if !ok {
		return 0, false
	}
	f, err := n.Float64()
	return f, err == nil && !math.IsInf(f, 0) && !math.IsNaN(f)
}

// entryInt reads an entry or sentence id: a number that is an integer in
// 1..2^53-1 (1201.0 reads as 1201, as it did on the web).
func entryInt(raw json.RawMessage) (int64, bool) {
	f, ok := number(raw)
	if !ok || f != math.Trunc(f) || f < 1 || f > MaxEntryID {
		return 0, false
	}
	return int64(f), true
}

// strings returns the string members of a JSON list, deduplicated in order.
func uniqueStrings(raw json.RawMessage) ([]string, bool) {
	list, ok := value(raw).([]any)
	if !ok {
		return nil, false
	}
	out := []string{}
	for _, v := range list {
		if s, ok := v.(string); ok && !slices.Contains(out, s) {
			out = append(out, s)
		}
	}
	return out, true
}

// kindsOf is the web's cleanCardTypes / cleanSkipKinds: the allowed kinds
// the list holds, in kind order.
func kindsOf(raw json.RawMessage, allowed []string) ([]string, bool) {
	list, ok := value(raw).([]any)
	if !ok {
		return nil, false
	}
	out := []string{}
	for _, k := range allowed {
		if slices.Contains(list, any(k)) {
			out = append(out, k)
		}
	}
	return out, true
}

// FromLegacy reads one legacy qinqin-flashcards row (key and data) as the
// v0.3.0 web parsers did; ErrUnreadable for a row they ignored. Meta is
// left zero.
func FromLegacy(key string, data json.RawMessage) (Row, error) {
	f, ok := FamilyOf(key)
	if !ok {
		return nil, unreadable(key, "not a typed study key")
	}
	var o object
	if err := json.Unmarshal(data, &o); err != nil || o == nil {
		return nil, unreadable(key, "data is not an object")
	}
	var r Row
	var err error
	switch f {
	case Cards:
		r, err = cardFromLegacy(key, o)
	case Decks:
		r, err = deckFromLegacy(key, o)
	case DeckSettings:
		r, err = settingsFromLegacy(key, o)
	case Limits:
		r, err = limitsFromLegacy(key, o)
	case FsrsSets:
		r, err = setFromLegacy(key, o)
	case FsrsActive:
		r, err = activeFromLegacy(o)
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}

func cardFromLegacy(key string, o object) (Row, error) {
	id, ok1 := o.str("id")
	kind, ok2 := o.str("kind")
	createdAt, ok3 := o.str("createdAt")
	if !ok1 || !ok3 || !ok2 || !slices.Contains(CardKinds, kind) {
		return nil, unreadable(key, "id, kind or createdAt")
	}
	if key != cardPrefix+id {
		return nil, unreadable(key, "key and id disagree")
	}
	entry, ok := entryInt(o["entryId"])
	if !ok {
		return nil, unreadable(key, "entryId is not an integer in 1..2^53-1")
	}
	decks, ok := uniqueStrings(o["deckIds"])
	if !ok {
		return nil, unreadable(key, "deckIds is not a list")
	}
	c := &Card{ID: id, Kind: kind, EntryID: entry, DeckIDs: decks, CreatedAt: createdAt, SkipKinds: []string{}}
	for _, n := range []string{"id", "kind", "createdAt", "entryId", "deckIds"} {
		delete(o, n)
	}
	if raw, ok := o.take("written"); ok {
		if s, isStr := value(raw).(string); isStr {
			c.Written = &s
		} else {
			o.keep("written", raw)
		}
	}
	if raw, ok := o.take("entryKind"); ok {
		if s, _ := value(raw).(string); s == "character" {
			c.EntryKind = &s
		} else {
			o.keep("entryKind", raw)
		}
	}
	if raw, ok := o.take("sentenceId"); ok {
		// The v0.3.0 web kept any number here; one the typed shape cannot
		// carry (not an integer in 1..2^53-1) stays in extra, so the card is
		// still read (review fix, phase A).
		if n, ok := entryInt(raw); ok {
			c.SentenceID = &n
		} else {
			o.keep("sentenceId", raw)
		}
	}
	if raw, ok := o.take("skipKinds"); ok {
		kinds, isList := kindsOf(raw, CardKinds[1:])
		if kind == "vocab" && isList {
			c.SkipKinds = kinds
		} else {
			o.keep("skipKinds", raw)
		}
	}
	c.Extra = o.extra()
	return c, nil
}

func sourceFromLegacy(raw json.RawMessage) *DeckSource {
	m, ok := value(raw).(map[string]any)
	if !ok {
		return nil
	}
	str := func(k string) (string, bool) { s, ok := m[k].(string); return s, ok }
	switch m["type"] {
	case "level":
		pack, ok1 := str("packId")
		level, ok2 := str("level")
		if ok1 && ok2 {
			return &DeckSource{Type: "level", PackID: pack, Level: level}
		}
	case "frequency":
		pack, ok1 := str("packId")
		n, ok2 := m["size"].(json.Number)
		if ok1 && ok2 {
			if f, err := n.Float64(); err == nil && f == math.Trunc(f) && f > 0 && f <= MaxEntryID {
				return &DeckSource{Type: "frequency", PackID: pack, Size: int64(f)}
			}
		}
	}
	return nil
}

func deckFromLegacy(key string, o object) (Row, error) {
	id, ok1 := o.str("id")
	name, ok2 := o.str("name")
	createdAt, ok3 := o.str("createdAt")
	if !ok1 || !ok2 || !ok3 {
		return nil, unreadable(key, "id, name or createdAt")
	}
	if key != deckPrefix+id {
		return nil, unreadable(key, "key and id disagree")
	}
	d := &Deck{ID: id, Name: name, CreatedAt: createdAt}
	for _, n := range []string{"id", "name", "createdAt"} {
		delete(o, n)
	}
	if raw, ok := o.take("source"); ok {
		if s := sourceFromLegacy(raw); s != nil {
			d.Source = s
		} else {
			o.keep("source", raw)
		}
	}
	d.Extra = o.extra()
	return d, nil
}

func orderFromLegacy(raw json.RawMessage) *NewOrder {
	m, ok := value(raw).(map[string]any)
	if !ok {
		return nil
	}
	switch m["by"] {
	case "added", "frequency":
		return &NewOrder{By: m["by"].(string)}
	case "level":
		if p, ok := m["packId"].(string); ok && p != "" {
			return &NewOrder{By: "level", PackID: p}
		}
	}
	return nil
}

func settingsFromLegacy(key string, o object) (Row, error) {
	deckID, ok := o.str("deckId")
	if !ok || deckID == "" {
		return nil, unreadable(key, "deckId")
	}
	if key != deckcfgPrefix+deckID {
		return nil, unreadable(key, "key and deckId disagree")
	}
	s := &DeckSettingsRow{DeckID: deckID, CardTypes: []string{}}
	if types, ok := kindsOf(o["cardTypes"], OptInKinds); ok {
		s.CardTypes = types
	}
	// The inner updatedAt is replaced by the row's edit time (ToLegacy).
	for _, n := range []string{"deckId", "cardTypes", "updatedAt"} {
		delete(o, n)
	}
	if raw, ok := o.take("newOrder"); ok {
		if order := orderFromLegacy(raw); order != nil {
			s.NewOrder = order
		} else {
			o.keep("newOrder", raw)
		}
	}
	s.Extra = o.extra()
	return s, nil
}

// limitOf reads a limits field as the web did: null or an integer 0..9999.
func limitOf(raw json.RawMessage) (*LimitField, bool) {
	if isNull(raw) {
		return &LimitField{}, true
	}
	f, ok := number(raw)
	if !ok || f != math.Trunc(f) || f < 0 || f > MaxLimit {
		return nil, false
	}
	n := int(f)
	return &LimitField{Limit: &n}, true
}

func limitsFromLegacy(key string, o object) (Row, error) {
	l := &LimitsRow{}
	if key != limitsWorkspace {
		deck := strings.TrimPrefix(key, limitsDeckPrefix)
		if deck == "" {
			return nil, unreadable(key, "a deck limits key without a deck id")
		}
		l.DeckID = &deck
	}
	if v, ok := number(o["version"]); !ok || v != 1 {
		return nil, unreadable(key, "version is not 1")
	}
	delete(o, "version")
	for _, name := range []string{"new", "reviews"} {
		raw, ok := o.take(name)
		if !ok {
			continue
		}
		if lf, usable := limitOf(raw); usable {
			if name == "new" {
				l.New = lf
			} else {
				l.Reviews = lf
			}
		} else {
			o.keep(name, raw)
		}
	}
	l.Extra = o.extra()
	return l, nil
}

func setFromLegacy(key string, o object) (Row, error) {
	id, ok1 := o.str("id")
	createdAt, ok2 := o.str("createdAt")
	source, ok3 := o.str("source")
	if !ok1 || !ok2 || !ok3 || (source != "optimized" && source != "imported") {
		return nil, unreadable(key, "id, createdAt or source")
	}
	if key != setPrefix+id {
		return nil, unreadable(key, "key and id disagree")
	}
	list, ok := value(o["w"]).([]any)
	if !ok || len(list) != 21 {
		return nil, unreadable(key, "w is not 21 numbers")
	}
	w := make([]float64, len(list))
	for i, v := range list {
		n, isNum := v.(json.Number)
		f, err := n.Float64()
		if !isNum || err != nil {
			return nil, unreadable(key, "w is not 21 numbers")
		}
		w[i] = f
	}
	s := &FsrsSet{ID: id, W: w, CreatedAt: createdAt, Source: source}
	for _, n := range []string{"id", "createdAt", "source", "w"} {
		delete(o, n)
	}
	for name, dst := range map[string]**float64{"labelled": &s.Labelled, "logLoss": &s.LogLoss, "baselineLogLoss": &s.BaselineLogLoss} {
		raw, ok := o.take(name)
		if !ok {
			continue
		}
		f, isNum := number(raw)
		if !isNum {
			return nil, unreadable(key, name+" is not a number")
		}
		*dst = &f
	}
	s.Extra = o.extra()
	return s, nil
}

func activeFromLegacy(o object) (Row, error) {
	a := &FsrsActiveRow{}
	for name, dst := range map[string]**string{"setId": &a.SetID, "changedAt": &a.ChangedAt} {
		raw, ok := o.take(name)
		if !ok || isNull(raw) {
			continue
		}
		if s, isStr := value(raw).(string); isStr {
			*dst = &s
		} else {
			o.keep(name, raw)
		}
	}
	a.Extra = o.extra()
	return a, nil
}

// ToLegacy writes a typed row as its legacy qinqin-flashcards row: extra
// first, then every typed member (a set typed member wins). Deck settings
// carry updatedAt = the row's edit time (ModifiedAt, else UpdatedAt).
func ToLegacy(r Row) (key string, data json.RawMessage) {
	o := object{}
	var extra json.RawMessage
	put := func(name string, v any) {
		raw, _ := json.Marshal(v)
		o[name] = raw
	}
	switch x := r.(type) {
	case *Card:
		extra = x.Extra
		mergeExtra(o, extra)
		put("id", x.ID)
		put("kind", x.Kind)
		put("entryId", x.EntryID)
		put("deckIds", orEmpty(x.DeckIDs))
		put("createdAt", x.CreatedAt)
		if x.Written != nil {
			put("written", *x.Written)
		}
		if x.EntryKind != nil {
			put("entryKind", *x.EntryKind)
		}
		if x.SentenceID != nil {
			put("sentenceId", *x.SentenceID)
		}
		if len(x.SkipKinds) > 0 {
			put("skipKinds", x.SkipKinds)
		}
	case *Deck:
		mergeExtra(o, x.Extra)
		put("id", x.ID)
		put("name", x.Name)
		put("createdAt", x.CreatedAt)
		if x.Source != nil {
			put("source", x.Source)
		}
	case *DeckSettingsRow:
		mergeExtra(o, x.Extra)
		put("deckId", x.DeckID)
		put("cardTypes", orEmpty(x.CardTypes))
		if x.NewOrder != nil {
			put("newOrder", x.NewOrder)
		}
		at := x.ModifiedAt
		if at.IsZero() {
			at = x.UpdatedAt
		}
		put("updatedAt", at.UTC().Format(time.RFC3339))
	case *LimitsRow:
		mergeExtra(o, x.Extra)
		put("version", 1)
		for name, lf := range map[string]*LimitField{"new": x.New, "reviews": x.Reviews} {
			if lf != nil {
				put(name, lf.Limit)
			}
		}
	case *FsrsSet:
		mergeExtra(o, x.Extra)
		put("id", x.ID)
		put("w", orEmpty(x.W))
		put("createdAt", x.CreatedAt)
		put("source", x.Source)
		for name, v := range map[string]*float64{"labelled": x.Labelled, "logLoss": x.LogLoss, "baselineLogLoss": x.BaselineLogLoss} {
			if v != nil {
				put(name, *v)
			}
		}
	case *FsrsActiveRow:
		mergeExtra(o, x.Extra)
		for name, v := range map[string]*string{"setId": x.SetID, "changedAt": x.ChangedAt} {
			if v != nil {
				put(name, *v)
			} else if _, inExtra := o[name]; !inExtra {
				put(name, nil)
			}
		}
	}
	raw, _ := json.Marshal(map[string]json.RawMessage(o))
	return LegacyKey(r), raw
}

func mergeExtra(o object, extra json.RawMessage) {
	var m map[string]json.RawMessage
	if json.Unmarshal(extra, &m) == nil {
		for k, v := range m {
			o[k] = v
		}
	}
}

// KeyIdentity splits a legacy typed key into its family and identity
// without reading data (a deletion carries none): card:<id>, deck:<id>,
// deckcfg:<deckId>, limits:workspace (""), limits:deck:<deckId>,
// fsrs:set:<id>, fsrs:active (""). False for any other key and for a deck
// key without a deck id.
func KeyIdentity(key string) (Family, string, bool) {
	f, ok := FamilyOf(key)
	if !ok {
		return "", "", false
	}
	switch f {
	case Cards:
		return f, strings.TrimPrefix(key, cardPrefix), true
	case Decks:
		return f, strings.TrimPrefix(key, deckPrefix), true
	case DeckSettings:
		id := strings.TrimPrefix(key, deckcfgPrefix)
		return f, id, id != ""
	case Limits:
		if key == limitsWorkspace {
			return f, "", true
		}
		id := strings.TrimPrefix(key, limitsDeckPrefix)
		return f, id, id != ""
	case FsrsSets:
		return f, strings.TrimPrefix(key, setPrefix), true
	}
	return f, "", true
}
