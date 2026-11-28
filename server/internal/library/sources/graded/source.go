package graded

import (
	"context"
	"strings"

	"qinqin/internal/library"
	"qinqin/internal/library/sources"
)

// SourceID is the library source id of the graded readers (a book's source).
const SourceID = "graded"

// Source serves the graded readers as a library source: Search by title, Describe and Fetch by text id. It has no
// browse assortment: the Sources page lists the whole catalogue (Catalogue) instead.
type Source struct{}

var (
	_ sources.Source    = Source{}
	_ sources.Describer = Source{}
)

// ID is "graded".
func (Source) ID() string { return SourceID }

// find returns the text with id and its file.
func find(id string) (File, Text, bool) {
	files, err := Files()
	if err != nil {
		return File{}, Text{}, false
	}
	for _, f := range files {
		for _, t := range f.Texts {
			if t.ID == id {
				return f, t, true
			}
		}
	}
	return File{}, Text{}, false
}

func result(f File, t Text) sources.Result {
	return sources.Result{SourceID: t.ID, Title: t.Title, Author: Author, Language: f.Language, Note: f.Levels[t.Level] + " · " + t.Kind}
}

// Author is the author of every graded reader book.
const Author = "qinqin"

// Search returns the texts whose title contains q (at most limit); an empty query finds nothing.
func (Source) Search(_ context.Context, q string, limit int) ([]sources.Result, error) {
	q = strings.TrimSpace(q)
	out := []sources.Result{}
	if q == "" {
		return out, nil
	}
	files, err := Files()
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		for _, t := range f.Texts {
			if len(out) >= limit {
				return out, nil
			}
			if strings.Contains(t.Title, q) || strings.Contains(Body(t.Paragraphs), q) {
				out = append(out, result(f, t))
			}
		}
	}
	return out, nil
}

// Describe returns a text's catalogue line; an unknown id is sources.ErrNotFound.
func (Source) Describe(_ context.Context, id string) (sources.Result, error) {
	f, t, ok := find(id)
	if !ok {
		return sources.Result{}, sources.ErrNotFound
	}
	return result(f, t), nil
}

// Fetch returns a text as a one-chapter book (docs/contracts/graded/README.md, Catalogue); an unknown id is
// sources.ErrNotFound.
func (Source) Fetch(_ context.Context, id string) (sources.Imported, error) {
	f, t, ok := find(id)
	if !ok {
		return sources.Imported{}, sources.ErrNotFound
	}
	paragraphs := make([]library.Paragraph, len(t.Paragraphs))
	for i, p := range t.Paragraphs {
		paragraphs[i] = library.Paragraph{{Text: p}}
	}
	return sources.Imported{
		Meta: library.Book{
			Language: f.Language, Title: t.Title, Author: Author, Source: SourceID, SourceID: t.ID,
			Attribution: "qinqin graded readers, " + f.Levels[t.Level] +
				": written for qinqin and reviewed by agents acting as teachers, not yet by a person.",
			LicenseNote: "CC BY 4.0, qinqin contributors",
		},
		Chapters: []library.Chapter{{Title: t.Title, Paragraphs: paragraphs}},
	}, nil
}

// Entry is one text of the catalogue (GET /api/library/graded): everything but the paragraphs.
type Entry struct {
	ID            string   `json:"id"`
	Language      string   `json:"language"`
	Scheme        string   `json:"scheme"`
	Level         int      `json:"level"`
	LevelName     string   `json:"levelName"`
	Levels        int      `json:"levels"`
	Kind          string   `json:"kind"`
	Title         string   `json:"title"`
	Length        int      `json:"length"`
	Names         []string `json:"names"`
	Glosses       []Gloss  `json:"glosses"`
	HumanReviewed bool     `json:"humanReviewed"`
}

// Catalogue lists the texts of language ("" for every language) in file order; never nil.
func Catalogue(language string) []Entry {
	out := []Entry{}
	files, err := Files()
	if err != nil {
		return out
	}
	for _, f := range files {
		if language != "" && f.Language != language {
			continue
		}
		for _, t := range f.Texts {
			out = append(out, Entry{
				ID: t.ID, Language: f.Language, Scheme: f.Scheme, Level: t.Level, LevelName: f.Levels[t.Level],
				Levels: len(f.Levels), Kind: t.Kind, Title: t.Title, Length: Length(t), Names: t.Names,
				Glosses: t.Glosses, HumanReviewed: f.HumanReviewed,
			})
		}
	}
	return out
}

// Languages are the languages with texts, in file order.
func Languages() []string {
	files, _ := Files()
	out := make([]string, 0, len(files))
	for _, f := range files {
		out = append(out, f.Language)
	}
	return out
}
