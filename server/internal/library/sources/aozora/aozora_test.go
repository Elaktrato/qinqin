package aozora

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
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

type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *testClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *testClock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

const (
	catOK      = 0
	catGarbage = 1
	catFail    = 2
)

type fixture struct {
	srv      *httptest.Server
	ad       *adapter
	clock    *testClock
	cacheDir string
	catHits  atomic.Int32
	zipHits  atomic.Int32
	catMode  atomic.Int32
	catGate  chan struct{} // when non-nil, catalog requests wait for it (or the client to leave)
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
	mux.HandleFunc("/catalog.zip", func(w http.ResponseWriter, r *http.Request) {
		f.catHits.Add(1)
		if f.catGate != nil {
			select {
			case <-f.catGate:
			case <-r.Context().Done():
				return
			}
		}
		switch f.catMode.Load() {
		case catGarbage:
			w.Write([]byte("this is not a zip"))
		case catFail:
			http.Error(w, "down", http.StatusInternalServerError)
		default:
			w.Write(cat)
		}
	})
	mux.HandleFunc("/f/1.html", func(w http.ResponseWriter, r *http.Request) { w.Write(sjis(t, xhtml)) })
	mux.HandleFunc("/f/1_ruby.zip", func(w http.ResponseWriter, r *http.Request) {
		f.zipHits.Add(1)
		w.Write(zipOf(t, "1_ruby.txt", sjis(t, "x\r\n本文\r\n")))
	})
	mux.HandleFunc("/f/4_ruby.zip", func(w http.ResponseWriter, r *http.Request) {
		w.Write(zipOf(t, "4_ruby.txt", sjis(t, txt)))
	})
	u, _ := url.Parse(base)
	f.cacheDir = t.TempDir()
	c := sources.NewHTTPClient(f.cacheDir, "ua")
	c.AllowPrivate = true // httptest listens on 127.0.0.1
	f.clock = &testClock{t: time.Now()}
	c.SetClock(f.clock.now, func(context.Context, time.Duration) error { return nil })
	f.ad = newAdapter(c, base+"/catalog.zip", map[string]bool{u.Host: true}, true)
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
	// (000007 is free but has no download URL on an allowed host)
	if want := []string{"000001", "000004", "000008"}; !reflect.DeepEqual(ids(rs), want) {
		t.Fatalf("all = %v, want %v", ids(rs), want)
	}
	if rs[0].Title != "吾輩は猫である" || rs[0].Author != "夏目漱石" || rs[0].Language != "ja" {
		t.Fatalf("result = %+v", rs[0])
	}
	for q, want := range map[string][]string{
		"漱石":      {"000001"},
		"夏目 漱石":   {"000001"},
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
	// Malformed and unknown ids alike are not found (404, not 502).
	for _, id := range []string{"", "abc", "../000001", "000001/../x", "1 ", "000002", "000003", "000005", "000006", "999999", "000007"} {
		if _, err := f.ad.Fetch(context.Background(), id); !errors.Is(err, sources.ErrNotFound) {
			t.Errorf("Fetch(%q) err = %v, want ErrNotFound", id, err)
		}
	}
}

func TestAozoraCatalogSingleFlight(t *testing.T) {
	f := newFixture(t, header)
	f.catGate = make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := f.ad.Search(context.Background(), "", 5); err != nil {
				t.Error(err)
			}
		}()
	}
	for f.catHits.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(50 * time.Millisecond) // let the other callers queue up
	close(f.catGate)
	wg.Wait()
	if n := f.catHits.Load(); n != 1 {
		t.Fatalf("catalog downloads = %d, want 1", n)
	}
}

func TestAozoraCatalogWaiterHonorsContext(t *testing.T) {
	f := newFixture(t, header)
	f.catGate = make(chan struct{})
	defer close(f.catGate)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := f.ad.Search(ctx, "", 5)
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > 2*time.Second {
		t.Fatalf("err = %v after %v", err, time.Since(start))
	}
}

func TestAozoraStaleCatalogServedWhenRefreshFails(t *testing.T) {
	f := newFixture(t, header)
	ctx := context.Background()
	if _, err := f.ad.Search(ctx, "", 5); err != nil {
		t.Fatal(err)
	}
	f.catMode.Store(catFail)
	f.clock.advance(catalogTTL + time.Hour)
	rs, err := f.ad.Search(ctx, "", 5)
	if err != nil || len(rs) != 3 {
		t.Fatalf("stale search: %v %v", ids(rs), err)
	}
	hits := f.catHits.Load()
	if _, err := f.ad.Search(ctx, "", 5); err != nil || f.catHits.Load() != hits {
		t.Fatalf("retried within the negative window: hits %d -> %d, err %v", hits, f.catHits.Load(), err)
	}
	f.clock.advance(negativeTTL + time.Second)
	if _, err := f.ad.Search(ctx, "", 5); err != nil || f.catHits.Load() != hits+1 {
		t.Fatalf("no retry after the window: hits %d, err %v", f.catHits.Load(), err)
	}
}

func TestAozoraFailureIsNegativelyCached(t *testing.T) {
	f := newFixture(t, header)
	ctx := context.Background()
	f.catMode.Store(catFail)
	if _, err := f.ad.Search(ctx, "", 5); err == nil {
		t.Fatal("expected error")
	}
	if _, err := f.ad.Search(ctx, "", 5); err == nil || f.catHits.Load() != 1 {
		t.Fatalf("second call: hits %d, err %v", f.catHits.Load(), err)
	}
	f.catMode.Store(catOK)
	f.clock.advance(negativeTTL + time.Second)
	if rs, err := f.ad.Search(ctx, "", 5); err != nil || len(rs) != 3 || f.catHits.Load() != 2 {
		t.Fatalf("after window: %v hits %d err %v", ids(rs), f.catHits.Load(), err)
	}
}

func TestAozoraBadCatalogBodyIsNotCached(t *testing.T) {
	f := newFixture(t, header)
	ctx := context.Background()
	f.catMode.Store(catGarbage)
	if _, err := f.ad.Search(ctx, "", 5); err == nil {
		t.Fatal("expected error for garbage catalog")
	}
	if entries, _ := os.ReadDir(f.cacheDir); len(entries) != 0 {
		t.Fatalf("bad body stayed in the cache: %v", entries)
	}
	f.catMode.Store(catOK)
	f.clock.advance(negativeTTL + time.Second)
	if rs, err := f.ad.Search(ctx, "", 5); err != nil || len(rs) != 3 {
		t.Fatalf("refetch: %v %v", ids(rs), err)
	}
}

func TestAozoraOversizedCardDoesNotFallBack(t *testing.T) {
	f := newFixture(t, header)
	f.ad.maxBody = 200 // the card is larger, the text zip would be too
	_, err := f.ad.Fetch(context.Background(), "000001")
	if !errors.Is(err, sources.ErrTooLarge) {
		t.Fatalf("err = %v, want ErrTooLarge", err)
	}
	if f.zipHits.Load() != 0 {
		t.Fatal("fell back to the text zip after a size error")
	}
}

func TestAozoraProductionIsHTTPSOnly(t *testing.T) {
	a := New(sources.NewHTTPClient(t.TempDir(), "ua")).(*adapter)
	if a.allowed("http://www.aozora.gr.jp/cards/1/f.html") || a.allowed("https://evil.example.com/x") ||
		!a.allowed("https://www.aozora.gr.jp/cards/1/f.html") {
		t.Fatal("unexpected allowlist behaviour")
	}
	// The live catalog has no GitHub URLs; the mirrors are not allowed.
	if a.allowed("https://github.com/aozorabunko/x.html") || a.allowed("https://raw.githubusercontent.com/a/b.zip") {
		t.Fatal("GitHub hosts must not be allowed")
	}
}

func TestSearchRanksBeforeTruncating(t *testing.T) {
	cat := &catalog{}
	add := func(id, title, author string) {
		cat.works = append(cat.works, &work{id: id, title: title, author: author, ntitle: normalize(title), nauthor: normalize(author)})
	}
	// Catalog (id) order puts the best hits last.
	add("000001", "x月y", "a")  // substring
	add("000002", "z", "月野")   // author
	add("000003", "月の夜", "b")  // title prefix
	add("000004", "月", "c")    // exact title
	add("000005", "none", "d") // no match
	got := []string{}
	for _, r := range cat.search(normalize("月"), 2) {
		got = append(got, r.SourceID)
	}
	if want := []string{"000004", "000003"}; !reflect.DeepEqual(got, want) {
		t.Errorf("search = %v, want %v", got, want)
	}
	if n := len(cat.search(normalize("月"), 100)); n != 4 {
		t.Errorf("search all = %d hits, want 4", n)
	}
}
