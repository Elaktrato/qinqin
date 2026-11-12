package aozora

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"golang.org/x/text/encoding/japanese"

	"qinqin/internal/library"
	"qinqin/internal/library/sources"
)

var header = []string{
	"作品ID", "作品名", "作品著作権フラグ", "公開日", "図書カードURL", "姓", "名",
	"役割フラグ", "人物著作権フラグ", "テキストファイルURL", "XHTML/HTMLファイルURL",
}

func sjis(t *testing.T, s string) []byte {
	t.Helper()
	b, err := japanese.ShiftJIS.NewEncoder().Bytes([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func zipOf(t *testing.T, name string, data []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create(name)
	w.Write(data)
	zw.Close()
	return buf.Bytes()
}

func catalogZip(t *testing.T, head []string, rows [][]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	buf.WriteString("\xef\xbb\xbf")
	w := csv.NewWriter(&buf)
	w.Write(head)
	for _, r := range rows {
		w.Write(r)
	}
	w.Flush()
	return zipOf(t, "list_person_all_extended_utf8.csv", buf.Bytes())
}

const xhtml = `<?xml version="1.0" encoding="Shift_JIS"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div class="metadata"><h1 class="title">吾輩は猫である</h1><h2 class="author">夏目漱石</h2></div>
<div class="main_text"><br />
<ruby><rb>吾輩</rb><rp>（</rp><rt>わがはい</rt><rp>）</rp></ruby>は<ruby><rb>猫</rb><rp>（</rp><rt>ねこ</rt><rp>）</rp></ruby>である。<br />
名前はまだ無い。<br />
<div class="jisage_2" style="margin-left: 2em">どこで<img src="../../../gaiji/1-1/1-1-1.png" alt="※(U+55EF、「口＋愛」)" class="gaiji" />生れたか<img src="x.png" alt="※(「二の字点」、1-2-22)" class="gaiji" />。</div>
<br />
</div>
<div class="bibliographical_information">
<hr />
<br />
底本：「吾輩は猫である」新潮文庫、新潮社<br />
　　　1961（昭和36）年2月20日発行<br />
入力：テスト<br />
青空文庫作成ファイル：<br />
このファイルは、インターネットの図書館、青空文庫で作られました。<br />
</div>
<div class="notation_notes"><hr /><br />●表記について<br /></div>
<div id="card"><a href="x">●図書カード</a></div></body></html>`

const txt = "羅生門\r\n芥川龍之介\r\n\r\n" +
	"-------------------------------------------------------\r\n" +
	"【テキスト中に現れる記号について】\r\n\r\n《》：ルビ\r\n" +
	"-------------------------------------------------------\r\n\r\n" +
	"｜下人《げにん》が羅生門《らしょうもん》の下で雨やみを待っていた。\r\n" +
	"［＃７字下げ］一［＃「一」は中見出し］\r\n" +
	"※［＃「口＋愛」、U+55EF、1-1-1］と※［＃二の字点、1-2-22］。［＃改ページ］\r\n" +
	"\r\n\r\n" +
	"底本：「芥川龍之介全集1」岩波書店\r\n" +
	"　　　1977（昭和52）年1月\r\n" +
	"入力：テスト\r\n"

type fixture struct {
	srv *httptest.Server
	ad  *adapter
}

func newFixture(t *testing.T, head []string) *fixture {
	t.Helper()
	f := &fixture{}
	mux := http.NewServeMux()
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	base := f.srv.URL
	row := func(id, title, workFlag, family, given, role, personFlag, txtURL, htmlURL string) []string {
		return []string{id, title, workFlag, "2020-04-03", base + "/cards/" + id + "/card" + id + ".html",
			family, given, role, personFlag, txtURL, htmlURL}
	}
	rows := [][]string{
		row("000001", "吾輩は猫である", "なし", "夏目", "漱石", "著者", "なし", base+"/f/1_ruby.zip", base+"/f/1.html"),
		row("000002", "著作権あり作品", "あり", "夏目", "漱石", "著者", "なし", base+"/f/1_ruby.zip", base+"/f/1.html"),
		row("000003", "人物著作権あり作品", "なし", "現代", "作家", "著者", "あり", base+"/f/1_ruby.zip", base+"/f/1.html"),
		row("000004", "羅生門", "なし", "芥川", "龍之介", "著者", "なし", base+"/f/4_ruby.zip", ""),
		row("000005", "フラグ不明", "", "夏目", "漱石", "著者", "なし", base+"/f/1_ruby.zip", base+"/f/1.html"),
		row("000006", "翻訳者が著作権あり", "なし", "原", "作者", "著者", "なし", base+"/f/1_ruby.zip", base+"/f/1.html"),
		row("000006", "翻訳者が著作権あり", "なし", "訳", "者", "翻訳者", "あり", base+"/f/1_ruby.zip", base+"/f/1.html"),
		row("000007", "外部ホスト", "なし", "夏目", "漱石", "著者", "なし", "http://evil.example.com/a.zip", "http://evil.example.com/a.html"),
		row("000008", "Sample ＡＢＣ", "なし", "太宰", "治", "著者", "なし", base+"/f/4_ruby.zip", ""),
	}
	cat := catalogZip(t, head, rows)
	mux.HandleFunc("/catalog.zip", func(w http.ResponseWriter, r *http.Request) { w.Write(cat) })
	mux.HandleFunc("/f/1.html", func(w http.ResponseWriter, r *http.Request) { w.Write(sjis(t, xhtml)) })
	mux.HandleFunc("/f/1_ruby.zip", func(w http.ResponseWriter, r *http.Request) {
		w.Write(zipOf(t, "1_ruby.txt", sjis(t, "x\r\n本文\r\n")))
	})
	mux.HandleFunc("/f/4_ruby.zip", func(w http.ResponseWriter, r *http.Request) {
		w.Write(zipOf(t, "4_ruby.txt", sjis(t, txt)))
	})
	u, _ := url.Parse(base)
	c := sources.NewHTTPClient(t.TempDir(), "ua")
	now := time.Now()
	c.SetClock(func() time.Time { return now }, func(context.Context, time.Duration) error { return nil })
	f.ad = &adapter{
		c:            c,
		catalogURL:   base + "/catalog.zip",
		allowedHosts: map[string]bool{u.Host: true},
	}
	return f
}

func ids(rs []sources.Result) []string {
	out := []string{}
	for _, r := range rs {
		out = append(out, r.SourceID)
	}
	return out
}

func TestAozoraSearchFiltersCopyrighted(t *testing.T) {
	f := newFixture(t, header)
	ctx := context.Background()
	rs, err := f.ad.Search(ctx, "", 50)
	if err != nil {
		t.Fatal(err)
	}
	// only works whose work AND person flags are both なし, ordered by id
	if want := []string{"000001", "000004", "000007", "000008"}; !reflect.DeepEqual(ids(rs), want) {
		t.Fatalf("all = %v, want %v", ids(rs), want)
	}
	if rs[0].Title != "吾輩は猫である" || rs[0].Author != "夏目漱石" || rs[0].Language != "ja" {
		t.Fatalf("result = %+v", rs[0])
	}
	for q, want := range map[string][]string{
		"漱石":      {"000001", "000007"},
		"夏目 漱石":   {"000001", "000007"},
		"羅生":      {"000004"},
		"abc":     {"000008"}, // NFKC + case-insensitive
		"著作権あり":   {},         // copyrighted work is never found
		"現代":      {},         // nor the copyrighted person's
		"翻訳者が著作権": {},
	} {
		rs, err := f.ad.Search(ctx, q, 50)
		if err != nil || !reflect.DeepEqual(ids(rs), want) {
			t.Errorf("Search(%q) = %v, %v; want %v", q, ids(rs), err, want)
		}
	}
	if rs, _ := f.ad.Search(ctx, "", 2); len(rs) != 2 || rs[1].SourceID != "000004" {
		t.Fatalf("limit: %v", ids(rs))
	}
}

func TestAozoraCatalogMissingColumnFailsLoudly(t *testing.T) {
	var head []string
	for _, h := range header {
		if h != "人物著作権フラグ" {
			head = append(head, h)
		}
	}
	f := newFixture(t, head)
	_, err := f.ad.Search(context.Background(), "", 10)
	if err == nil || !strings.Contains(err.Error(), "人物著作権フラグ") {
		t.Fatalf("err = %v", err)
	}
}

func TestAozoraFetchRuby(t *testing.T) {
	f := newFixture(t, header)
	imp, err := f.ad.Fetch(context.Background(), "000001")
	if err != nil {
		t.Fatal(err)
	}
	m := imp.Meta
	if m.Title != "吾輩は猫である" || m.Author != "夏目漱石" || m.Language != "ja" || m.Source != "aozora" ||
		m.SourceID != "000001" || m.SourceURL != f.srv.URL+"/cards/000001/card000001.html" {
		t.Fatalf("meta = %+v", m)
	}
	if !strings.Contains(m.LicenseNote, "著作権なし") || !strings.Contains(m.LicenseNote, "public domain") {
		t.Fatalf("license note = %q", m.LicenseNote)
	}
	if !strings.Contains(m.Attribution, "底本：「吾輩は猫である」") || !strings.Contains(m.Attribution, "青空文庫") ||
		strings.Contains(m.Attribution, "このファイルは") || strings.Contains(m.Attribution, "表記について") {
		t.Fatalf("attribution = %q", m.Attribution)
	}
	if len(imp.Chapters) != 1 {
		t.Fatalf("chapters = %+v", imp.Chapters)
	}
	ps := imp.Chapters[0].Paragraphs
	want0 := library.Paragraph{{Text: "吾輩", Ruby: "わがはい"}, {Text: "は"}, {Text: "猫", Ruby: "ねこ"}, {Text: "である。"}}
	if len(ps) < 2 || !reflect.DeepEqual(ps[0], want0) {
		t.Fatalf("paragraphs = %+v", ps)
	}
	if !reflect.DeepEqual(ps[1], library.Paragraph{{Text: "名前はまだ無い。"}}) {
		t.Fatalf("paragraph 1 = %+v", ps[1])
	}
	// XHTML gaiji images become their character (U+ notes) or 〓
	if want := (library.Paragraph{{Text: "どこで嗯生れたか〓。"}}); !reflect.DeepEqual(ps[2], want) || len(ps) != 3 {
		t.Fatalf("gaiji paragraphs = %+v", ps)
	}
}

func TestAozoraFetchShiftJIS(t *testing.T) {
	f := newFixture(t, header)
	imp, err := f.ad.Fetch(context.Background(), "000004")
	if err != nil {
		t.Fatal(err)
	}
	if imp.Meta.Language != "ja" || imp.Meta.Title != "羅生門" || imp.Meta.Author != "芥川龍之介" {
		t.Fatalf("meta = %+v", imp.Meta)
	}
	ps := imp.Chapters[0].Paragraphs
	want := library.Paragraph{
		{Text: "下人", Ruby: "げにん"}, {Text: "が"}, {Text: "羅生門", Ruby: "らしょうもん"}, {Text: "の下で雨やみを待っていた。"},
	}
	if len(ps) == 0 || !reflect.DeepEqual(ps[0], want) {
		t.Fatalf("paragraphs = %+v", ps)
	}
}

func TestAozoraFetchStripsGaijiAndFooter(t *testing.T) {
	f := newFixture(t, header)
	imp, err := f.ad.Fetch(context.Background(), "000004")
	if err != nil {
		t.Fatal(err)
	}
	var all []string
	for _, p := range imp.Chapters[0].Paragraphs {
		var s string
		for _, r := range p {
			s += r.Text
		}
		all = append(all, s)
	}
	want := []string{
		"下人が羅生門の下で雨やみを待っていた。",
		"一",
		"嗯と〓。",
	}
	if !reflect.DeepEqual(all, want) {
		t.Fatalf("paragraphs = %q, want %q", all, want)
	}
	if !strings.Contains(imp.Meta.Attribution, "底本：「芥川龍之介全集1」岩波書店") || !strings.Contains(imp.Meta.Attribution, "1977") {
		t.Fatalf("attribution = %q", imp.Meta.Attribution)
	}
}

func TestAozoraFetchRejects(t *testing.T) {
	f := newFixture(t, header)
	for _, id := range []string{"", "abc", "../000001", "000001/../x", "1 ", "000002", "000003", "000005", "000006", "999999", "000007"} {
		if _, err := f.ad.Fetch(context.Background(), id); err == nil {
			t.Errorf("Fetch(%q) succeeded", id)
		}
	}
}
