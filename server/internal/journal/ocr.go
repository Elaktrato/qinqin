package journal

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"

	"qinqin/internal/lang"
)

// OCR reads the text of a photo offline.
type OCR interface {
	Available() bool
	HasLanguages(langs string) bool // every "+"-separated model installed
	Recognize(ctx context.Context, jpeg []byte, langs string) (string, error)
}

var (
	ErrOCRUnavailable     = errors.New("journal: offline OCR is not available")
	ErrOCRLanguageMissing = errors.New("journal: offline OCR has no model for that language")
	ErrOCRBusy            = errors.New("journal: offline OCR is busy")
)

// OCRLanguages returns the Tesseract models for a workspace language, or ""
// when there is no offline reading for it.
func OCRLanguages(workspaceLang string) string {
	switch {
	case workspaceLang == "zh":
		return "chi_sim+chi_tra"
	case workspaceLang == "ja":
		return "jpn"
	case lang.LatinLanguage(workspaceLang):
		return "eng"
	}
	return ""
}

const (
	ocrConcurrency = 2
	ocrTimeout     = 60 * time.Second
	ocrQueueWait   = 5 * time.Second
	ocrMaxOutput   = 1 << 20
)

var modelName = regexp.MustCompile(`^[A-Za-z0-9_]+$`)

// Tesseract runs the tesseract binary. There is no shell: the arguments are
// fixed, only the temp file path and the model list (checked against the
// installed models) vary. At most two processes run at once.
type Tesseract struct {
	path    string
	langs   map[string]bool
	sem     chan struct{}
	timeout time.Duration
	wait    time.Duration
}

// DetectTesseract asks "<path> --list-langs". A missing or broken binary
// yields a Tesseract whose Available is false; it never fails the server.
func DetectTesseract(ctx context.Context, path string) *Tesseract {
	t := &Tesseract{langs: map[string]bool{}, sem: make(chan struct{}, ocrConcurrency), timeout: ocrTimeout, wait: ocrQueueWait}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--list-langs")
	cmd.Env = tesseractEnv()
	cmd.WaitDelay = 2 * time.Second
	out, err := cmd.CombinedOutput()
	if err != nil {
		return t
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if modelName.MatchString(line) && !strings.HasPrefix(line, "List") {
			t.langs[line] = true
		}
	}
	if len(t.langs) > 0 {
		t.path = path
	}
	return t
}

// Languages lists the installed models, for the start-up log.
func (t *Tesseract) Languages() []string {
	if t == nil {
		return nil
	}
	var l []string
	for k := range t.langs {
		l = append(l, k)
	}
	slices.Sort(l)
	return l
}

func (t *Tesseract) Available() bool { return t != nil && t.path != "" }

func (t *Tesseract) HasLanguages(langs string) bool {
	if !t.Available() || langs == "" {
		return false
	}
	for _, m := range strings.Split(langs, "+") {
		if !t.langs[m] {
			return false
		}
	}
	return true
}

// tesseractEnv is the whole environment of the child: one OpenMP thread, and
// TESSDATA_PREFIX when the operator set it.
func tesseractEnv() []string {
	env := []string{"OMP_THREAD_LIMIT=1"}
	if v := os.Getenv("TESSDATA_PREFIX"); v != "" {
		env = append(env, "TESSDATA_PREFIX="+v)
	}
	return env
}

type capBuffer struct {
	bytes.Buffer
}

func (b *capBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > ocrMaxOutput {
		return 0, errors.New("journal: OCR output too large")
	}
	return b.Buffer.Write(p)
}

// Recognize reads one JPEG with the given models ("chi_sim+chi_tra").
func (t *Tesseract) Recognize(ctx context.Context, jpeg []byte, langs string) (string, error) {
	if !t.Available() {
		return "", ErrOCRUnavailable
	}
	if !t.HasLanguages(langs) {
		return "", ErrOCRLanguageMissing
	}
	timer := time.NewTimer(t.wait)
	defer timer.Stop()
	select {
	case t.sem <- struct{}{}:
		defer func() { <-t.sem }()
	case <-timer.C:
		return "", ErrOCRBusy
	case <-ctx.Done():
		return "", ctx.Err()
	}
	f, err := os.CreateTemp(os.TempDir(), "qinqin-ocr-*.jpg")
	if err != nil {
		return "", err
	}
	defer os.Remove(f.Name())
	if _, err := f.Write(jpeg); err != nil {
		f.Close()
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()
	var out capBuffer
	cmd := exec.CommandContext(ctx, t.path, f.Name(), "stdout", "-l", langs, "--psm", "3")
	cmd.Env = tesseractEnv()
	cmd.Stdout = &out
	cmd.WaitDelay = 2 * time.Second
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", errors.New("journal: tesseract failed")
	}
	return joinCJKSpaces(strings.TrimSpace(out.String())), nil
}

// isCJK reports whether r is written without spaces between words: Han, kana,
// Hangul and the CJK and fullwidth punctuation.
func isCJK(r rune) bool {
	return unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) ||
		(r >= 0x3000 && r <= 0x303F) || (r >= 0xFF00 && r <= 0xFFEF)
}

// joinCJKSpaces removes the spaces Tesseract's Chinese and Japanese models put
// between characters ("我 今 天") while keeping spaces next to Latin text.
func joinCJKSpaces(s string) string {
	rs := []rune(s)
	out := make([]rune, 0, len(rs))
	for i, r := range rs {
		if (r == ' ' || r == '\t') && len(out) > 0 && i+1 < len(rs) {
			next := i + 1
			for next < len(rs) && (rs[next] == ' ' || rs[next] == '\t') {
				next++
			}
			if next < len(rs) && isCJK(out[len(out)-1]) && isCJK(rs[next]) {
				continue
			}
		}
		out = append(out, r)
	}
	return string(out)
}
