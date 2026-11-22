package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func sha(body string) string {
	sum := sha256.Sum256([]byte(body))
	return hex.EncodeToString(sum[:])
}

const pinBody = `{
  "source": "https://downloads.example/exports/",
  "exportDate": "2000-01-02",
  "licence": {"checked": "2000-01-03", "statement": "stated licence"},
  "archives": [
    {"name": "sentences_detailed", "url": "https://downloads.example/exports/sentences_detailed.tar.bz2", "member": "sentences_detailed.csv", "sha256": "SUM"}
  ]
}`

func TestLoadPinRejectsIncompleteArchives(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{
		"no url":       strings.Replace(pinBody, `"url": "https://downloads.example/exports/sentences_detailed.tar.bz2", `, "", 1),
		"no name":      strings.Replace(pinBody, `"name": "sentences_detailed", `, "", 1),
		"no member":    strings.Replace(pinBody, `"member": "sentences_detailed.csv", `, "", 1),
		"http url":     strings.Replace(pinBody, "https://downloads.example/exports/sentences_detailed", "http://downloads.example/exports/sentences_detailed", 1),
		"unknown key":  strings.Replace(pinBody, `"source"`, `"surprise": 1, "source"`, 1),
		"no archives":  `{"source": "x", "licence": {}, "archives": []}`,
		"missing file": "",
	} {
		path := filepath.Join(dir, strings.ReplaceAll(name, " ", "-")+".json")
		if body != "" {
			writeFile(t, path, body)
		}
		if _, err := loadPin(path); err == nil {
			t.Errorf("%s: loadPin accepted it", name)
		}
	}
	path := filepath.Join(dir, "ok.json")
	writeFile(t, path, pinBody)
	p, err := loadPin(path)
	if err != nil {
		t.Fatalf("loadPin: %v", err)
	}
	if got := p.Archives[0].file(); got != "sentences_detailed.tar.bz2" {
		t.Errorf("file() = %q", got)
	}
}

func TestRequirePinnedRefusesAnUnpinnedRun(t *testing.T) {
	ok := Pin{ExportDate: "2000-01-02", Licence: Licence{Checked: "2000-01-03", Statement: "stated CC BY 2.0 FR"},
		Archives: []Archive{{Name: "a", URL: "https://x/a", Member: "a", SHA256: strings.Repeat("ab", 32)}}}
	if err := ok.requirePinned(); err != nil {
		t.Fatalf("pinned: %v", err)
	}
	cases := map[string]func(p *Pin){
		"no hash":         func(p *Pin) { p.Archives[0].SHA256 = "" },
		"bad hash":        func(p *Pin) { p.Archives[0].SHA256 = "abc" },
		"no licence date": func(p *Pin) { p.Licence.Checked = "" },
		"bad licence":     func(p *Pin) { p.Licence.Checked = "soon" },
		"no export date":  func(p *Pin) { p.ExportDate = "" },
		"no statement":    func(p *Pin) { p.Licence.Statement = " " },
		"placeholder":     func(p *Pin) { p.Licence.Statement = "To fill at pin time: what the pages say" },
	}
	for name, mutate := range cases {
		p := ok
		p.Archives = append([]Archive(nil), ok.Archives...)
		mutate(&p)
		err := p.requirePinned()
		if err == nil || !strings.Contains(err.Error(), "pin") {
			t.Errorf("%s: requirePinned = %v, want a refusal naming the pin step", name, err)
		}
	}
}

func TestVerifyArchive(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "a.tar.bz2"), "archive bytes")
	a := Archive{Name: "a", URL: "https://x/a.tar.bz2", Member: "a.csv", SHA256: sha("archive bytes")}
	if err := a.verify(dir); err != nil {
		t.Fatalf("verify match: %v", err)
	}
	a.SHA256 = sha("other bytes")
	if err := a.verify(dir); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Errorf("verify mismatch = %v, want a SHA-256 refusal", err)
	}
	if err := (Archive{Name: "b", URL: "https://x/b.tar.bz2", SHA256: a.SHA256}).verify(dir); err == nil {
		t.Error("verify of a missing file passed")
	}
}

func TestRecordPinFillsOnlyEmptyHashes(t *testing.T) {
	p := Pin{Licence: Licence{Statement: "To fill at pin time"}, Archives: []Archive{{Name: "a", URL: "https://x/a"}, {Name: "b", URL: "https://x/b"}}}
	sums := map[string]string{"a": sha("A"), "b": sha("B")}
	if err := p.record(sums, "2000-01-02", "2000-01-03", false); err == nil || !strings.Contains(err.Error(), "statement") {
		t.Fatalf("record with the placeholder statement = %v, want a refusal naming the statement", err)
	}
	p.Licence.Statement = "stated CC BY 2.0 FR"
	if err := p.record(sums, "2000-01-02", "2000-01-03", false); err != nil {
		t.Fatalf("record: %v", err)
	}
	if p.Archives[0].SHA256 != sha("A") || p.Archives[1].SHA256 != sha("B") || p.ExportDate != "2000-01-02" || p.Licence.Checked != "2000-01-03" {
		t.Errorf("record wrote %+v", p)
	}
	// Recording the same hashes again is fine; different ones need repin.
	if err := p.record(sums, "2000-01-02", "2000-01-04", false); err != nil {
		t.Errorf("same hashes: %v", err)
	}
	moved := map[string]string{"a": sha("A2"), "b": sha("B")}
	if err := p.record(moved, "2000-02-01", "2000-02-01", false); err == nil || !strings.Contains(err.Error(), "--repin") {
		t.Errorf("changed hash without repin = %v, want a refusal naming --repin", err)
	}
	if p.Archives[0].SHA256 != sha("A") {
		t.Error("a refused record changed the pin")
	}
	if err := p.record(moved, "2000-02-01", "2000-02-01", true); err != nil || p.Archives[0].SHA256 != sha("A2") {
		t.Errorf("repin: %v, %+v", err, p.Archives[0])
	}
	if err := p.record(sums, "2000-02-01", "not a date", true); err == nil {
		t.Error("record accepted a bad licence date")
	}
}

func TestSavePinIsStable(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "pin.json")
	writeFile(t, path, pinBody)
	p, err := loadPin(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.save(path); err != nil {
		t.Fatal(err)
	}
	first, _ := os.ReadFile(path)
	q, err := loadPin(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := q.save(path); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(path)
	if string(first) != string(second) || !strings.HasSuffix(string(first), "}\n") {
		t.Errorf("save is not stable:\n%s\n---\n%s", first, second)
	}
}

// TestShippedPinNamesTheExport: the committed pin names every archive the
// tool reads, over https from Tatoeba's export folder.
func TestShippedPinNamesTheExport(t *testing.T) {
	p, err := loadPin("pin.json")
	if err != nil {
		t.Fatalf("pin.json: %v", err)
	}
	want := []string{nameSentences, nameCC0, nameLinks, nameTags, nameUserLanguages, nameReviews}
	for _, name := range want {
		a, ok := p.archive(name)
		if !ok {
			t.Errorf("pin.json lacks %s", name)
			continue
		}
		if !strings.HasPrefix(a.URL, "https://downloads.tatoeba.org/exports/") {
			t.Errorf("%s url %q is not Tatoeba's export folder", name, a.URL)
		}
	}
}
