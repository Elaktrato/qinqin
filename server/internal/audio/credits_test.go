package audio_test

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"qinqin/internal/audio"
	"qinqin/internal/dbtest"
)

func TestPacksCreditsAndClips(t *testing.T) {
	ctx, sqlDB, store := context.Background(), dbtest.Open(t), t.TempDir()
	if list, err := audio.Packs(ctx, sqlDB); err != nil || list == nil || len(list) != 0 {
		t.Fatalf("no packs = %#v, %v", list, err)
	}
	p := makePack(t, "zh1", "zh", "CC0", []string{
		"term\t你好\tni3 hao3\taudio/t.ogg\tCC BY 4.0\tAnn\thttps://example.test/t",
		"syllable\t\txing2\taudio/x.ogg\t\tBob\t",
	}, []clipFile{{"t.ogg", oggClip("t")}, {"x.ogg", oggClip("x")}})
	if _, err := audio.Import(ctx, sqlDB, p, store); err != nil {
		t.Fatal(err)
	}
	q := makePack(t, "ja1", "ja", "CC0", []string{"term\t風\tかぜ\taudio/a.opus\t\t\t"}, []clipFile{{"a.opus", oggClip("a")}})
	if _, err := audio.Import(ctx, sqlDB, q, store); err != nil {
		t.Fatal(err)
	}

	packs, err := audio.Packs(ctx, sqlDB)
	want := []audio.PackInfo{
		{PackID: "zh1", Name: "Test zh1", Version: "1", Language: "zh", License: "CC0", Attribution: "Tester", ClipCount: 2},
		{PackID: "ja1", Name: "Test ja1", Version: "1", Language: "ja", License: "CC0", Attribution: "Tester", ClipCount: 1},
	}
	if err != nil || !reflect.DeepEqual(packs, want) {
		t.Errorf("Packs = %+v, %v\nwant %+v", packs, err, want)
	}

	page, err := audio.Credits(ctx, sqlDB, "zh1", 0, 100)
	wantAll := []audio.Credit{
		{Kind: "term", Form: "你好", Reading: "ni3hao3", License: "CC BY 4.0", Attribution: "Ann", Source: "https://example.test/t"},
		{Kind: "syllable", Reading: "xing2", License: "CC0", Attribution: "Bob"},
	}
	if err != nil || page.Total != 2 || page.Offset != 0 || page.Limit != 100 || !reflect.DeepEqual(page.Credits, wantAll) {
		t.Errorf("Credits = %+v, %v", page, err)
	}
	page, _ = audio.Credits(ctx, sqlDB, "zh1", 1, 1)
	if page.Total != 2 || page.Offset != 1 || page.Limit != 1 || !reflect.DeepEqual(page.Credits, wantAll[1:]) {
		t.Errorf("page = %+v", page)
	}
	page, _ = audio.Credits(ctx, sqlDB, "zh1", 0, 9999)
	if page.Limit != audio.MaxCreditsLimit || len(page.Credits) != 2 {
		t.Errorf("capped = %+v, want limit %d", page, audio.MaxCreditsLimit)
	}
	page, _ = audio.Credits(ctx, sqlDB, "zh1", 10, 5)
	if page.Total != 2 || page.Credits == nil || len(page.Credits) != 0 {
		t.Errorf("past the end = %#v", page)
	}
	if _, err := audio.Credits(ctx, sqlDB, "nope", 0, 10); !errors.Is(err, audio.ErrPackNotFound) {
		t.Errorf("unknown pack: %v", err)
	}

	r, err := audio.Resolve(ctx, sqlDB, "zh", "你好", []string{"nǐ hǎo"})
	if err != nil || len(r.Terms) != 1 {
		t.Fatalf("Resolve = %+v, %v", r, err)
	}
	sha := r.Terms[0].SHA
	for _, c := range []struct {
		sha, ext string
		want     bool
	}{{sha, "ogg", true}, {sha, "mp3", false}, {"00", "ogg", false}} {
		if got, err := audio.ClipActive(ctx, sqlDB, c.sha, c.ext); err != nil || got != c.want {
			t.Errorf("ClipActive(%s, %s) = %v, %v; want %v", c.sha, c.ext, got, err, c.want)
		}
	}
	if _, err := audio.Uninstall(ctx, sqlDB, "zh1", store); err != nil {
		t.Fatal(err)
	}
	if got, _ := audio.ClipActive(ctx, sqlDB, sha, "ogg"); got {
		t.Error("a clip of an uninstalled pack is active")
	}
	if _, err := audio.Credits(ctx, sqlDB, "zh1", 0, 10); !errors.Is(err, audio.ErrPackNotFound) {
		t.Errorf("uninstalled pack: %v", err)
	}
	if packs, _ := audio.Packs(ctx, sqlDB); len(packs) != 1 || packs[0].PackID != "ja1" {
		t.Errorf("after uninstall = %+v", packs)
	}
}
