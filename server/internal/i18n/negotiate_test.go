package i18n_test

import (
	"reflect"
	"testing"

	"qinqin/internal/i18n"
)

func TestNegotiateFixture(t *testing.T) {
	var f struct {
		Cases []struct {
			Name       string   `json:"name"`
			Candidates []string `json:"candidates"`
			Supported  []string `json:"supported"`
			Result     string   `json:"result"`
		} `json:"cases"`
	}
	readContract(t, "negotiate.json", &f)
	if len(f.Cases) < 15 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	for _, c := range f.Cases {
		if got := i18n.Negotiate(c.Candidates, c.Supported); got != c.Result {
			t.Errorf("%s: %q, want %q", c.Name, got, c.Result)
		}
	}
}

func TestParseAcceptLanguage(t *testing.T) {
	for _, c := range []struct {
		header string
		want   []string
	}{
		{"", []string{}},
		{"de", []string{"de"}},
		{"fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5", []string{"fr-CH", "fr", "en", "de"}},
		{"en;q=0.5, ja", []string{"ja", "en"}},
		{"a-b;q=0.8, zh-TW;q=0.8, en;q=0.9", []string{"en", "a-b", "zh-TW"}},
		{"*", []string{}},
		{"de;q=0, en", []string{"en"}},
		{"de;q=abc, en;q=2, fr;q=-1, it", []string{"it"}},
		{"de; Q=0.4 ,en ; q=0.6", []string{"en", "de"}},
		{"en;level=1;q=0.3", []string{"en"}},
		{",,; ;, en_US, 12, toolongsubtag, en-", []string{}},
		{"zh-Hant-TW", []string{"zh-Hant-TW"}},
		{"es-419", []string{"es-419"}},
	} {
		got := i18n.ParseAcceptLanguage(c.header)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%q: %q, want %q", c.header, got, c.want)
		}
	}
}

func TestParseAcceptLanguageIsBounded(t *testing.T) {
	h := ""
	for i := 0; i < 500; i++ {
		h += "de;q=0.1,"
	}
	if got := i18n.ParseAcceptLanguage(h); len(got) > 32 {
		t.Errorf("%d entries", len(got))
	}
}

func TestPick(t *testing.T) {
	sup := []string{"en", "de", "zh-Hant"}
	for _, c := range []struct{ setting, header, want string }{
		{"", "", "en"},
		{"", "de-AT, en;q=0.5", "de"},
		{"", "fr", "en"},
		{"en", "de", "en"},
		{"zh-Hant", "de", "zh-Hant"},
		{"fr", "de", "en"},
		{"", "zh-TW", "zh-Hant"},
	} {
		if got := i18n.Pick(c.setting, c.header, sup); got != c.want {
			t.Errorf("Pick(%q, %q) = %q, want %q", c.setting, c.header, got, c.want)
		}
	}
}
