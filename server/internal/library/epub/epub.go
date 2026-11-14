// Package epub reads an epub's text into library chapters. Nothing is
// ever written to disk and zip entry names are used only as lookup keys
// inside the archive, so a hostile archive cannot reach the filesystem;
// input sizes are bounded both by the declared headers and by the bytes
// actually read, and the extracted output is capped too.
package epub

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/url"
	"path"
	"strings"

	"golang.org/x/net/html"

	"qinqin/internal/library"
)

// ErrInvalid reports input that is not a readable epub or exceeds the
// archive or output limits.
var ErrInvalid = errors.New("epub: invalid epub")

// limits are the caps Parse enforces; tests lower them.
type limits struct {
	Entries    int   // zip entries
	Total      int64 // total uncompressed bytes read
	Entry      int64 // uncompressed bytes of one entry
	OPF        int64 // package document and container.xml
	Text       int   // total extracted text bytes
	Runs       int   // total runs
	Paragraphs int   // total paragraphs
	Chapters   int   // chapters that contain text
}

var lim = limits{
	Entries:    2000,
	Total:      200 << 20,
	Entry:      50 << 20,
	OPF:        5 << 20,
	Text:       32 << 20,
	Runs:       2_000_000,
	Paragraphs: 500_000,
	Chapters:   2000,
}

// Meta is the book metadata from the package document.
type Meta struct {
	Title, Author, Language string
}

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrInvalid}, args...)...)
}

type archive struct {
	files map[string]*zip.File
	total int64
}

// read returns the entry's content, bounded by max (and lim.Entry) and,
// with all earlier reads, by lim.Total of bytes actually read.
func (a *archive) read(name string, max int64) ([]byte, bool, error) {
	f, ok := a.files[name]
	if !ok {
		return nil, false, nil
	}
	if max > lim.Entry {
		max = lim.Entry
	}
	rc, err := f.Open()
	if err != nil {
		return nil, false, invalid("%v", err)
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, max+1))
	if err != nil {
		return nil, false, invalid("%v", err)
	}
	a.total += int64(len(data))
	if int64(len(data)) > max || a.total > lim.Total {
		return nil, false, invalid("archive too large")
	}
	return data, true, nil
}

type opfDoc struct {
	Title    []string `xml:"metadata>title"`
	Author   []string `xml:"metadata>creator"`
	Language []string `xml:"metadata>language"`
	Manifest []struct {
		ID        string `xml:"id,attr"`
		Href      string `xml:"href,attr"`
		MediaType string `xml:"media-type,attr"`
	} `xml:"manifest>item"`
	Spine []struct {
		IDRef string `xml:"idref,attr"`
	} `xml:"spine>itemref"`
}

func firstNonEmpty(ss []string) string {
	for _, s := range ss {
		if s = strings.TrimSpace(s); s != "" {
			return s
		}
	}
	return ""
}

// Parse reads an epub of the given size and returns its metadata and
// its spine items as chapters; spine items without text are skipped.
func Parse(r io.ReaderAt, size int64) (Meta, []library.Chapter, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return Meta{}, nil, invalid("%v", err)
	}
	if len(zr.File) > lim.Entries {
		return Meta{}, nil, invalid("too many entries")
	}
	a := &archive{files: make(map[string]*zip.File, len(zr.File))}
	var declared uint64
	for _, f := range zr.File {
		if f.UncompressedSize64 > uint64(lim.Entry) {
			return Meta{}, nil, invalid("entry too large")
		}
		declared += f.UncompressedSize64
		if declared > uint64(lim.Total) {
			return Meta{}, nil, invalid("archive too large")
		}
		a.files[f.Name] = f
	}

	opfPath, err := a.rootfile()
	if err != nil {
		return Meta{}, nil, err
	}
	data, ok, err := a.read(opfPath, lim.OPF)
	if err != nil {
		return Meta{}, nil, err
	}
	if !ok {
		return Meta{}, nil, invalid("package document missing")
	}
	var pkg opfDoc
	if err := xml.Unmarshal(data, &pkg); err != nil {
		return Meta{}, nil, invalid("package document: %v", err)
	}
	if len(pkg.Spine) == 0 {
		return Meta{}, nil, invalid("empty spine")
	}
	hrefs := make(map[string]string, len(pkg.Manifest))
	for _, it := range pkg.Manifest {
		if it.MediaType == "application/xhtml+xml" || it.MediaType == "text/html" {
			hrefs[it.ID] = it.Href
		}
	}

	meta := Meta{
		Title:    firstNonEmpty(pkg.Title),
		Author:   firstNonEmpty(pkg.Author),
		Language: firstNonEmpty(pkg.Language),
	}
	var (
		chapters []library.Chapter
		seen     = map[string]bool{}
		b        = &budget{text: lim.Text, runs: lim.Runs, paras: lim.Paragraphs}
	)
	for _, ref := range pkg.Spine {
		href, ok := hrefs[ref.IDRef]
		if !ok || seen[ref.IDRef] {
			continue
		}
		seen[ref.IDRef] = true
		name := resolve(opfPath, href)
		content, ok, err := a.read(name, lim.Entry)
		if err != nil {
			return Meta{}, nil, err
		}
		if !ok {
			continue
		}
		title, paras, err := extract(content, b)
		if err != nil {
			return Meta{}, nil, err
		}
		if len(paras) == 0 {
			continue
		}
		if len(chapters) >= lim.Chapters {
			return Meta{}, nil, invalid("too many chapters")
		}
		// A chapter without a heading keeps an empty title; the reader
		// shows "Chapter n" for it.
		chapters = append(chapters, library.Chapter{Title: title, Paragraphs: paras})
	}
	if len(chapters) == 0 {
		return Meta{}, nil, invalid("no readable text")
	}
	return meta, chapters, nil
}

// rootfile returns the in-archive path of the package document.
func (a *archive) rootfile() (string, error) {
	data, ok, err := a.read("META-INF/container.xml", lim.OPF)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", invalid("container.xml missing")
	}
	var c struct {
		Rootfiles []struct {
			FullPath string `xml:"full-path,attr"`
		} `xml:"rootfiles>rootfile"`
	}
	if err := xml.Unmarshal(data, &c); err != nil || len(c.Rootfiles) == 0 || c.Rootfiles[0].FullPath == "" {
		return "", invalid("container.xml")
	}
	return strings.TrimPrefix(path.Clean("/"+c.Rootfiles[0].FullPath), "/"), nil
}

// resolve turns a manifest href into an archive entry name relative to
// the package document, staying inside the archive's namespace.
func resolve(opfPath, href string) string {
	if i := strings.IndexByte(href, '#'); i >= 0 {
		href = href[:i]
	}
	if u, err := url.PathUnescape(href); err == nil {
		href = u
	}
	return strings.TrimPrefix(path.Clean("/"+path.Join(path.Dir(opfPath), href)), "/")
}

func isBlock(tag string) bool {
	switch tag {
	case "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "br":
		return true
	}
	return false
}

func isHeading(tag string) bool {
	return len(tag) == 2 && tag[0] == 'h' && tag[1] >= '1' && tag[1] <= '6'
}

// collapse folds runs of whitespace into single spaces, keeping one
// leading or trailing space so adjacent inline elements stay separated.
func collapse(s string) string {
	c := strings.Join(strings.Fields(s), " ")
	if c == "" {
		if s != "" {
			return " "
		}
		return ""
	}
	if strings.ContainsRune(" \t\r\n\f", rune(s[0])) {
		c = " " + c
	}
	if strings.ContainsRune(" \t\r\n\f", rune(s[len(s)-1])) {
		c += " "
	}
	return c
}

// budget is what the whole book may still extract.
type budget struct{ text, runs, paras int }

// extract tokenizes one XHTML document into its first heading's text
// and its paragraphs, spending from b and failing with ErrInvalid when
// it runs out.
func extract(content []byte, b *budget) (string, []library.Paragraph, error) {
	z := html.NewTokenizer(bytes.NewReader(content))
	var (
		paras   []library.Paragraph
		cur     library.Paragraph
		plain   strings.Builder // the open plain run of cur
		skip    int             // inside head, script, style
		inRuby  bool
		inRt    int
		inRp    int
		inHead  bool
		base    strings.Builder
		rt      strings.Builder
		heading strings.Builder
		title   string
		// headAt is the index in paras where the open heading's paragraph
		// will land; titleAt is the paragraph the title came from (-1:
		// none).
		headAt  int
		titleAt = -1
		err     error
	)
	addRun := func(r library.Run) {
		b.text -= len(r.Text) + len(r.Ruby)
		b.runs--
		if b.text < 0 || b.runs < 0 {
			err = invalid("extracted text too large")
			return
		}
		cur = append(cur, r)
	}
	closePlain := func() {
		if plain.Len() > 0 {
			addRun(library.Run{Text: plain.String()})
			plain.Reset()
		}
	}
	// flushRuby ends a ruby group, emitting its base so no text is lost
	// when the markup leaves it unclosed.
	flushRuby := func() {
		if inRuby {
			if bs := base.String(); bs != "" {
				closePlain()
				if r := rt.String(); r != "" {
					addRun(library.Run{Text: bs, Ruby: r})
				} else {
					plain.WriteString(bs)
				}
				if inHead {
					heading.WriteString(bs)
				}
			}
		}
		inRuby, inRt, inRp = false, 0, 0
		base.Reset()
		rt.Reset()
	}
	flush := func() {
		flushRuby()
		closePlain()
		if len(cur) > 0 {
			cur[0].Text = strings.TrimLeft(cur[0].Text, " ")
			if last := &cur[len(cur)-1]; last.Ruby == "" {
				last.Text = strings.TrimRight(last.Text, " ")
			}
			var kept library.Paragraph
			for _, r := range cur {
				if r.Text != "" {
					kept = append(kept, r)
				}
			}
			if len(kept) > 0 {
				if b.paras--; b.paras < 0 {
					err = invalid("too many paragraphs")
				}
				paras = append(paras, kept)
			}
		}
		cur = nil
	}
	for err == nil {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		switch tt {
		case html.TextToken:
			if skip > 0 || inRp > 0 {
				continue
			}
			s := string(z.Text())
			switch {
			case inRt > 0:
				rt.WriteString(strings.TrimSpace(s))
			case inRuby:
				base.WriteString(strings.TrimSpace(s))
			case strings.TrimSpace(s) == "" && len(cur) == 0 && plain.Len() == 0:
			default:
				s = collapse(s)
				plain.WriteString(s)
				if inHead {
					heading.WriteString(s)
				}
			}
		case html.StartTagToken, html.EndTagToken, html.SelfClosingTagToken:
			nameB, _ := z.TagName()
			name := string(nameB)
			start := tt == html.StartTagToken
			end := tt == html.EndTagToken
			switch name {
			case "head", "script", "style":
				if start {
					skip++
				} else if end && skip > 0 {
					skip--
				}
			case "ruby":
				if skip == 0 {
					flushRuby()
					inRuby = start
				}
			case "rt":
				if start {
					inRt++
				} else if end && inRt > 0 {
					inRt--
				}
			case "rp":
				if start {
					inRp++
				} else if end && inRp > 0 {
					inRp--
				}
			}
			if skip == 0 && isBlock(name) {
				flush()
				if isHeading(name) {
					if start {
						inHead = true
						heading.Reset()
						headAt = len(paras)
					} else if end && inHead {
						inHead = false
						if title == "" {
							title = strings.Join(strings.Fields(heading.String()), " ")
							if title != "" && len(paras) == headAt+1 {
								titleAt = headAt
							}
						}
					}
				}
			}
		}
	}
	if err == nil {
		flush()
	}
	if err != nil {
		return "", nil, err
	}
	// The title heading is shown as the chapter title; drop its paragraph
	// so it does not show twice — unless it is all the chapter has.
	if titleAt >= 0 && len(paras) > 1 && paragraphText(paras[titleAt]) == title {
		paras = append(paras[:titleAt], paras[titleAt+1:]...)
	}
	return title, paras, nil
}

// paragraphText is the base text of p with whitespace runs collapsed to
// single spaces, as a heading's title is.
func paragraphText(p library.Paragraph) string {
	var b strings.Builder
	for _, r := range p {
		b.WriteString(r.Text)
	}
	return strings.Join(strings.Fields(b.String()), " ")
}
