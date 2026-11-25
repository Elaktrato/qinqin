package reminders

import (
	"encoding/base64"
	"testing"

	"qinqin/internal/secretbox"
)

type tokenFixture struct {
	Secret string `json:"secretBase64"`
	Valid  []struct {
		UserID int64  `json:"userId"`
		Token  string `json:"token"`
	} `json:"valid"`
	Invalid []struct {
		Name  string `json:"name"`
		Token string `json:"token"`
	} `json:"invalid"`
}

func TestUnsubscribeTokenFixture(t *testing.T) {
	var f tokenFixture
	readFixture(t, "unsubscribe.json", &f)
	raw, err := base64.StdEncoding.DecodeString(f.Secret)
	if err != nil {
		t.Fatal(err)
	}
	cur := secretbox.NewSealer(raw)
	for _, v := range f.Valid {
		if got := UnsubscribeToken(cur, v.UserID); got != v.Token {
			t.Errorf("token(%d) = %q, want %q", v.UserID, got, v.Token)
		}
		if id, ok := VerifyUnsubscribeToken(v.Token, cur, nil); !ok || id != v.UserID {
			t.Errorf("verify %q = %d %v", v.Token, id, ok)
		}
	}
	for _, v := range f.Invalid {
		if _, ok := VerifyUnsubscribeToken(v.Token, cur, nil); ok {
			t.Errorf("%s: accepted %q", v.Name, v.Token)
		}
	}
}

func TestUnsubscribeTokenRotation(t *testing.T) {
	old := secretbox.NewSealer(make([]byte, 32))
	cur := secretbox.NewSealer(append(make([]byte, 31), 1))
	tok := UnsubscribeToken(old, 7)
	if _, ok := VerifyUnsubscribeToken(tok, cur, nil); ok {
		t.Fatal("another secret must not verify")
	}
	if id, ok := VerifyUnsubscribeToken(tok, cur, old); !ok || id != 7 {
		t.Fatal("the previous secret must verify")
	}
	if _, ok := VerifyUnsubscribeToken(tok, nil, nil); ok {
		t.Fatal("no secret must not verify")
	}
}
