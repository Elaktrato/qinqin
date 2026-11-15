package ai

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

var fakeCreds = Credentials{APIKey: "sk-ant-fake-0000", Model: "claude-opus-5-5"}

func TestFakeReviewDeterministic(t *testing.T) {
	f := Fake{}
	req := ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "我喜欢苹果。你好吗？Hello world."}
	a, err := f.Review(context.Background(), fakeCreds, req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := f.Review(context.Background(), fakeCreds, req)
	if !reflect.DeepEqual(a, b) {
		t.Error("two reviews of the same input differ")
	}
	if len(a.Annotations) != 3 {
		t.Fatalf("annotations = %d, want one per sentence (3)", len(a.Annotations))
	}
	first := a.Annotations[0]
	if first.Quote != "我喜" || first.ContextBefore != "" || first.Correction != "喜我" || first.Category != "grammar" ||
		first.Explanation != "Fake explanation in en" {
		t.Errorf("first annotation = %+v", first)
	}
	second := a.Annotations[1]
	if second.Quote != "你好" || second.ContextBefore != "苹果。" {
		t.Errorf("second annotation = %+v", second)
	}
	if a.Overall.Summary != "Fake review (zh)" || len(a.Overall.Strengths) != 1 || len(a.Overall.Focus) != 1 {
		t.Errorf("overall = %+v", a.Overall)
	}
	if a.Model != "claude-opus-5-5" {
		t.Errorf("model = %q", a.Model)
	}
}

func TestFakeReviewPalindromeAndLimits(t *testing.T) {
	r, _ := Fake{}.Review(context.Background(), fakeCreds, ReviewRequest{Language: "en", ExplanationLanguage: "de", Text: "aa. b1. c2. d3. e4. f5. g6."})
	if len(r.Annotations) != 5 {
		t.Fatalf("annotations = %d, want at most 5", len(r.Annotations))
	}
	if r.Annotations[0].Quote != "aa" || r.Annotations[0].Correction != "aaX" {
		t.Errorf("palindrome annotation = %+v", r.Annotations[0])
	}
}

func TestFakeReviewMarkers(t *testing.T) {
	f := Fake{}
	errs := map[string]struct {
		is   error
		code string
	}{
		"[[fake:refusal]]": {ErrRefused, "refused"},
		"[[fake:busy]]":    {ErrBusy, "busy"},
		"[[fake:401]]":     {ErrKeyRejected, "key_rejected"},
		"[[fake:quota]]":   {ErrQuota, "quota"},
	}
	for marker, want := range errs {
		_, err := f.Review(context.Background(), fakeCreds, ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "你好吗。" + marker})
		if !errors.Is(err, want.is) {
			t.Errorf("%s: err = %v, want %v", marker, err, want.is)
		}
		if Code(err) != want.code {
			t.Errorf("%s: code = %q, want %q", marker, Code(err), want.code)
		}
	}
	_, err := f.Review(context.Background(), fakeCreds, ReviewRequest{Text: "x [[fake:busy]]"})
	var busy *BusyError
	if !errors.As(err, &busy) || busy.RetryAfter != 30*time.Second {
		t.Errorf("busy err = %#v, want RetryAfter 30s", err)
	}

	r, _ := f.Review(context.Background(), fakeCreds, ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "我喜欢苹果。[[fake:wrongscript]]"})
	for _, a := range r.Annotations {
		if a.Correction != "abc" {
			t.Errorf("wrongscript correction = %q", a.Correction)
		}
	}
	r, _ = f.Review(context.Background(), fakeCreds, ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "我喜欢苹果。[[fake:missingquote]]"})
	last := r.Annotations[len(r.Annotations)-1]
	if last.Quote != "不存在的" {
		t.Errorf("missingquote last annotation = %+v", last)
	}
	r, _ = f.Review(context.Background(), fakeCreds, ReviewRequest{Text: "我喜欢苹果。[[fake:fallback]]"})
	if r.Model != "claude-opus-5" {
		t.Errorf("fallback model = %q", r.Model)
	}
}

func TestFakeSlowHonoursContext(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := Fake{}.Review(ctx, fakeCreds, ReviewRequest{Text: "你好。[[fake:slow]]"})
	if err == nil || time.Since(start) > 5*time.Second {
		t.Errorf("slow review: err = %v after %v", err, time.Since(start))
	}
}

func TestFakeValidate(t *testing.T) {
	if err := (Fake{}).Validate(context.Background(), Credentials{APIKey: "sk-bad-key"}); !errors.Is(err, ErrKeyRejected) {
		t.Errorf("bad key: err = %v", err)
	}
	if err := (Fake{}).Validate(context.Background(), fakeCreds); err != nil {
		t.Errorf("good key: err = %v", err)
	}
}

func TestFakeSuggestAndTranscribe(t *testing.T) {
	s, err := Fake{}.Suggest(context.Background(), fakeCreds, SuggestRequest{Language: "zh", ExplanationLanguage: "en", Words: []string{"猫", "狗", "鱼"}})
	if err != nil || len(s.Items) != 3 {
		t.Fatalf("suggest = %+v, %v", s, err)
	}
	for i, it := range s.Items {
		if !strings.HasPrefix(it.Title, "Topic ") || it.Title != "Topic "+string(rune('1'+i)) {
			t.Errorf("title %q", it.Title)
		}
		if len(it.Words) < 1 || it.Words[len(it.Words)-1] != "捏造" {
			t.Errorf("item %d words = %v, want the invented word last", i, it.Words)
		}
		if len(it.Words) > 3 {
			t.Errorf("item %d has %d words", i, len(it.Words))
		}
	}
	if s.Items[0].Words[0] != "猫" {
		t.Errorf("first item words = %v", s.Items[0].Words)
	}
	tr, _ := Fake{}.Transcribe(context.Background(), fakeCreds, TranscribeRequest{Language: "ja", Image: make([]byte, 500), MediaType: "image/jpeg"})
	if tr.Text != "fake transcription" || tr.Unreadable {
		t.Errorf("transcribe = %+v", tr)
	}
	tr, _ = Fake{}.Transcribe(context.Background(), fakeCreds, TranscribeRequest{Image: make([]byte, 10)})
	if !tr.Unreadable {
		t.Error("tiny image should be unreadable")
	}
}

func TestCodeMapping(t *testing.T) {
	tests := []struct {
		err  error
		want string
	}{
		{ErrKeyRejected, "key_rejected"},
		{ErrQuota, "quota"},
		{ErrBusy, "busy"},
		{&BusyError{RetryAfter: time.Second}, "busy"},
		{ErrModelUnavailable, "model_unavailable"},
		{ErrRefused, "refused"},
		{ErrTruncated, "truncated"},
		{ErrBadReply, "bad_reply"},
		{ErrBadRequest, "bad_request"},
		{&RateLimitedError{RetryAfter: time.Minute}, "rate_limited"},
		{ErrInFlight, "in_flight"},
		{errors.Join(errors.New("x"), ErrQuota), "quota"},
		{wrapped(ErrKeyRejected), "key_rejected"},
		{wrapped(&BusyError{}), "busy"},
		{errors.New("boom"), ""},
		{nil, ""},
	}
	for _, tc := range tests {
		if got := Code(tc.err); got != tc.want {
			t.Errorf("Code(%v) = %q, want %q", tc.err, got, tc.want)
		}
	}
	if !errors.Is(&BusyError{}, ErrBusy) {
		t.Error("BusyError is not ErrBusy")
	}
}

func wrapped(err error) error { return errors.Join(errors.New("context"), err) }
