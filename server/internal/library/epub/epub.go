// Package epub reads an epub's text into library chapters. Nothing is
// ever written to disk and zip entry names are used only as lookup keys
// inside the archive, so a hostile archive cannot reach the filesystem;
// sizes are bounded both by the declared headers and by the bytes
// actually read.
package epub

import (
	"archive/zip"
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
// archive limits.
var ErrInvalid = errors.New("epub: invalid epub")

const (
	maxEntries    = 2000
	maxTotalBytes = 200 << 20
	maxEntryBytes = 50 << 20
)

// Meta is the book metadata from the package document.
type Meta struct {
	Title, Author, Language string
}

type archive struct {
	files map[string]*zip.File
	total int64
}

// read returns the entry's content, bounded to maxEntryBytes and, with
// all earlier reads, to maxTotalBytes of actual bytes.
func (a *archive) read(name string) ([]byte, bool, error) {
	f, ok := a.files[name]
	if !ok {
		return nil, false, nil
	}
	rc, err := f.Open()
	if err != nil {
		return nil, false, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, maxEntryBytes+1))
	if err != nil {
		return nil, false, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	a.total += int64(len(data))
	if len(data) > maxEntryBytes || a.total > maxTotalBytes {
		return nil, false, fmt.Errorf("%w: archive too large", ErrInvalid)
	}
	return data, true, nil
}

type opfDoc struct {
	Title    string `xml:"metadata>title"`
	Author   string `xml:"metadata>creator"`
	Language string `xml:"metadata>language"`
	Manifest []struct {
		ID   string `xml:"id,attr"`
		Href string `xml:"href,attr"`
	} `xml:"manifest>item"`
	Spine []struct {
		IDRef string `xml:"idref,attr"`
	} `xml:"spine>itemref"`
}

// Parse reads an epub of the given size and returns its metadata and
// its spine items as chapters; spine items without text are skipped.
func Parse(r io.ReaderAt, size int64) (Meta, []library.Chapter, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return Meta{}, nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if len(zr.File) > maxEntries {
		return Meta{}, nil, fmt.Errorf("%w: too many entries", ErrInvalid)
	}
	a := &archive{files: make(map[string]*zip.File, len(zr.File))}
	var declared uint64
	for _, f := range zr.File {
		if f.UncompressedSize64 > maxEntryBytes {
			return Meta{}, nil, fmt.Errorf("%w: entry too large", ErrInvalid)
		}
		declared += f.UncompressedSize64
		if declared > maxTotalBytes {
			return Meta{}, nil, fmt.Errorf("%w: archive too large", ErrInvalid)
		}
		a.files[f.Name] = f
	}

	opfPath, err := a.rootfile()
	if err != nil {
		return Meta{}, nil, err
	}
	data, ok, err := a.read(opfPath)
	if err != nil {
		return Meta{}, nil, err
	}
	if !ok {
		return Meta{}, nil, fmt.Errorf("%w: package document missing", ErrInvalid)
	}
	var pkg opfDoc
	if err := xml.Unmarshal(data, &pkg); err != nil {
		return Meta{}, nil, fmt.Errorf("%w: package document: %v", ErrInvalid, err)
	}
	if len(pkg.Spine) == 0 {
		return Meta{}, nil, fmt.Errorf("%w: empty spine", ErrInvalid)
	}
	hrefs := make(map[string]string, len(pkg.Manifest))
	for _, it := range pkg.Manifest {
		hrefs[it.ID] = it.Href
	}

	meta := Meta{
		Title:    strings.TrimSpace(pkg.Title),
		Author:   strings.TrimSpace(pkg.Author),
		Language: strings.TrimSpace(pkg.Language),
	}
	var chapters []library.Chapter
	for _, ref := range pkg.Spine {
		href, ok := hrefs[ref.IDRef]
		if !ok {
			continue
		}
		name := resolve(opfPath, href)
		content, ok, err := a.read(name)
		if err != nil {
			return Meta{}, nil, err
		}
		if !ok {
			continue
		}
		title, paras := extract(content)
		if len(paras) == 0 {
			continue
		}
		if title == "" {
			base := path.Base(name)
			title = strings.TrimSuffix(base, path.Ext(base))
		}
		chapters = append(chapters, library.Chapter{Title: title, Paragraphs: paras})
	}
	if len(chapters) == 0 {
		return Meta{}, nil, fmt.Errorf("%w: no readable text", ErrInvalid)
	}
	return meta, chapters, nil
}

// rootfile returns the in-archive path of the package document.
func (a *archive) rootfile() (string, error) {
	data, ok, err := a.read("META-INF/container.xml")
	if err != nil {
		return "", err
	}
	if !ok {
		return "", fmt.Errorf("%w: container.xml missing", ErrInvalid)
	}
	var c struct {
		Rootfiles []struct {
			FullPath string `xml:"full-path,attr"`
		} `xml:"rootfiles>rootfile"`
	}
	if err := xml.Unmarshal(data, &c); err != nil || len(c.Rootfiles) == 0 || c.Rootfiles[0].FullPath == "" {
		return "", fmt.Errorf("%w: container.xml", ErrInvalid)
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

// collapse folds runs of whitespace into single spaces.
func collapse(s string) string { return strings.Join(strings.Fields(s), " ") }

// extract tokenizes one XHTML document into its first heading's text
// and its paragraphs.
func extract(content []byte) (string, []library.Paragraph) {
	z := html.NewTokenizer(strings.NewReader(string(content)))
	var (
		paras    []library.Paragraph
		cur      library.Paragraph
		skip     int // inside head, script, style
		inRuby   bool
		inRt     int
		inRp     int
		inHead   int // heading depth
		base, rt strings.Builder
		heading  strings.Builder
		title    string
	)
	addText := func(s string) {
		if n := len(cur); n > 0 && cur[n-1].Ruby == "" {
			cur[n-1].Text += s
		} else {
			cur = append(cur, library.Run{Text: s})
		}
	}
	flush := func() {
		if inRuby { // a block boundary never splits a ruby group
			return
		}
		if len(cur) > 0 {
			cur[0].Text = strings.TrimLeft(cur[0].Text, " ")
			last := &cur[len(cur)-1]
			if last.Ruby == "" {
				last.Text = strings.TrimRight(last.Text, " ")
			}
			var kept library.Paragraph
			for _, r := range cur {
				if r.Text != "" {
					kept = append(kept, r)
				}
			}
			if len(kept) > 0 {
				paras = append(paras, kept)
			}
		}
		cur = nil
	}
	endHeading := func() {
		if inHead == 0 {
			return
		}
		inHead = 0
		if title == "" {
			title = collapse(heading.String())
		}
		heading.Reset()
	}
	for {
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
			if strings.TrimSpace(s) == "" && inRt == 0 && !inRuby && len(cur) == 0 {
				continue
			}
			switch {
			case inRt > 0:
				rt.WriteString(strings.TrimSpace(s))
			case inRuby:
				base.WriteString(strings.TrimSpace(s))
			default:
				s = collapse2(s)
				addText(s)
				if inHead > 0 {
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
				if start {
					inRuby = true
					base.Reset()
					rt.Reset()
				} else if end && inRuby {
					inRuby = false
					if b := base.String(); b != "" {
						if r := rt.String(); r != "" {
							cur = append(cur, library.Run{Text: b, Ruby: r})
						} else {
							addText(b)
						}
					}
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
						inHead = 1
						heading.Reset()
					} else if end {
						endHeading()
					}
				}
			}
		}
	}
	inRuby = false
	flush()
	return title, paras
}

// collapse2 folds whitespace runs to one space but keeps a leading or
// trailing space so adjacent inline elements stay separated.
func collapse2(s string) string {
	c := collapse(s)
	if c == "" {
		if s != "" {
			return " "
		}
		return ""
	}
	if strings.IndexAny(s[:1], " \t\r\n") == 0 {
		c = " " + c
	}
	if strings.IndexAny(s[len(s)-1:], " \t\r\n") == 0 {
		c += " "
	}
	return c
}
