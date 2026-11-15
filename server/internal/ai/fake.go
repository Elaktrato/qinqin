package ai

import (
	"context"
	"strings"
	"time"
)

// Fake is a deterministic provider that never touches the network. It is
// chosen with QINQIN_AI_PROVIDER=fake and used by the tests and the real-app
// checks.
//
// Behaviour:
//   - Validate: an APIKey containing "bad" is ErrKeyRejected.
//   - Review: the markers [[fake:refusal]], [[fake:busy]] (30 s),
//     [[fake:401]], [[fake:quota]] return the matching error and
//     [[fake:slow]] sleeps 75 s (honouring ctx). Otherwise one annotation
//     per sentence (split on 。！？.!?, at most 5): Quote is the sentence's
//     first 2 runes, ContextBefore the 3 runes before it, Correction the
//     quote reversed (quote+"X" when that changes nothing), Explanation
//     "Fake explanation in <explanation language>", category grammar.
//     [[fake:wrongscript]] makes every correction "abc"; [[fake:missingquote]]
//     adds an annotation whose quote "不存在的" is not in the text;
//     [[fake:fallback]] answers as model "claude-opus-5".
//   - Suggest: three items "Topic 1".."Topic 3", each with up to 2 of the
//     given words and the invented word "捏造" (for validation to drop).
//   - Transcribe: "fake transcription"; unreadable below 100 bytes.
type Fake struct{}

func (Fake) Validate(_ context.Context, c Credentials) error {
	if strings.Contains(c.APIKey, "bad") {
		return ErrKeyRejected
	}
	return nil
}

func (Fake) Review(ctx context.Context, c Credentials, r ReviewRequest) (ReviewReply, error) {
	switch {
	case strings.Contains(r.Text, "[[fake:refusal]]"):
		return ReviewReply{}, ErrRefused
	case strings.Contains(r.Text, "[[fake:busy]]"):
		return ReviewReply{}, &BusyError{RetryAfter: 30 * time.Second}
	case strings.Contains(r.Text, "[[fake:401]]"):
		return ReviewReply{}, ErrKeyRejected
	case strings.Contains(r.Text, "[[fake:quota]]"):
		return ReviewReply{}, ErrQuota
	case strings.Contains(r.Text, "[[fake:slow]]"):
		select {
		case <-time.After(75 * time.Second):
		case <-ctx.Done():
			return ReviewReply{}, ctx.Err()
		}
	}
	wrongScript := strings.Contains(r.Text, "[[fake:wrongscript]]")

	runes := []rune(r.Text)
	var anns []RawAnnotation
	start := 0
	flush := func(end int) {
		for start < end && isSpace(runes[start]) {
			start++
		}
		sentence := runes[start:end]
		hasBody := false
		for _, ch := range sentence {
			if !strings.ContainsRune("。！？.!?", ch) && !isSpace(ch) {
				hasBody = true
			}
		}
		if hasBody && len(anns) < 5 {
			q := sentence
			if len(q) > 2 {
				q = q[:2]
			}
			ctxStart := start - 3
			if ctxStart < 0 {
				ctxStart = 0
			}
			quote := string(q)
			corr := reverse(quote)
			if corr == quote {
				corr = quote + "X"
			}
			if wrongScript {
				corr = "abc"
			}
			anns = append(anns, RawAnnotation{
				Quote:         quote,
				ContextBefore: string(runes[ctxStart:start]),
				Correction:    corr,
				Explanation:   "Fake explanation in " + r.ExplanationLanguage,
				Category:      "grammar",
			})
		}
		start = end
	}
	for i, ch := range runes {
		if strings.ContainsRune("。！？.!?", ch) {
			flush(i + 1)
		}
	}
	flush(len(runes))
	if strings.Contains(r.Text, "[[fake:missingquote]]") {
		corr := "不存在"
		if wrongScript {
			corr = "abc"
		}
		anns = append(anns, RawAnnotation{Quote: "不存在的", Correction: corr, Explanation: "Fake explanation in " + r.ExplanationLanguage, Category: "grammar"})
	}

	model := c.Model
	if strings.Contains(r.Text, "[[fake:fallback]]") {
		model = "claude-opus-5"
	}
	return ReviewReply{
		Annotations: anns,
		Overall:     Overall{Summary: "Fake review (" + r.Language + ")", Strengths: []string{"fake strength"}, Focus: []string{"fake focus"}},
		Model:       model,
	}, nil
}

func (Fake) Suggest(_ context.Context, c Credentials, r SuggestRequest) (SuggestReply, error) {
	var items []SuggestionItem
	for i := 0; i < 3; i++ {
		var words []string
		for j := i * 2; j < i*2+2 && j < len(r.Words); j++ {
			words = append(words, r.Words[j])
		}
		words = append(words, "捏造")
		items = append(items, SuggestionItem{
			Title:  "Topic " + string(rune('1'+i)),
			Prompt: "Fake prompt in " + r.ExplanationLanguage,
			Words:  words,
		})
	}
	return SuggestReply{Items: items, Model: c.Model}, nil
}

func (Fake) Transcribe(_ context.Context, c Credentials, r TranscribeRequest) (TranscribeReply, error) {
	return TranscribeReply{Text: "fake transcription", Unreadable: len(r.Image) < 100, Model: c.Model}, nil
}

func isSpace(r rune) bool { return r == ' ' || r == '\n' || r == '\t' || r == '\r' }

func reverse(s string) string {
	r := []rune(s)
	for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
		r[i], r[j] = r[j], r[i]
	}
	return string(r)
}
