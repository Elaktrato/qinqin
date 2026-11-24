// Package rows holds the typed study rows (cards, decks, deck settings,
// limits, FSRS parameter sets, the active set): their wire shapes, the
// strict wire decode, and the codec to and from the legacy
// qinqin-flashcards plugin-data rows they replaced. It knows no database.
// Contract: docs/contracts/study/.
package rows

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"time"
)

// Family is a typed study collection, named as on the wire.
type Family string

const (
	Cards        Family = "cards"
	Decks        Family = "decks"
	DeckSettings Family = "deckSettings"
	Limits       Family = "limits"
	FsrsSets     Family = "fsrsSets"
	FsrsActive   Family = "fsrsActive"
)

// Families lists every collection in wire order.
var Families = []Family{Cards, Decks, DeckSettings, Limits, FsrsSets, FsrsActive}

var (
	// ErrUnreadable is a legacy row the codec cannot read (the v0.3.0 web
	// parsers ignored it too).
	ErrUnreadable = errors.New("study rows: unreadable legacy row")
	// ErrInvalid is a wire row that breaks the shape; the message names the member.
	ErrInvalid = errors.New("study rows: invalid row")
)

// MaxEntryID is the largest entry or sentence id a row may carry (2^53-1,
// the largest integer every client can hold exactly).
const MaxEntryID = 1<<53 - 1

// MaxLimit is the largest daily limit.
const MaxLimit = 9999

// CardKinds are the card kinds in kind order; OptInKinds the deck card types.
var (
	CardKinds  = []string{"vocab", "sentence", "writing", "tone", "reverse", "cloze"}
	OptInKinds = []string{"reverse", "cloze"}
)

// Meta is the sync part of every row. UpdatedAt is the server write stamp
// (on push: the edit time); ModifiedAt, the stored edit time, never travels
// on the wire (ToLegacy writes it into a deck settings row).
type Meta struct {
	WorkspaceID int64      `json:"workspaceId"`
	Version     int        `json:"version"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	DeletedAt   *time.Time `json:"deletedAt"`
	ModifiedAt  time.Time  `json:"-"`
}

// Row is one typed study row.
type Row interface {
	Family() Family
	// Identity is the row's key inside its user and workspace: the id, the
	// deck id ("" for the workspace limits row), or "" for the active set.
	Identity() string
	M() *Meta
}

// Card is a `cards` row.
type Card struct {
	ID         string          `json:"id"`
	Kind       string          `json:"kind"`
	EntryID    int64           `json:"entryId"`
	Written    *string         `json:"written"`
	EntryKind  *string         `json:"entryKind"`
	SentenceID *int64          `json:"sentenceId"`
	SkipKinds  []string        `json:"skipKinds"`
	DeckIDs    []string        `json:"deckIds"`
	CreatedAt  string          `json:"createdAt"`
	Extra      json.RawMessage `json:"extra"`
	Meta
}

// DeckSource is where a copied deck came from: one of two variants (the
// plugin variant went with the code plugins, #199).
type DeckSource struct {
	Type   string // level, frequency
	PackID string // level, frequency
	Level  string // level
	Size   int64  // frequency, > 0
}

// Deck is a `decks` row.
type Deck struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	CreatedAt string          `json:"createdAt"`
	Source    *DeckSource     `json:"source"`
	Extra     json.RawMessage `json:"extra"`
	Meta
}

// NewOrder is the order of new cards: added, frequency, or level with a pack.
type NewOrder struct {
	By     string
	PackID string
}

// DeckSettingsRow is a `deckSettings` row.
type DeckSettingsRow struct {
	DeckID    string          `json:"deckId"`
	CardTypes []string        `json:"cardTypes"`
	NewOrder  *NewOrder       `json:"newOrder"`
	Extra     json.RawMessage `json:"extra"`
	Meta
}

// LimitField is one set limit; a nil Limit is unlimited.
type LimitField struct {
	Limit *int `json:"limit"`
}

// LimitsRow is a `limits` row; a nil DeckID is the workspace row, a nil
// field is not set (it inherits).
type LimitsRow struct {
	DeckID  *string         `json:"deckId"`
	New     *LimitField     `json:"new"`
	Reviews *LimitField     `json:"reviews"`
	Extra   json.RawMessage `json:"extra"`
	Meta
}

// FsrsSet is a `fsrsSets` row.
type FsrsSet struct {
	ID              string          `json:"id"`
	W               []float64       `json:"w"`
	CreatedAt       string          `json:"createdAt"`
	Source          string          `json:"source"`
	Labelled        *float64        `json:"labelled"`
	LogLoss         *float64        `json:"logLoss"`
	BaselineLogLoss *float64        `json:"baselineLogLoss"`
	Extra           json.RawMessage `json:"extra"`
	Meta
}

// FsrsActiveRow is the `fsrsActive` row of a workspace.
type FsrsActiveRow struct {
	SetID     *string         `json:"setId"`
	ChangedAt *string         `json:"changedAt"`
	Extra     json.RawMessage `json:"extra"`
	Meta
}

func (r *Card) Family() Family            { return Cards }
func (r *Deck) Family() Family            { return Decks }
func (r *DeckSettingsRow) Family() Family { return DeckSettings }
func (r *LimitsRow) Family() Family       { return Limits }
func (r *FsrsSet) Family() Family         { return FsrsSets }
func (r *FsrsActiveRow) Family() Family   { return FsrsActive }

func (r *Card) Identity() string            { return r.ID }
func (r *Deck) Identity() string            { return r.ID }
func (r *DeckSettingsRow) Identity() string { return r.DeckID }
func (r *LimitsRow) Identity() string {
	if r.DeckID == nil {
		return ""
	}
	return *r.DeckID
}
func (r *FsrsSet) Identity() string       { return r.ID }
func (r *FsrsActiveRow) Identity() string { return "" }

func (r *Card) M() *Meta            { return &r.Meta }
func (r *Deck) M() *Meta            { return &r.Meta }
func (r *DeckSettingsRow) M() *Meta { return &r.Meta }
func (r *LimitsRow) M() *Meta       { return &r.Meta }
func (r *FsrsSet) M() *Meta         { return &r.Meta }
func (r *FsrsActiveRow) M() *Meta   { return &r.Meta }

// New returns an empty row of family f (nil for an unknown family).
func New(f Family) Row {
	switch f {
	case Cards:
		return &Card{}
	case Decks:
		return &Deck{}
	case DeckSettings:
		return &DeckSettingsRow{}
	case Limits:
		return &LimitsRow{}
	case FsrsSets:
		return &FsrsSet{}
	case FsrsActive:
		return &FsrsActiveRow{}
	}
	return nil
}

// ---- JSON encoding: every key always present, lists [] and extra {}.

func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func extraOrEmpty(e json.RawMessage) json.RawMessage {
	if len(bytes.TrimSpace(e)) == 0 {
		return json.RawMessage(`{}`)
	}
	return e
}

func (r Card) MarshalJSON() ([]byte, error) {
	type plain Card
	r.SkipKinds, r.DeckIDs, r.Extra = orEmpty(r.SkipKinds), orEmpty(r.DeckIDs), extraOrEmpty(r.Extra)
	return json.Marshal(plain(r))
}

func (r Deck) MarshalJSON() ([]byte, error) {
	type plain Deck
	r.Extra = extraOrEmpty(r.Extra)
	return json.Marshal(plain(r))
}

func (r DeckSettingsRow) MarshalJSON() ([]byte, error) {
	type plain DeckSettingsRow
	r.CardTypes, r.Extra = orEmpty(r.CardTypes), extraOrEmpty(r.Extra)
	return json.Marshal(plain(r))
}

func (r LimitsRow) MarshalJSON() ([]byte, error) {
	type plain LimitsRow
	r.Extra = extraOrEmpty(r.Extra)
	return json.Marshal(plain(r))
}

func (r FsrsSet) MarshalJSON() ([]byte, error) {
	type plain FsrsSet
	r.W, r.Extra = orEmpty(r.W), extraOrEmpty(r.Extra)
	return json.Marshal(plain(r))
}

func (r FsrsActiveRow) MarshalJSON() ([]byte, error) {
	type plain FsrsActiveRow
	r.Extra = extraOrEmpty(r.Extra)
	return json.Marshal(plain(r))
}

func (s DeckSource) MarshalJSON() ([]byte, error) {
	switch s.Type {
	case "level":
		return json.Marshal(struct {
			Type   string `json:"type"`
			PackID string `json:"packId"`
			Level  string `json:"level"`
		}{s.Type, s.PackID, s.Level})
	case "frequency":
		return json.Marshal(struct {
			Type   string `json:"type"`
			PackID string `json:"packId"`
			Size   int64  `json:"size"`
		}{s.Type, s.PackID, s.Size})
	}
	return nil, fmt.Errorf("%w: source type %q", ErrInvalid, s.Type)
}

// UnmarshalJSON reads a source strictly: exactly the members of its variant.
func (s *DeckSource) UnmarshalJSON(raw []byte) error {
	m, err := strictObject(raw)
	if err != nil {
		return err
	}
	var typ string
	if err := json.Unmarshal(m["type"], &typ); err != nil {
		return errors.New("source type")
	}
	want := map[string][]string{"level": {"type", "packId", "level"}, "frequency": {"type", "packId", "size"}}[typ]
	if want == nil || !sameKeys(m, want) {
		return errors.New("source members")
	}
	out := DeckSource{Type: typ}
	switch typ {
	case "level":
		err = errors.Join(json.Unmarshal(m["packId"], &out.PackID), json.Unmarshal(m["level"], &out.Level))
	case "frequency":
		err = errors.Join(json.Unmarshal(m["packId"], &out.PackID), json.Unmarshal(m["size"], &out.Size))
		if err == nil && out.Size <= 0 {
			err = errors.New("source size")
		}
	}
	if err != nil || isNull(m["packId"]) || isNull(m["level"]) {
		return errors.New("source member types")
	}
	*s = out
	return nil
}

func (o NewOrder) MarshalJSON() ([]byte, error) {
	if o.By == "level" {
		return json.Marshal(map[string]string{"by": o.By, "packId": o.PackID})
	}
	return json.Marshal(map[string]string{"by": o.By})
}

// UnmarshalJSON reads an order strictly.
func (o *NewOrder) UnmarshalJSON(raw []byte) error {
	m, err := strictObject(raw)
	if err != nil {
		return err
	}
	var by, pack string
	if json.Unmarshal(m["by"], &by) != nil {
		return errors.New("order by")
	}
	switch by {
	case "added", "frequency":
		if !sameKeys(m, []string{"by"}) {
			return errors.New("order members")
		}
	case "level":
		if !sameKeys(m, []string{"by", "packId"}) || json.Unmarshal(m["packId"], &pack) != nil || pack == "" {
			return errors.New("order packId")
		}
	default:
		return errors.New("order by")
	}
	*o = NewOrder{By: by, PackID: pack}
	return nil
}

// UnmarshalJSON reads {"limit": n | null} strictly.
func (l *LimitField) UnmarshalJSON(raw []byte) error {
	m, err := strictObject(raw)
	if err != nil {
		return err
	}
	if !sameKeys(m, []string{"limit"}) {
		return errors.New("limit members")
	}
	var n *int
	if err := json.Unmarshal(m["limit"], &n); err != nil {
		return errors.New("limit value")
	}
	l.Limit = n
	return nil
}

func strictObject(raw []byte) (map[string]json.RawMessage, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return nil, errors.New("not an object")
	}
	return m, nil
}

func sameKeys(m map[string]json.RawMessage, keys []string) bool {
	if len(m) != len(keys) {
		return false
	}
	for _, k := range keys {
		if _, ok := m[k]; !ok {
			return false
		}
	}
	return true
}

func isNull(raw json.RawMessage) bool { return string(bytes.TrimSpace(raw)) == "null" }

// ---- strict wire decode

// bodyKeys are the typed members of each family; nullable ones may be null.
var bodyKeys = map[Family]struct{ all, nullable []string }{
	Cards:        {[]string{"id", "kind", "entryId", "written", "entryKind", "sentenceId", "skipKinds", "deckIds", "createdAt", "extra"}, []string{"written", "entryKind", "sentenceId"}},
	Decks:        {[]string{"id", "name", "createdAt", "source", "extra"}, []string{"source"}},
	DeckSettings: {[]string{"deckId", "cardTypes", "newOrder", "extra"}, []string{"newOrder"}},
	Limits:       {[]string{"deckId", "new", "reviews", "extra"}, []string{"deckId", "new", "reviews"}},
	FsrsSets:     {[]string{"id", "w", "createdAt", "source", "labelled", "logLoss", "baselineLogLoss", "extra"}, []string{"labelled", "logLoss", "baselineLogLoss"}},
	FsrsActive:   {[]string{"setId", "changedAt", "extra"}, []string{"setId", "changedAt"}},
}

// Decode reads one wire row of family f strictly: every typed key and
// workspaceId and updatedAt present (version and deletedAt may be left
// out), no unknown member, every value of its type; then Validate.
func Decode(f Family, raw json.RawMessage) (Row, error) {
	keys, ok := bodyKeys[f]
	if !ok {
		return nil, fmt.Errorf("%w: unknown collection %q", ErrInvalid, f)
	}
	m, err := strictObject(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: %s row is not an object", ErrInvalid, f)
	}
	for _, k := range append(append([]string{}, keys.all...), "workspaceId", "updatedAt") {
		v, present := m[k]
		if !present {
			return nil, fmt.Errorf("%w: %s row lacks %s", ErrInvalid, f, k)
		}
		if isNull(v) && !slices.Contains(keys.nullable, k) {
			return nil, fmt.Errorf("%w: %s row: %s is null", ErrInvalid, f, k)
		}
	}
	for k := range m {
		if !slices.Contains(keys.all, k) && !slices.Contains([]string{"workspaceId", "version", "updatedAt", "deletedAt"}, k) {
			return nil, fmt.Errorf("%w: %s row: unknown member %s", ErrInvalid, f, k)
		}
	}
	r := New(f)
	// Decode member by member so the error names the member.
	target := reflect.ValueOf(r).Elem()
	for k, v := range m {
		field := fieldByTag(target, k)
		if !field.IsValid() {
			continue
		}
		if err := json.Unmarshal(v, field.Addr().Interface()); err != nil {
			return nil, fmt.Errorf("%w: %s row: %s: %v", ErrInvalid, f, k, err)
		}
	}
	// The zero time is no edit time (a keyed-row push refuses it too): a
	// client that forgot to stamp the item must not win or lose by accident.
	if r.M().UpdatedAt.IsZero() {
		return nil, fmt.Errorf("%w: %s row: updatedAt is the zero time", ErrInvalid, f)
	}
	if err := Validate(r); err != nil {
		return nil, err
	}
	return r, nil
}

// fieldByTag finds the struct field (or promoted Meta field) of a json tag.
func fieldByTag(v reflect.Value, tag string) reflect.Value {
	t := v.Type()
	for i := 0; i < t.NumField(); i++ {
		sf := t.Field(i)
		if sf.Anonymous {
			if f := fieldByTag(v.Field(i), tag); f.IsValid() {
				return f
			}
			continue
		}
		name, _, _ := cutComma(sf.Tag.Get("json"))
		if name == tag {
			return v.Field(i)
		}
	}
	return reflect.Value{}
}

func cutComma(s string) (string, string, bool) {
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			return s[:i], s[i+1:], true
		}
	}
	return s, "", false
}

// ---- validation

func invalid(f Family, member, why string) error {
	return fmt.Errorf("%w: %s row: %s %s", ErrInvalid, f, member, why)
}

// Validate checks the semantic rules of a row and drops the extra members a
// set typed member shadows (contract: the typed member always wins). It
// normalises the order of kind lists to kind order.
func Validate(r Row) error {
	m := r.M()
	f := r.Family()
	if m.WorkspaceID < 1 {
		return invalid(f, "workspaceId", "must be a workspace id")
	}
	var shadow []string
	var extra *json.RawMessage
	switch x := r.(type) {
	case *Card:
		extra = &x.Extra
		if !slices.Contains(CardKinds, x.Kind) {
			return invalid(f, "kind", "is not a card kind")
		}
		if x.EntryID < 1 || x.EntryID > MaxEntryID {
			return invalid(f, "entryId", "must be an integer in 1..2^53-1")
		}
		if x.SentenceID != nil && (*x.SentenceID < 1 || *x.SentenceID > MaxEntryID) {
			return invalid(f, "sentenceId", "must be an integer in 1..2^53-1")
		}
		if x.EntryKind != nil && *x.EntryKind != "character" {
			return invalid(f, "entryKind", `must be null or "character"`)
		}
		if len(x.SkipKinds) > 0 && x.Kind != "vocab" {
			return invalid(f, "skipKinds", "is only for vocab cards")
		}
		clean, ok := inKindOrder(x.SkipKinds, CardKinds[1:])
		if !ok {
			return invalid(f, "skipKinds", "must hold distinct non-vocab kinds")
		}
		x.SkipKinds = clean
		if hasDup(x.DeckIDs) {
			return invalid(f, "deckIds", "has a duplicate")
		}
		x.SkipKinds, x.DeckIDs = orEmpty(x.SkipKinds), orEmpty(x.DeckIDs)
		shadow = []string{"id", "kind", "entryId", "deckIds", "createdAt"}
		shadow = appendIf(shadow, x.Written != nil, "written")
		shadow = appendIf(shadow, x.EntryKind != nil, "entryKind")
		shadow = appendIf(shadow, x.SentenceID != nil, "sentenceId")
		shadow = appendIf(shadow, len(x.SkipKinds) > 0, "skipKinds")
	case *Deck:
		extra = &x.Extra
		if x.Source != nil {
			if _, err := x.Source.MarshalJSON(); err != nil || (x.Source.Type == "frequency" && x.Source.Size <= 0) {
				return invalid(f, "source", "is not a deck source")
			}
		}
		shadow = appendIf([]string{"id", "name", "createdAt"}, x.Source != nil, "source")
	case *DeckSettingsRow:
		extra = &x.Extra
		if x.DeckID == "" {
			return invalid(f, "deckId", "must not be empty")
		}
		clean, ok := inKindOrder(x.CardTypes, OptInKinds)
		if !ok {
			return invalid(f, "cardTypes", "must hold distinct opt-in kinds (reverse, cloze)")
		}
		x.CardTypes = orEmpty(clean)
		if x.NewOrder != nil {
			o := x.NewOrder
			if !(o.By == "added" || o.By == "frequency" || (o.By == "level" && o.PackID != "")) {
				return invalid(f, "newOrder", "is not an order")
			}
		}
		shadow = appendIf([]string{"deckId", "cardTypes", "updatedAt"}, x.NewOrder != nil, "newOrder")
	case *LimitsRow:
		extra = &x.Extra
		if x.DeckID != nil && *x.DeckID == "" {
			return invalid(f, "deckId", "must be null (workspace) or a deck id")
		}
		for name, lf := range map[string]*LimitField{"new": x.New, "reviews": x.Reviews} {
			if lf != nil && lf.Limit != nil && (*lf.Limit < 0 || *lf.Limit > MaxLimit) {
				return invalid(f, name, "must be 0..9999 or null")
			}
		}
		shadow = appendIf(appendIf([]string{"version"}, x.New != nil, "new"), x.Reviews != nil, "reviews")
	case *FsrsSet:
		extra = &x.Extra
		if len(x.W) != 21 {
			return invalid(f, "w", "must hold 21 numbers")
		}
		if x.Source != "optimized" && x.Source != "imported" {
			return invalid(f, "source", `must be "optimized" or "imported"`)
		}
		shadow = []string{"id", "w", "createdAt", "source"}
		shadow = appendIf(shadow, x.Labelled != nil, "labelled")
		shadow = appendIf(shadow, x.LogLoss != nil, "logLoss")
		shadow = appendIf(shadow, x.BaselineLogLoss != nil, "baselineLogLoss")
	case *FsrsActiveRow:
		extra = &x.Extra
		shadow = appendIf(appendIf(nil, x.SetID != nil, "setId"), x.ChangedAt != nil, "changedAt")
	default:
		return fmt.Errorf("%w: unknown row type %T", ErrInvalid, r)
	}
	cleaned, err := dropMembers(*extra, shadow)
	if err != nil {
		return invalid(f, "extra", "must be a JSON object")
	}
	*extra = cleaned
	return nil
}

func appendIf(list []string, cond bool, name string) []string {
	if cond {
		return append(list, name)
	}
	return list
}

func hasDup(list []string) bool {
	seen := map[string]bool{}
	for _, s := range list {
		if seen[s] {
			return true
		}
		seen[s] = true
	}
	return false
}

// inKindOrder returns list in the order of allowed; false when list holds a
// duplicate or a value outside allowed.
func inKindOrder(list, allowed []string) ([]string, bool) {
	if hasDup(list) {
		return nil, false
	}
	out := []string{}
	for _, k := range allowed {
		if slices.Contains(list, k) {
			out = append(out, k)
		}
	}
	return out, len(out) == len(list)
}

// dropMembers returns extra (which must be a JSON object; empty means {})
// without the named members, compacted. Values stay verbatim.
func dropMembers(extra json.RawMessage, names []string) (json.RawMessage, error) {
	if len(bytes.TrimSpace(extra)) == 0 {
		return json.RawMessage(`{}`), nil
	}
	m, err := strictObject(extra)
	if err != nil {
		return nil, err
	}
	changed := false
	for _, n := range names {
		if _, ok := m[n]; ok {
			delete(m, n)
			changed = true
		}
	}
	if !changed {
		var buf bytes.Buffer
		if err := json.Compact(&buf, extra); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	}
	return json.Marshal(m)
}

// ---- equality

// Equal reports whether two rows have the same family, identity, typed
// members and extra (as JSON values); meta is not compared.
func Equal(a, b Row) bool {
	if a.Family() != b.Family() || a.Identity() != b.Identity() {
		return false
	}
	va, err1 := bodyValue(a)
	vb, err2 := bodyValue(b)
	return err1 == nil && err2 == nil && reflect.DeepEqual(va, vb)
}

func bodyValue(r Row) (any, error) {
	raw, err := json.Marshal(r)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil {
		return nil, err
	}
	for _, k := range []string{"workspaceId", "version", "updatedAt", "deletedAt"} {
		delete(m, k)
	}
	return m, nil
}
