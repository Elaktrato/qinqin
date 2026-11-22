package main

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// writeReports writes, into cfg.ReportDir, the build report of one
// language (filter counts, match rate, readings, sizes), the review list
// of words whose reading was left out, and a sample for a human review.
// None of them is part of the pack, and none carries a timestamp.
func writeReports(cfg buildConfig, res *langResult, packDir string) error {
	if err := os.MkdirAll(cfg.ReportDir, 0o755); err != nil {
		return err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Tatoeba sentences: %s (%s)\n", res.code, res.rules.PackID)
	fmt.Fprintf(&b, "export %s, rules SHA-256 %s, dictionary %s, max %d per word\n\n", cfg.Pin.ExportDate, cfg.Rules.sum, res.dict, cfg.Rules.MaxPerWord)
	fmt.Fprintf(&b, "sentences read (%s): %d\n", res.rules.Tatoeba, res.read)
	b.WriteString("dropped:\n")
	for _, step := range res.drops.order {
		fmt.Fprintf(&b, "  %s: %d\n", step, res.drops.n[step])
	}
	withReading := 0
	rows := 0
	for _, c := range res.bundled {
		if c.reading != "" {
			withReading++
		}
	}
	for _, g := range res.groups {
		rows += len(g.sentences)
	}
	fmt.Fprintf(&b, "\nbundled: %d sentences under %d words (%d sentence rows after import)\n", len(res.bundled), len(res.groups), rows)
	fmt.Fprintf(&b, "readings: %d of %d sentences (%s)\n", withReading, len(res.bundled), percent(withReading, len(res.bundled)))
	linked := len(res.seen) - len(res.unlinked)
	fmt.Fprintf(&b, "match rate: %d of %d distinct words in the filtered sentences link to a dictionary word entry (%s); %d matches were character entries, which the importer does not link\n",
		linked, len(res.seen), percent(linked, len(res.seen)), res.chars)
	if len(res.unlinked) > 0 {
		b.WriteString("most frequent words that do not link:\n")
		for i, w := range sortedReview(res.unlinked) {
			if i == 20 {
				break
			}
			fmt.Fprintf(&b, "  %s (%d)\n", w, res.unlinked[w])
		}
	}

	b.WriteString("\npack size (raw / gzip):\n")
	var raw, packed int64
	for _, name := range []string{"sentences.json", "credits.tsv", "manifest.json", "ATTRIBUTION.md", "LICENSE"} {
		data, err := os.ReadFile(filepath.Join(packDir, name))
		if err != nil {
			return err
		}
		gz := gzipSize(data)
		raw += int64(len(data))
		packed += gz
		fmt.Fprintf(&b, "  %s: %d / %d bytes\n", name, len(data), gz)
	}
	fmt.Fprintf(&b, "  total: %d / %d bytes; clone growth is about the gzip size, image growth the raw size\n", raw, packed)
	fmt.Fprintf(&b, "seed time: measure with `time qinqin seed --data <fresh dir> --packs plugins/data` against a seed without the pack\n")
	if err := os.WriteFile(filepath.Join(cfg.ReportDir, "report-"+res.code+".txt"), []byte(b.String()), 0o644); err != nil {
		return err
	}

	var rv strings.Builder
	rv.WriteString("count\tword\treadings\n")
	for _, line := range sortedReview(res.review) {
		fmt.Fprintf(&rv, "%d\t%s\n", res.review[line], line)
	}
	if err := os.WriteFile(filepath.Join(cfg.ReportDir, "review-"+res.code+".tsv"), []byte(rv.String()), 0o644); err != nil {
		return err
	}

	var sm strings.Builder
	sm.WriteString("id\ttext\treading\ttranslation\twords\n")
	step := 1
	if cfg.Rules.SampleSize > 0 && len(res.bundled) > cfg.Rules.SampleSize {
		step = len(res.bundled) / cfg.Rules.SampleSize
	}
	for i, n := 0, 0; i < len(res.bundled) && n < cfg.Rules.SampleSize; i, n = i+step, n+1 {
		c := res.bundled[i]
		fmt.Fprintf(&sm, "%d\t%s\t%s\t%s\t%s\n", c.s.ID, c.s.Text, c.reading, c.tr.Text, strings.Join(c.words, " "))
	}
	return os.WriteFile(filepath.Join(cfg.ReportDir, "sample-"+res.code+".tsv"), []byte(sm.String()), 0o644)
}

func percent(n, of int) string {
	if of == 0 {
		return "n/a"
	}
	return fmt.Sprintf("%.1f%%", 100*float64(n)/float64(of))
}

func gzipSize(data []byte) int64 {
	var buf bytes.Buffer
	w, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	w.Write(data)
	w.Close()
	return int64(buf.Len())
}
