package ai

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"qinqin/internal/ai/aitest"
)

func TestAdapterAgainstAitestFake(t *testing.T) {
	fake := &aitest.OpenAI{}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	rig := &oaRig{srv: srv}
	ad, sp := oaAdapterFor(rig, "custom-aaaaaaaaaa", nil)
	if err := ad.Validate(context.Background(), oaCreds(sp, "fake-model")); err != nil {
		t.Fatal(err)
	}
	rep, err := ad.Review(context.Background(), oaCreds(sp, "fake-model"), ReviewRequest{Language: "zh", ExplanationLanguage: "en", Text: "你好世界。"})
	if err != nil || len(rep.Annotations) != 1 || rep.Annotations[0].Quote != "你好" {
		t.Fatalf("review = %+v, %v", rep, err)
	}
	last := fake.Requests()[len(fake.Requests())-1]
	if last.Auth != "Bearer "+oaKey || !strings.Contains(string(last.Body), "entry_") {
		t.Errorf("fake saw %q / nonce tags missing", last.Auth)
	}
	if _, err := ad.Suggest(context.Background(), oaCreds(sp, "fake-model"), SuggestRequest{Language: "zh", ExplanationLanguage: "en"}); err != nil {
		t.Errorf("suggest: %v", err)
	}
	if _, err := ad.Transcribe(context.Background(), oaCreds(sp, "fake-model"), TranscribeRequest{Image: []byte("x"), MediaType: "image/jpeg"}); err != nil {
		t.Errorf("transcribe: %v", err)
	}
	bad := oaCreds(sp, "fake-model")
	bad.APIKey = "sk-fake-bad-key-0001xxxxx"
	if err := ad.Validate(context.Background(), bad); !errors.Is(err, ErrKeyRejected) {
		t.Errorf("bad key = %v", err)
	}
	if _, err := ad.Review(context.Background(), oaCreds(sp, ""), ReviewRequest{Text: "[[fake:refusal]]"}); !errors.Is(err, ErrRefused) {
		t.Errorf("refusal = %v", err)
	}
}
