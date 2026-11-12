package epub_test

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"qinqin/internal/library"
	"qinqin/internal/library/epub"
)

// lowered applies the production caps with f's changes for one test.
func lowered(t *testing.T, f func(*epub.Limits)) {
	t.Helper()
	l := epub.DefaultLimits()
	f(&l)
	t.Cleanup(epub.SetLimits(l))
}

func wantInvalid(t *testing.T, what string, data []byte) {
	t.Helper()
	if _, _, err := parse(t, data); !errors.Is(err, epub.ErrInvalid) {
		t.Errorf("%s: err = %v, want ErrInvalid", what, err)
	}
}

func simple(t *testing.T, bodies ...string) []byte {
	t.Helper()
	chs := map[string]string{}
	var ids []string
	for i, b := range bodies {
		id := fmt.Sprintf("c%d", i)
		chs[id] = xhtml(b)
		ids = append(ids, id)
	}
	return buildEpub(t, "zh", chs, ids, ids)
}

// patchSize rewrites the uncompressed size in the central directory
// entry of the named file, making its header lie.
func patchSize(t *testing.T, data []byte, name string, size uint32) {
	t.Helper()
	sig := []byte{0x50, 0x4b, 0x01, 0x02}
	for i := 0; i+46 <= len(data); i++ {
		if !bytes.Equal(data[i:i+4], sig) {
			continue
		}
		n := int(binary.LittleEndian.Uint16(data[i+28:]))
		if i+46+n <= len(data) && string(data[i+46:i+46+n]) == name {
			binary.LittleEndian.PutUint32(data[i+24:], size)
			return
		}
	}
	t.Fatalf("central entry %q not found", name)
}

func TestParseTooManyEntries(t *testing.T) {
	lowered(t, func(l *epub.Limits) { l.Entries = 10 })
	files := map[string]string{"META-INF/container.xml": containerXML}
	order := []string{"META-INF/container.xml"}
	for i := 0; i < 11; i++ {
		n := fmt.Sprintf("f%d.txt", i)
		files[n] = "x"
		order = append(order, n)
	}
	wantInvalid(t, "entries", buildZip(t, files, order))
}

func TestParseDeclaredSizeLimits(t *testing.T) {
	data := simple(t, "<p>"+strings.Repeat("a", 3000)+"</p>")
	lowered(t, func(l *epub.Limits) { l.Entry = 2000 })
	wantInvalid(t, "declared entry size", data)

	lowered(t, func(l *epub.Limits) { l.Entry = 1 << 20; l.Total = 2000 })
	wantInvalid(t, "declared total size", data)
}

// A header that understates its size must not bypass the limits: the
// bytes actually read are counted.
func TestParseLyingHeader(t *testing.T) {
	body := "<p>" + strings.Repeat("a", 1500) + "</p>"
	data := simple(t, body)
	patchSize(t, data, "OEBPS/c0.xhtml", 1)
	lowered(t, func(l *epub.Limits) { l.Entry = 1000 })
	wantInvalid(t, "lying entry header", data)

	// Cumulative: each entry is under the per-entry cap, together over
	// the total.
	data = simple(t, body, body)
	patchSize(t, data, "OEBPS/c0.xhtml", 1)
	patchSize(t, data, "OEBPS/c1.xhtml", 1)
	lowered(t, func(l *epub.Limits) { l.Entry = 2000; l.Total = 3500 })
	wantInvalid(t, "lying total", data)
}

func TestParseOutputCaps(t *testing.T) {
	cases := []struct {
		name string
		set  func(*epub.Limits)
		data []byte
	}{
		{"text", func(l *epub.Limits) { l.Text = 10 }, simple(t, "<p>0123456789ab</p>")},
		{"text across chapters", func(l *epub.Limits) { l.Text = 10 }, simple(t, "<p>01234567</p>", "<p>01234567</p>")},
		{"runs", func(l *epub.Limits) { l.Runs = 3 }, simple(t, "<p><ruby>a<rt>1</rt></ruby><ruby>b<rt>2</rt></ruby><ruby>c<rt>3</rt></ruby><ruby>d<rt>4</rt></ruby></p>")},
		{"paragraphs", func(l *epub.Limits) { l.Paragraphs = 2 }, simple(t, "<p>a</p><p>b</p><p>c</p>")},
		{"chapters", func(l *epub.Limits) { l.Chapters = 1 }, simple(t, "<p>a</p>", "<p>b</p>")},
		{"opf size", func(l *epub.Limits) { l.OPF = 100 }, simple(t, "<p>a</p>")},
	}
	for _, c := range cases {
		lowered(t, c.set)
		wantInvalid(t, c.name, c.data)
	}

	// Chapters without text do not count toward the chapter cap.
	lowered(t, func(l *epub.Limits) { l.Chapters = 1 })
	if _, chs, err := parse(t, simple(t, "<div></div>", "<p>a</p>", "<img/>")); err != nil || len(chs) != 1 {
		t.Errorf("text-less chapters counted: %d chapters, err %v", len(chs), err)
	}
}

func TestParseDedupesSpine(t *testing.T) {
	data := buildEpub(t, "zh", map[string]string{
		"a": xhtml(`<p>one</p>`),
		"b": xhtml(`<p>two</p>`),
	}, []string{"a", "b"}, []string{"a", "b", "a", "a"})
	_, chs, err := parse(t, data)
	if err != nil {
		t.Fatal(err)
	}
	if len(chs) != 2 || text(chs[0].Paragraphs[0]) != "one" || text(chs[1].Paragraphs[0]) != "two" {
		t.Errorf("chapters = %+v, want one, two", chs)
	}
}

func TestParseManyTextTokensIsLinear(t *testing.T) {
	const n = 200000
	data := simple(t, "<p>"+strings.Repeat("x<b></b>", n)+"</p>")
	type result struct {
		chs []library.Chapter
		err error
	}
	done := make(chan result, 1)
	go func() {
		_, chs, err := parse(t, data)
		done <- result{chs, err}
	}()
	select {
	case r := <-done:
		if r.err != nil {
			t.Fatal(r.err)
		}
		if got := text(r.chs[0].Paragraphs[0]); got != strings.Repeat("x", n) {
			t.Errorf("text length = %d, want %d", len(got), n)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("parse did not finish within 2s")
	}
}

func TestParseUnclosedRuby(t *testing.T) {
	_, chs, err := parse(t, simple(t, `<p>a<ruby>漢<rt>かん</p><p>later text</p>`, `<p>tail<ruby>字</p>`, `<p>x<ruby>y`))
	if err != nil {
		t.Fatal(err)
	}
	if len(chs) != 3 {
		t.Fatalf("chapters = %+v", chs)
	}
	if got := text(chs[0].Paragraphs[0]); got != "a漢" {
		t.Errorf("ruby base kept: %q, want a漢", got)
	}
	if got := text(chs[0].Paragraphs[1]); got != "later text" {
		t.Errorf("later paragraph = %q", got)
	}
	if got := text(chs[1].Paragraphs[0]); got != "tail字" {
		t.Errorf("unclosed ruby without rt: %q, want tail字", got)
	}
	if got := text(chs[2].Paragraphs[0]); got != "xy" {
		t.Errorf("ruby open at end of document: %q, want xy", got)
	}
}

func TestParseUnclosedRt(t *testing.T) {
	_, chs, err := parse(t, simple(t, `<p><ruby>漢<rt>かん</ruby>after</p>`))
	if err != nil {
		t.Fatal(err)
	}
	if got := text(chs[0].Paragraphs[0]); got != "漢after" {
		t.Errorf("text = %q, want 漢after", got)
	}
	if r := chs[0].Paragraphs[0][0]; r.Ruby != "かん" {
		t.Errorf("first run = %+v, want ruby かん", r)
	}
}

func TestParseHeadingTitleIncludesRuby(t *testing.T) {
	_, chs, err := parse(t, simple(t, `<h1>第<ruby>一<rt>いち</rt></ruby>章</h1><p>x</p>`))
	if err != nil {
		t.Fatal(err)
	}
	if chs[0].Title != "第一章" {
		t.Errorf("title = %q, want 第一章", chs[0].Title)
	}
}

func TestParseSkipsNonHTMLSpineItems(t *testing.T) {
	files := map[string]string{
		"META-INF/container.xml": containerXML,
		"OEBPS/content.opf": `<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` +
			`<dc:title></dc:title><dc:title>Second Title</dc:title><dc:creator></dc:creator><dc:creator>Auth</dc:creator>` +
			`<dc:language></dc:language><dc:language>ja</dc:language></metadata><manifest>` +
			`<item id="img" href="cover.png" media-type="image/png"/>` +
			`<item id="a" href="a.html" media-type="text/html"/></manifest>` +
			`<spine><itemref idref="img"/><itemref idref="a"/></spine></package>`,
		"OEBPS/cover.png": "<p>not a chapter</p>",
		"OEBPS/a.html":    xhtml("<p>ok</p>"),
	}
	data := buildZip(t, files, []string{"META-INF/container.xml", "OEBPS/content.opf", "OEBPS/cover.png", "OEBPS/a.html"})
	meta, chs, err := parse(t, data)
	if err != nil {
		t.Fatal(err)
	}
	if len(chs) != 1 || text(chs[0].Paragraphs[0]) != "ok" {
		t.Errorf("chapters = %+v, want only the html item", chs)
	}
	if meta.Title != "Second Title" || meta.Author != "Auth" || meta.Language != "ja" {
		t.Errorf("meta = %+v, want first non-empty values", meta)
	}
}
