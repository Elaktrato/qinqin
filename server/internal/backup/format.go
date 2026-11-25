// Package backup writes and restores a user's personal data archive
// (format v2, docs/contracts/backup/) and the admin whole-server backup.
package backup

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// Format identity. FormatVersion is the only compatibility key: a reader
// accepts exactly the versions it knows and rejects the rest.
const (
	FormatName    = "qinqin-user-backup"
	FormatVersion = 2
)

// Caps, enforced on the bytes actually read (declared sizes are ignored).
const (
	MaxUpload        = 128 << 20 // the archive file itself
	MaxManifest      = 1 << 20
	MaxLine          = 1 << 20  // one JSONL line
	MaxJSONFile      = 64 << 20 // a book file or a JSON array file
	MaxTotal         = 2 << 30  // all entries uncompressed together
	MaxEntries       = 10000
	MaxRowValue      = 256 << 10 // like PUT /api/rows/{key}
	EventsPerFile    = 100000
	MaxEvents        = 2000000 // events per restore: a restore holds the write lock about 30 s per million
	maxBooksJSONSize = 8 << 20
)

// Entry names of the archive.
const (
	NameManifest     = "manifest.json"
	NameAccount      = "account.json"
	NameRefEntries   = "refs/entries.json"
	NameRefDicts     = "refs/dictionaries.json"
	NameRefSentences = "refs/sentences.json"
	NameWorkspaces   = "workspaces.json"
	NameBooks        = "library/books.json"
	// NameAvatar is the profile picture (#189): the 256 px JPEG, optional.
	NameAvatar = "account/avatar.jpg"
)

// The JSONL collections are "families": numbered parts <family>/NNNNNN.jsonl,
// each at most EventsPerFile lines and about partBytes bytes, so no single
// entry can outgrow the per-entry cap a reader enforces.
const (
	FamEvents      = "events"
	NameRows       = "rows"
	NameOverlays   = "overlays"
	NameSentences  = "sentences"
	NameBookmarks  = "library/bookmarks"
	NameHighlights = "library/highlights"
)

// Families lists every JSONL family.
var Families = []string{FamEvents, NameRows, NameOverlays, NameSentences, NameBookmarks, NameHighlights}

// Kinds of a known archive entry name.
const (
	KindFixed = "fixed" // one of the Name* constants
	KindPart  = "part"  // a numbered part of a JSONL family
	KindBook  = "book"
)

var (
	bookName   = regexp.MustCompile(`^library/books/(0|[1-9]\d{0,17})\.json$`)
	fixedNames = map[string]bool{
		NameManifest: true, NameAccount: true, NameRefEntries: true, NameRefDicts: true,
		NameRefSentences: true, NameWorkspaces: true, NameBooks: true, NameAvatar: true,
	}
	partName = regexp.MustCompile(`^(events|rows|overlays|sentences|library/bookmarks|library/highlights)/\d{6}\.jsonl$`)
)

// KnownName classifies an archive entry name. Only the names of format v1
// are known; anything else (paths, "..", absolute names, wrong widths)
// is not, and no name is ever joined into a filesystem path.
func KnownName(name string) (kind string, bookID int64, ok bool) {
	switch {
	case fixedNames[name]:
		return KindFixed, 0, true
	case partName.MatchString(name):
		return KindPart, 0, true
	}
	if m := bookName.FindStringSubmatch(name); m != nil {
		id, err := strconv.ParseInt(m[1], 10, 64)
		if err != nil {
			return "", 0, false
		}
		return KindBook, id, true
	}
	return "", 0, false
}

// PartName is the entry name of the n-th (1-based) part of a family.
func PartName(family string, n int) string { return family + "/" + pad6(n) + ".jsonl" }

// EventsName is the entry name of the n-th (1-based) events file.
func EventsName(n int) string { return PartName(FamEvents, n) }

// FamilyOf returns the family of a part name.
func FamilyOf(name string) string {
	i := strings.LastIndex(name, "/")
	if i < 0 {
		return ""
	}
	return name[:i]
}

// BookName is the entry name of a book's content.
func BookName(id int64) string { return "library/books/" + strconv.FormatInt(id, 10) + ".json" }

func pad6(n int) string {
	s := strconv.Itoa(n)
	for len(s) < 6 {
		s = "0" + s
	}
	return s
}

// FileEntry is one archive entry listed in the manifest.
type FileEntry struct {
	Name   string `json:"name"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

// ManifestUser names the account the archive came from.
type ManifestUser struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

// Manifest is manifest.json, the last entry of an archive.
type Manifest struct {
	Format        string         `json:"format"`
	FormatVersion int            `json:"formatVersion"`
	AppVersion    string         `json:"appVersion"`
	SchemaVersion string         `json:"schemaVersion"`
	CreatedAt     string         `json:"createdAt"`
	User          ManifestUser   `json:"user"`
	Counts        map[string]int `json:"counts"`
	Files         []FileEntry    `json:"files"`
}

// TimeZone is one step of the learner's time zone history.
type TimeZone struct {
	Zone      string  `json:"zone"`
	From      *string `json:"from"`
	CreatedAt string  `json:"createdAt"`
}

// FeatureSwitch is the user's switch of one core feature (features/).
type FeatureSwitch struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

// Account is account.json: no identity, only the user's own settings.
type Account struct {
	Username  string          `json:"username"`
	TimeZones []TimeZone      `json:"timeZones"`
	Features  []FeatureSwitch `json:"features"`
	// InterfaceLanguage is the stored interface language ('' = follow the
	// browser; docs/contracts/i18n/). Optional: an archive without it (every
	// v1 archive before #73) leaves the setting unchanged on restore, and an
	// invalid tag is ignored.
	InterfaceLanguage *string `json:"interfaceLanguage,omitempty"`
}

// EntryRef identifies a dictionary entry portably: (language, kind,
// extKey), with the first written form as a fallback.
type EntryRef struct {
	ID       int64  `json:"id"`
	Language string `json:"language"`
	Kind     string `json:"kind"`
	ExtKey   string `json:"extKey"`
	Written  string `json:"written"`
}

// DictRef identifies an installed dictionary by its pack id.
type DictRef struct {
	ID     int64  `json:"id"`
	PackID string `json:"packId"`
}

// SentenceRef is a sentence a card points at.
type SentenceRef struct {
	ID         int64  `json:"id"`
	EntryID    int64  `json:"entryId"`
	Own        bool   `json:"own"`
	SourcePack string `json:"sourcePack"`
	Hanzi      string `json:"hanzi"`
}

// Workspace is one workspace row.
type Workspace struct {
	ID        int64           `json:"id"`
	Language  string          `json:"language"`
	Name      string          `json:"name"`
	Settings  json.RawMessage `json:"settings"`
	UpdatedAt string          `json:"updatedAt"`
}

// Event is one study event.
type Event struct {
	ID          string          `json:"id"`
	WorkspaceID int64           `json:"workspaceId"`
	Device      string          `json:"device"`
	TS          string          `json:"ts"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload"`
	UpdatedAt   string          `json:"updatedAt"`
}

// Row is a live keyed row of the archive (a keyed settings row, or a typed
// row in its keyed form); WorkspaceID nil is a user-global row.
type Row struct {
	WorkspaceID *int64          `json:"workspaceId"`
	Key         string          `json:"key"`
	Data        json.RawMessage `json:"data"`
	Version     int64           `json:"version"`
	UpdatedAt   string          `json:"updatedAt"`
	ModifiedAt  *string         `json:"modifiedAt"`
}

// Overlay is a user edit of an entry.
type Overlay struct {
	EntryID   int64   `json:"entryId"`
	Written   *string `json:"written"`
	Readings  *string `json:"readings"`
	UpdatedAt string  `json:"updatedAt"`
}

// OwnSentence is a sentence the user added, or a kept AI example (#186)
// with its mark.
type OwnSentence struct {
	ID          int64       `json:"id"`
	EntryID     int64       `json:"entryId"`
	Hanzi       string      `json:"hanzi"`
	Pinyin      string      `json:"pinyin"`
	Translation string      `json:"translation"`
	UpdatedAt   string      `json:"updatedAt"`
	AI          *SentenceAI `json:"ai,omitempty"`
}

// SentenceAI is the mark of a kept AI example: the provider id and the
// model that wrote it (both required; at most 64 and 200 bytes) and the
// level it was written for (one of ai.Levels).
type SentenceAI struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Level    string `json:"level"`
}

// Book is a library book's metadata; its chapters are library/books/<id>.json.
type Book struct {
	ID           int64  `json:"id"`
	WorkspaceID  int64  `json:"workspaceId"`
	Language     string `json:"language"`
	Title        string `json:"title"`
	Author       string `json:"author"`
	Source       string `json:"source"`
	SourceID     string `json:"sourceId"`
	SourceURL    string `json:"sourceUrl"`
	Attribution  string `json:"attribution"`
	LicenseNote  string `json:"licenseNote"`
	ChapterCount int    `json:"chapterCount"`
	Position     string `json:"position"`
	CreatedAt    string `json:"createdAt"`
}

// Bookmark is a library bookmark.
type Bookmark struct {
	ID        int64  `json:"id"`
	BookID    int64  `json:"bookId"`
	Position  string `json:"position"`
	Label     string `json:"label"`
	CreatedAt string `json:"createdAt"`
}

// Highlight is a library highlight.
type Highlight struct {
	ID        int64  `json:"id"`
	BookID    int64  `json:"bookId"`
	Chapter   int    `json:"chapter"`
	Paragraph int    `json:"paragraph"`
	StartCP   int    `json:"startCp"`
	EndCP     int    `json:"endCp"`
	Text      string `json:"text"`
	Color     string `json:"color"`
	Note      string `json:"note"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// AppVersion is written to manifests; informational only.
const AppVersion = "0.3.0"

var derivedCardID = regexp.MustCompile(`^c-(vocab|sentence|writing|tone|reverse|cloze)-(\d{1,18})$`)

// ParseDerivedCardID splits a card id of the form c-<kind>-<entryId>.
func ParseDerivedCardID(id string) (kind string, entryID int64, ok bool) {
	m := derivedCardID.FindStringSubmatch(id)
	if m == nil {
		return "", 0, false
	}
	n, err := strconv.ParseInt(m[2], 10, 64)
	if err != nil {
		return "", 0, false
	}
	return m[1], n, true
}
