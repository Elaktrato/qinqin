package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// The archive names the tool reads (Archive.Name in pin.json).
const (
	nameSentences     = "sentences_detailed"
	nameCC0           = "sentences_CC0"
	nameLinks         = "links"
	nameTags          = "tags"
	nameUserLanguages = "user_languages"
	nameReviews       = "users_sentences"
)

// Pin is pin.json: which Tatoeba export the packs are made from. Only the
// pin command writes the hashes and dates; build refuses to run until
// they are all recorded, so an unpinned build is impossible.
type Pin struct {
	Source     string    `json:"source"`
	ExportDate string    `json:"exportDate"`
	Licence    Licence   `json:"licence"`
	Archives   []Archive `json:"archives"`
}

// Licence records the owner's licence check: the date the downloads page
// and the terms of use were re-read, and what they stated.
type Licence struct {
	Checked   string `json:"checked"`
	Statement string `json:"statement"`
}

// Archive is one downloaded export file: its URL, the member read from
// it (for a .tar.bz2) and the SHA-256 of the downloaded file.
type Archive struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	Member string `json:"member"`
	SHA256 string `json:"sha256"`
}

var (
	isoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	hexSum  = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

func validDate(s string) bool {
	if !isoDate.MatchString(s) {
		return false
	}
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

// loadPin reads and checks pin.json strictly: every archive needs a name,
// an https URL and a member.
func loadPin(file string) (Pin, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return Pin{}, fmt.Errorf("pin: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var p Pin
	if err := dec.Decode(&p); err != nil {
		return Pin{}, fmt.Errorf("pin %s: %w", file, err)
	}
	if len(p.Archives) == 0 {
		return Pin{}, fmt.Errorf("pin %s: no archives", file)
	}
	seen := map[string]bool{}
	for i, a := range p.Archives {
		switch {
		case a.Name == "":
			return Pin{}, fmt.Errorf("pin %s: archive %d has no name", file, i)
		case seen[a.Name]:
			return Pin{}, fmt.Errorf("pin %s: archive %s listed twice", file, a.Name)
		case !strings.HasPrefix(a.URL, "https://"):
			return Pin{}, fmt.Errorf("pin %s: archive %s needs an https url", file, a.Name)
		case a.Member == "":
			return Pin{}, fmt.Errorf("pin %s: archive %s names no member file", file, a.Name)
		}
		seen[a.Name] = true
	}
	return p, nil
}

// save writes the pin as indented JSON with a final newline.
func (p Pin) save(file string) error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(p); err != nil {
		return err
	}
	return os.WriteFile(file, buf.Bytes(), 0o644)
}

func (p Pin) archive(name string) (Archive, bool) {
	for _, a := range p.Archives {
		if a.Name == name {
			return a, true
		}
	}
	return Archive{}, false
}

// errUnpinned tells the owner to run the pin step.
var errUnpinned = errors.New("the export is not pinned: run `go run ./tools/tatoeba pin --licence-checked YYYY-MM-DD` first, after re-reading Tatoeba's downloads page and terms of use")

// requirePinned refuses a pin without every hash, the export date and the
// licence check date.
func (p Pin) requirePinned() error {
	if !validDate(p.Licence.Checked) {
		return fmt.Errorf("%w (licence.checked is %q)", errUnpinned, p.Licence.Checked)
	}
	if !validDate(p.ExportDate) {
		return fmt.Errorf("%w (exportDate is %q)", errUnpinned, p.ExportDate)
	}
	for _, a := range p.Archives {
		if !hexSum.MatchString(a.SHA256) {
			return fmt.Errorf("%w (archive %s has no SHA-256)", errUnpinned, a.Name)
		}
	}
	return nil
}

// record stores the hashes and dates the pin command measured. A recorded
// hash that differs is a new export: it is replaced only with repin.
func (p *Pin) record(sums map[string]string, exportDate, licenceChecked string, repin bool) error {
	if !validDate(licenceChecked) {
		return fmt.Errorf("pin: --licence-checked %q is not a YYYY-MM-DD date", licenceChecked)
	}
	if !validDate(exportDate) {
		return fmt.Errorf("pin: export date %q is not a YYYY-MM-DD date", exportDate)
	}
	for _, a := range p.Archives {
		sum, ok := sums[a.Name]
		if !ok || !hexSum.MatchString(sum) {
			return fmt.Errorf("pin: no SHA-256 measured for %s", a.Name)
		}
		if a.SHA256 != "" && a.SHA256 != sum && !repin {
			return fmt.Errorf("pin: %s changed upstream (pinned %s, downloaded %s); this is a new export: pass --repin to pin it", a.Name, a.SHA256, sum)
		}
	}
	for i, a := range p.Archives {
		p.Archives[i].SHA256 = sums[a.Name]
	}
	p.ExportDate = exportDate
	p.Licence.Checked = licenceChecked
	return nil
}

// file is the archive's local file name: the last element of its URL.
func (a Archive) file() string {
	return path.Base(a.URL)
}

// sumFile returns the SHA-256 of a file as lowercase hex.
func sumFile(file string) (string, error) {
	f, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// verify checks the archive's local copy in dir against its pinned hash.
func (a Archive) verify(dir string) error {
	file := filepath.Join(dir, a.file())
	sum, err := sumFile(file)
	if err != nil {
		return fmt.Errorf("verify %s: %w", a.Name, err)
	}
	if sum != a.SHA256 {
		return fmt.Errorf("verify %s: SHA-256 of %s is %s, pinned %s; the file is not the pinned export (delete it to download again, or re-pin a new export)", a.Name, file, sum, a.SHA256)
	}
	return nil
}
