package epub_test

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/library"
	"qinqin/internal/library/epub"
)

const containerXML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

// opf builds a package document with the given manifest items (id, href)
// in manifest order and spine idrefs.
func opf(lang string, items [][2]string, spine []string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">`)
	b.WriteString(`<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">`)
	b.WriteString(`<dc:title>Test Book</dc:title><dc:creator>An Author</dc:creator>`)
	if lang != "" {
		b.WriteString(`<dc:language>` + lang + `</dc:language>`)
	}
	b.WriteString(`</metadata><manifest>`)
	for _, it := range items {
		fmt.Fprintf(&b, `<item id="%s" href="%s" media-type="application/xhtml+xml"/>`, it[0], it[1])
	}
	b.WriteString(`</manifest><spine>`)
	for _, id := range spine {
		fmt.Fprintf(&b, `<itemref idref="%s"/>`, id)
	}
	b.WriteString(`</spine></package>`)
	return b.String()
}

func xhtml(body string) string {
	return `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>ignored</title><style>.x{}</style></head><body>` + body + `</body></html>`
}

// buildZip writes the named files into an in-memory zip.
func buildZip(t *testing.T, files map[string]string, order []string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range order {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(files[name])); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func buildEpub(t *testing.T, lang string, chapters map[string]string, manifestOrder, spine []string) []byte {
	t.Helper()
	files := map[string]string{
		"META-INF/container.xml": containerXML,
	}
	order := []string{"META-INF/container.xml", "OEBPS/content.opf"}
	var items [][2]string
	for _, id := range manifestOrder {
		href := id + ".xhtml"
		items = append(items, [2]string{id, href})
		files["OEBPS/"+href] = chapters[id]
		order = append(order, "OEBPS/"+href)
	}
	files["OEBPS/content.opf"] = opf(lang, items, spine)
	return buildZip(t, files, order)
}

func parse(t *testing.T, data []byte) (epub.Meta, []library.Chapter, error) {
	t.Helper()
	return epub.Parse(bytes.NewReader(data), int64(len(data)))
}

func text(p library.Paragraph) string {
	var s string
	for _, r := range p {
		s += r.Text
	}
	return s
}

func TestParseSpineOrder(t *testing.T) {
	data := buildEpub(t, "zh-CN", map[string]string{
		"a": xhtml(`<h1>First</h1><p>one</p>`),
		"b": xhtml(`<h1>Second</h1><p>two</p><p>three</p>`),
	}, []string{"a", "b"}, []string{"b", "a"})
	meta, chs, err := parse(t, data)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Title != "Test Book" || meta.Author != "An Author" || meta.Language != "zh-CN" {
		t.Errorf("meta = %+v", meta)
	}
	if len(chs) != 2 || chs[0].Title != "Second" || chs[1].Title != "First" {
		t.Fatalf("chapters = %+v, want spine order Second, First", chs)
	}
	if len(chs[0].Paragraphs) != 3 {
		t.Errorf("paragraphs = %d, want heading + 2", len(chs[0].Paragraphs))
	}
}

func TestParseRubyAndRt(t *testing.T) {
	data := buildEpub(t, "ja", map[string]string{
		"a": xhtml(`<p>私は<ruby>漢<rt>かん</rt></ruby><ruby>字<rp>(</rp><rt>じ</rt><rp>)</rp></ruby>です</p>`),
	}, []string{"a"}, []string{"a"})
	_, chs, err := parse(t, data)
	if err != nil {
		t.Fatal(err)
	}
	want := library.Paragraph{
		{Text: "私は"}, {Text: "漢", Ruby: "かん"}, {Text: "字", Ruby: "じ"}, {Text: "です"},
	}
	if len(chs) != 1 || len(chs[0].Paragraphs) != 1 || !reflect.DeepEqual(chs[0].Paragraphs[0], want) {
		t.Fatalf("chapters = %+v, want paragraph %+v", chs, want)
	}
}

func TestParseSkipsImagesScriptStyle(t *testing.T) {
	data := buildEpub(t, "zh", map[string]string{
		"a": xhtml(`<p>keep<img alt="no"/><script>var x = "bad";</script><style>p{}</style>me</p>`),
		"b": xhtml(`<div><img src="x.png"/></div>`),
	}, []string{"a", "b"}, []string{"a", "b"})
	_, chs, err := parse(t, data)
	if err != nil {
		t.Fatal(err)
	}
	if len(chs) != 1 {
		t.Fatalf("chapters = %d, want the text-less item skipped", len(chs))
	}
	if got := text(chs[0].Paragraphs[0]); got != "keepme" {
		t.Errorf("text = %q, want keepme", got)
	}
}

func TestParseMissingSpine(t *testing.T) {
	files := map[string]string{
		"META-INF/container.xml": containerXML,
		"OEBPS/content.opf":      opf("zh", nil, nil),
	}
	data := buildZip(t, files, []string{"META-INF/container.xml", "OEBPS/content.opf"})
	if _, _, err := parse(t, data); !errors.Is(err, epub.ErrInvalid) {
		t.Errorf("err = %v, want ErrInvalid", err)
	}
	// No container.xml at all.
	data = buildZip(t, map[string]string{"x": "y"}, []string{"x"})
	if _, _, err := parse(t, data); !errors.Is(err, epub.ErrInvalid) {
		t.Errorf("err = %v, want ErrInvalid", err)
	}
}

func TestParseNotAZip(t *testing.T) {
	if _, _, err := parse(t, []byte("definitely not a zip")); !errors.Is(err, epub.ErrInvalid) {
		t.Errorf("err = %v, want ErrInvalid", err)
	}
}

func TestParseTitleFromHeadingOrFile(t *testing.T) {
	data := buildEpub(t, "zh", map[string]string{
		"chap1": xhtml(`<p>no heading</p>`),
		"chap2": xhtml(`<p>pre</p><h2> Real  <b>Title</b> </h2>`),
	}, []string{"chap1", "chap2"}, []string{"chap1", "chap2"})
	_, chs, err := parse(t, data)
	if err != nil {
		t.Fatal(err)
	}
	if len(chs) != 2 || chs[0].Title != "chap1" || chs[1].Title != "Real Title" {
		t.Fatalf("titles = %+v", chs)
	}
}
