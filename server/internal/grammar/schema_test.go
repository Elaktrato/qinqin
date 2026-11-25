package grammar_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/grammar"
	"qinqin/internal/pack"
)

// validJSON is the smallest valid lessons.json.
const validJSON = `{
  "levels": [{"id": "a1-1", "name": "A1", "schemeLevels": [{"scheme": "hsk-words", "level": "HSK 1"}]}],
  "lessons": [{
    "id": "shi", "level": "a1-1", "title": "T", "summary": "S",
    "pattern": ["A + 是 + B"], "body": ["Body."],
    "examples": [{"id": "shi-1", "text": "我是学生吗", "reading": "r", "translation": "tr",
      "focus": "吗", "distractors": ["很", "在"]}]
  }]
}`

func write(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "lessons.json"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestReadDataValid(t *testing.T) {
	d, err := grammar.ReadData(write(t, validJSON))
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Levels) != 1 || len(d.Lessons) != 1 || d.Lessons[0].Examples[0].Focus != "吗" {
		t.Errorf("data = %+v", d)
	}
	if d.Levels[0].SchemeLevels[0].Scheme != "hsk-words" {
		t.Errorf("schemeLevels = %+v", d.Levels[0].SchemeLevels)
	}
}

func TestNoOrder(t *testing.T) {
	// Present and true decodes.
	withFlag := strings.Replace(validJSON, `"focus": "吗"`, `"focus": "吗", "noOrder": true`, 1)
	d, err := grammar.ReadData(write(t, withFlag))
	if err != nil {
		t.Fatal(err)
	}
	if !d.Lessons[0].Examples[0].NoOrder {
		t.Errorf("NoOrder = false, want true")
	}
	// Absent means false.
	d, err = grammar.ReadData(write(t, validJSON))
	if err != nil {
		t.Fatal(err)
	}
	if d.Lessons[0].Examples[0].NoOrder {
		t.Errorf("NoOrder = true, want false when absent")
	}
}

func TestReadDataRules(t *testing.T) {
	long := func(n int) string { return strings.Repeat("字", n) }
	cases := []struct {
		name, old, new, want string
	}{
		{"no levels", `"levels": [{"id": "a1-1", "name": "A1", "schemeLevels": [{"scheme": "hsk-words", "level": "HSK 1"}]}]`, `"levels": []`, "levels"},
		{"bad level id", `"id": "a1-1"`, `"id": "A1_1"`, "levels[0].id"},
		{"empty level name", `"name": "A1"`, `"name": " "`, "levels[0].name"},
		{"lesson level unknown", `"level": "a1-1", "title"`, `"level": "zz", "title"`, "lessons[0].level"},
		{"bad lesson id", `"id": "shi", "level"`, `"id": "Shi", "level"`, "lessons[0].id"},
		{"title empty", `"title": "T"`, `"title": ""`, "lessons[0].title"},
		{"title long", `"title": "T"`, `"title": "` + long(121) + `"`, "lessons[0].title"},
		{"summary empty", `"summary": "S"`, `"summary": ""`, "lessons[0].summary"},
		{"summary long", `"summary": "S"`, `"summary": "` + long(301) + `"`, "lessons[0].summary"},
		{"pattern line long", `"pattern": ["A + 是 + B"]`, `"pattern": ["` + long(121) + `"]`, "lessons[0].pattern[0]"},
		{"pattern too many", `"pattern": ["A + 是 + B"]`, `"pattern": ["a","b","c","d","e","f"]`, "lessons[0].pattern"},
		{"body empty", `"body": ["Body."]`, `"body": []`, "lessons[0].body"},
		{"body long", `"body": ["Body."]`, `"body": ["` + long(2001) + `"]`, "lessons[0].body[0]"},
		{"no examples", `"examples": [{"id": "shi-1", "text": "我是学生吗", "reading": "r", "translation": "tr",
      "focus": "吗", "distractors": ["很", "在"]}]`, `"examples": []`, "lessons[0].examples"},
		{"example id bad", `"id": "shi-1"`, `"id": "Shi 1"`, "lessons[0].examples[0].id"},
		{"text empty", `"text": "我是学生吗"`, `"text": ""`, "lessons[0].examples[0].text"},
		{"text long", `"text": "我是学生吗"`, `"text": "` + long(501) + `"`, "lessons[0].examples[0].text"},
		{"translation empty", `"translation": "tr"`, `"translation": ""`, "lessons[0].examples[0].translation"},
		{"reading long", `"reading": "r"`, `"reading": "` + long(501) + `"`, "lessons[0].examples[0].reading"},
		{"focus missing in text", `"focus": "吗"`, `"focus": "呢"`, `lessons[0].examples[0].focus: "呢" does not occur in text`},
		{"too many distractors", `["很", "在"]`, `["a","b","c","d","e"]`, "lessons[0].examples[0].distractors"},
		{"empty distractor", `["很", "在"]`, `["很", ""]`, "lessons[0].examples[0].distractors[1]"},
		{"duplicate distractor", `["很", "在"]`, `["很", "很"]`, "lessons[0].examples[0].distractors[1]"},
		{"distractor equals focus", `["很", "在"]`, `["很", "吗"]`, "lessons[0].examples[0].distractors[1]"},
		{"distractor long", `["很", "在"]`, `["很", "` + long(121) + `"]`, "lessons[0].examples[0].distractors[1]"},
		{"unknown field", `"title": "T"`, `"title": "T", "extra": 1`, "extra"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if !strings.Contains(validJSON, c.old) {
				t.Fatalf("test bug: %q not in base", c.old)
			}
			_, err := grammar.ReadData(write(t, strings.Replace(validJSON, c.old, c.new, 1)))
			if err == nil {
				t.Fatal("want error")
			}
			if !errors.Is(err, pack.ErrInvalidPack) {
				t.Errorf("err = %v, want ErrInvalidPack", err)
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Errorf("err = %v, want it to contain %q", err, c.want)
			}
		})
	}
}

func TestReadDataDuplicates(t *testing.T) {
	twoLevels := strings.Replace(validJSON, `"levels": [`, `"levels": [{"id": "a1-1", "name": "dup"},`, 1)
	if _, err := grammar.ReadData(write(t, twoLevels)); err == nil || !strings.Contains(err.Error(), "levels[1].id") {
		t.Errorf("duplicate level id: %v", err)
	}
	lesson := `{"id": "shi", "level": "a1-1", "title": "T", "summary": "S", "body": ["B"],
	  "examples": [{"id": "%s", "text": "x", "translation": "y"}]}`
	two := strings.Replace(validJSON, `"lessons": [`, `"lessons": [`+strings.Replace(lesson, "%s", "other-1", 1)+`,`, 1)
	if _, err := grammar.ReadData(write(t, two)); err == nil || !strings.Contains(err.Error(), "lessons[1].id") {
		t.Errorf("duplicate lesson id: %v", err)
	}
	dupEx := strings.Replace(lesson, "shi", "other", 1)
	dupEx = strings.Replace(dupEx, "%s", "shi-1", 1)
	two = strings.Replace(validJSON, `"lessons": [`, `"lessons": [`+dupEx+`,`, 1)
	if _, err := grammar.ReadData(write(t, two)); err == nil || !strings.Contains(err.Error(), "examples[0].id") {
		t.Errorf("duplicate example id: %v", err)
	}
}

func TestReadDataCodePointLengths(t *testing.T) {
	// 120 four-byte runes are 480 bytes but 120 code points: valid.
	title := strings.Repeat("𠀀", 120)
	_, err := grammar.ReadData(write(t, strings.Replace(validJSON, `"title": "T"`, `"title": "`+title+`"`, 1)))
	if err != nil {
		t.Errorf("120 code points rejected: %v", err)
	}
}

func TestReadDataMissingAndMalformed(t *testing.T) {
	if _, err := grammar.ReadData(t.TempDir()); !errors.Is(err, pack.ErrInvalidPack) {
		t.Errorf("missing file err = %v", err)
	}
	if _, err := grammar.ReadData(write(t, `{`)); !errors.Is(err, pack.ErrInvalidPack) {
		t.Errorf("malformed err = %v", err)
	}
}

func TestManifestAcceptsGrammar(t *testing.T) {
	m := pack.Manifest{ID: "g", Name: "G", Version: "1", Type: "grammar", Language: "zh",
		License: "CC0-1.0", Attribution: "me", Format: "json"}
	if err := m.Validate(); err != nil {
		t.Errorf("Validate = %v", err)
	}
}

func TestReadDataRejectsTrailingJSON(t *testing.T) {
	for _, tail := range []string{" {}", "\n[1]", " garbage"} {
		_, err := grammar.ReadData(write(t, validJSON+tail))
		if !errors.Is(err, pack.ErrInvalidPack) || !strings.Contains(err.Error(), "trailing") {
			t.Errorf("tail %q: err = %v, want a trailing-data ErrInvalidPack", tail, err)
		}
	}
	if _, err := grammar.ReadData(write(t, validJSON+"\n\n")); err != nil {
		t.Errorf("trailing whitespace rejected: %v", err)
	}
}

func TestReadDataSizeCap(t *testing.T) {
	big := validJSON + strings.Repeat(" ", 4<<20)
	_, err := grammar.ReadData(write(t, big))
	if !errors.Is(err, pack.ErrInvalidPack) || !strings.Contains(err.Error(), "too large") {
		t.Errorf("err = %v, want a too-large ErrInvalidPack", err)
	}
}
