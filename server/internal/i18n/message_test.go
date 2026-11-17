package i18n_test

import (
	"errors"
	"reflect"
	"testing"

	"qinqin/internal/i18n"
)

// messages.json: the Go formatter renders the plain text (Go has no rich-text
// renderer, so parts are not decoded).
func TestMessagesFixture(t *testing.T) {
	var f struct {
		Cases []struct {
			Name    string         `json:"name"`
			Message string         `json:"message"`
			Locale  string         `json:"locale"`
			Args    map[string]any `json:"args"`
			Output  *string        `json:"output"`
			Error   string         `json:"error"`
		} `json:"cases"`
	}
	readContract(t, "messages.json", &f)
	if len(f.Cases) < 20 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	for _, c := range f.Cases {
		got, err := i18n.Format(c.Message, c.Locale, c.Args)
		if c.Error != "" {
			var me *i18n.MessageError
			if !errors.As(err, &me) || string(me.Kind) != c.Error {
				t.Errorf("%s: err %v, want %s", c.Name, err, c.Error)
			}
			continue
		}
		if err != nil || c.Output == nil || got != *c.Output {
			t.Errorf("%s: %q (%v), want %q", c.Name, got, err, deref(c.Output))
		}
	}
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

func TestInvalidMessagesFixture(t *testing.T) {
	var f struct {
		Cases []struct {
			Name    string `json:"name"`
			Message string `json:"message"`
			Error   string `json:"error"`
		} `json:"cases"`
	}
	readContract(t, "invalid-messages.json", &f)
	if len(f.Cases) < 15 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	for _, c := range f.Cases {
		_, err := i18n.Parse(c.Message)
		var me *i18n.MessageError
		if !errors.As(err, &me) || string(me.Kind) != c.Error {
			t.Errorf("%s: %q: err %v, want %s", c.Name, c.Message, err, c.Error)
		}
	}
}

func TestPluralCategoriesFixture(t *testing.T) {
	var f struct {
		Cases []struct {
			Name     string  `json:"name"`
			Locale   string  `json:"locale"`
			N        float64 `json:"n"`
			Category string  `json:"category"`
		} `json:"cases"`
	}
	readContract(t, "plural-categories.json", &f)
	if len(f.Cases) < 100 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	for _, c := range f.Cases {
		if got := i18n.PluralCategory(c.Locale, c.N); got != c.Category {
			t.Errorf("%s: %s, want %s", c.Name, got, c.Category)
		}
	}
}

func TestParsedShape(t *testing.T) {
	p, err := i18n.Parse("{n, plural, one {# in {deck}} other {# in {deck} by {who}}}")
	if err != nil {
		t.Fatal(err)
	}
	if !p.IsPlural() || !reflect.DeepEqual(p.Categories(), []string{"one", "other"}) {
		t.Errorf("plural %v categories %v", p.IsPlural(), p.Categories())
	}
	if got := p.Args(); !reflect.DeepEqual(got, map[string]bool{"n": true, "deck": true, "who": true}) {
		t.Errorf("args %v", got)
	}
	plain, _ := i18n.Parse("Open <link>{site}</link>")
	if plain.IsPlural() || !reflect.DeepEqual(plain.Args(), map[string]bool{"site": true}) {
		t.Errorf("plain: %v %v", plain.IsPlural(), plain.Args())
	}
	if s, err := i18n.Format("{n, plural, one {# hour} other {# hours}}", "en", map[string]any{"n": 2}); err != nil || s != "2 hours" {
		t.Errorf("int argument: %q %v", s, err)
	}
}
