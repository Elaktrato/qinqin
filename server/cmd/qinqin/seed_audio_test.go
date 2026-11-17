package main

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"qinqin/internal/audio"
	"qinqin/internal/dict"
)

// audioPackDir writes a generated two-clip audio pack (synthetic bytes
// with valid Ogg magic) into root/<id>.
func audioPackDir(t *testing.T, root, id string) string {
	t.Helper()
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(filepath.Join(dir, "audio"), 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"manifest.json": `{"id":"` + id + `","name":"Audio test","version":"1","type":"audio","language":"ja","license":"CC0","attribution":"Tester","format":"audio-index"}`,
		"index.tsv": "kind\tform\treading\tfile\tlicense\tattribution\tsource\n" +
			"term\t風\tかぜ\taudio/a.opus\t\t\t\n" +
			"term\t水\tみず\taudio/b.ogg\t\t\t\n",
		"audio/a.opus": "OggS-one",
		"audio/b.ogg":  "OggS-two",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestSeedImportsAudioPack(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	root, data := t.TempDir(), t.TempDir()
	audioPackDir(t, root, "audio-test")
	var out strings.Builder
	if err := seed(context.Background(), sqlDB, data, []string{root}, &out); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if !regexpLine(out.String(), `^audio-test\s+audio\s+2 clips$`) {
		t.Errorf("seed output = %q, want %q line", out.String(), "audio-test audio 2 clips")
	}
	r, err := audio.Resolve(context.Background(), sqlDB, "ja", "風", []string{"かぜ"})
	if err != nil || len(r.Terms) != 1 {
		t.Fatalf("Resolve = %+v, %v", r, err)
	}
	if _, err := os.Stat(audio.BlobPath(filepath.Join(data, "audio"), r.Terms[0].SHA, r.Terms[0].Ext)); err != nil {
		t.Errorf("blob not under <data>/audio: %v", err)
	}
	if importOrder[dict.TypeAudio] <= importOrder[dict.TypeSentences] {
		t.Errorf("importOrder[audio] = %d, want after sentences", importOrder[dict.TypeAudio])
	}
}

func regexpLine(out, pattern string) bool {
	for _, l := range strings.Split(out, "\n") {
		if ok, _ := regexp.MatchString(pattern, strings.TrimSpace(l)); ok {
			return true
		}
	}
	return false
}

func TestDefaultPacksIncludesDataAudio(t *testing.T) {
	t.Setenv("QINQIN_PACKS", "")
	t.Chdir(t.TempDir())
	if err := os.MkdirAll("plugins/data-local", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll("plugins/data-audio", 0o755); err != nil {
		t.Fatal(err)
	}
	want := []string{"plugins/data", "plugins/data-audio", "plugins/data-local"}
	if got := defaultPacks(); !reflect.DeepEqual(got, want) {
		t.Errorf("defaultPacks = %v, want %v", got, want)
	}
}

func TestDefaultPacksIncludesDataStrokes(t *testing.T) {
	t.Setenv("QINQIN_PACKS", "")
	t.Chdir(t.TempDir())
	if got, want := defaultPacks(), []string{"plugins/data"}; !reflect.DeepEqual(got, want) {
		t.Errorf("without plugins/data-strokes: defaultPacks = %v, want %v", got, want)
	}
	for _, d := range []string{"plugins/data-audio", "plugins/data-strokes", "plugins/data-local"} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{"plugins/data", "plugins/data-audio", "plugins/data-strokes", "plugins/data-local"}
	if got := defaultPacks(); !reflect.DeepEqual(got, want) {
		t.Errorf("defaultPacks = %v, want %v", got, want)
	}
}

func TestStalePackTermsWarnsOnAudioLicence(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	root := t.TempDir()
	dir := audioPackDir(t, root, "audio-test")
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{root}, &strings.Builder{}); err != nil {
		t.Fatal(err)
	}
	var rec logRecorder
	warnStalePackTerms(context.Background(), sqlDB, []string{root}, rec.logf)
	if len(rec.lines) != 0 {
		t.Fatalf("fresh seed: %q", rec.lines)
	}
	editManifest(t, dir, "license", "CC BY 4.0")
	warnStalePackTerms(context.Background(), sqlDB, []string{root}, rec.logf)
	if len(rec.lines) != 1 || !strings.Contains(rec.lines[0], "audio-test") {
		t.Errorf("after a licence change: %q, want one warning naming the pack", rec.lines)
	}
}
