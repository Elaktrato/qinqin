package main

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// The licences the tool accepts, as written into the packs.
const (
	licenceBY  = "CC BY 2.0 FR"
	licenceCC0 = "CC0 1.0"
)

// sentence is one Tatoeba sentence the tool keeps in memory: one in a
// pack language, or a translation linked from one.
type sentence struct {
	ID      int64
	Lang    string
	Text    string
	Owner   string // empty: an orphan
	Licence string
}

// export is the part of a Tatoeba export the packs need.
type export struct {
	sentences map[int64]*sentence
	links     map[int64][]int64 // pack-language sentence → linked ids, ascending
	tags      map[int64][]string
	skills    map[string]string // lang + "\x00" + username → skill level
	negative  map[int64]bool    // some user reviewed it -1
}

func (ex *export) skill(lang, user string) string { return ex.skills[lang+"\x00"+user] }

// loadExport reads the pinned archives in dir: the sentences of langs,
// their links to translations in transLang, those translations, and the
// tags, user languages and reviews of all of them. Every sentence comes
// from sentences_detailed, which Tatoeba states is CC BY 2.0 FR; one also
// listed in sentences_CC0 with the same language and text is CC0 1.0.
func loadExport(dir string, pin Pin, langs []string, transLang string) (*export, error) {
	want := map[string]bool{}
	for _, l := range langs {
		want[l] = true
	}
	ex := &export{
		sentences: map[int64]*sentence{},
		links:     map[int64][]int64{},
		tags:      map[int64][]string{},
		skills:    map[string]string{},
		negative:  map[int64]bool{},
	}
	read := func(name string, cols int, fn func([]string) error) error {
		a, ok := pin.archive(name)
		if !ok {
			return fmt.Errorf("pin names no %s archive", name)
		}
		rc, err := openMember(dir, a)
		if err != nil {
			return err
		}
		defer rc.Close()
		return readRows(rc, name, cols, fn)
	}
	sentenceRow := func(keep func(id int64, lang string) bool) func([]string) error {
		return func(c []string) error {
			id, err := parseID(c[0])
			if err != nil {
				return err
			}
			if keep(id, c[1]) {
				ex.sentences[id] = &sentence{ID: id, Lang: c[1], Text: c[2], Owner: c[3], Licence: licenceBY}
			}
			return nil
		}
	}

	// Pass 1: the pack languages' sentences.
	if err := read(nameSentences, 6, sentenceRow(func(_ int64, lang string) bool { return want[lang] })); err != nil {
		return nil, err
	}
	// Links from them to any sentence; the translation side is checked
	// for its language in pass 2.
	needed := map[int64]bool{}
	if err := read(nameLinks, 2, func(c []string) error {
		from, err := parseID(c[0])
		if err != nil {
			return err
		}
		to, err := parseID(c[1])
		if err != nil {
			return err
		}
		if s := ex.sentences[from]; s != nil && want[s.Lang] && ex.sentences[to] == nil {
			ex.links[from] = append(ex.links[from], to)
			needed[to] = true
		}
		return nil
	}); err != nil {
		return nil, err
	}
	for id := range ex.links {
		sort.Slice(ex.links[id], func(i, j int) bool { return ex.links[id][i] < ex.links[id][j] })
	}
	// Pass 2: the linked translations.
	if err := read(nameSentences, 6, sentenceRow(func(id int64, lang string) bool { return needed[id] && lang == transLang })); err != nil {
		return nil, err
	}
	if err := read(nameCC0, 4, func(c []string) error {
		id, err := parseID(c[0])
		if err != nil {
			return err
		}
		if s := ex.sentences[id]; s != nil && s.Lang == c[1] && s.Text == c[2] {
			s.Licence = licenceCC0
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if err := read(nameTags, 2, func(c []string) error {
		id, err := parseID(c[0])
		if err != nil {
			return err
		}
		if ex.sentences[id] != nil {
			ex.tags[id] = append(ex.tags[id], strings.ToLower(strings.TrimSpace(c[1])))
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if err := read(nameUserLanguages, 4, func(c []string) error {
		if c[2] != "" {
			ex.skills[c[0]+"\x00"+c[2]] = c[1]
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if err := read(nameReviews, 5, func(c []string) error {
		id, err := parseID(c[1])
		if err != nil {
			return err
		}
		if c[2] == "-1" && ex.sentences[id] != nil {
			ex.negative[id] = true
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return ex, nil
}

func parseID(s string) (int64, error) {
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("bad sentence id %q", s)
	}
	return id, nil
}
