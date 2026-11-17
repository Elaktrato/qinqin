package themes

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// fileCase is one case of docs/contracts/themes/theme-file.json.
type fileCase struct {
	Name   string          `json:"name"`
	File   json.RawMessage `json:"file"`
	PadTo  int             `json:"padTo"`
	Expect struct {
		OK      bool       `json:"ok"`
		IDs     []string   `json:"ids"`
		Accents [][]string `json:"accents"`
		Code    string     `json:"code"`
		Path    string     `json:"path"`
	} `json:"expect"`
}

// fileBytes is the file text a case describes: "$raw:<text>" verbatim, any
// other JSON value compact, then padded with spaces up to padTo bytes.
func fileBytes(t *testing.T, c fileCase) []byte {
	t.Helper()
	var s string
	var data []byte
	if json.Unmarshal(c.File, &s) == nil && strings.HasPrefix(s, "$raw:") {
		data = []byte(strings.TrimPrefix(s, "$raw:"))
	} else {
		var buf bytes.Buffer // compact, member order kept
		if err := json.Compact(&buf, c.File); err != nil {
			t.Fatal(err)
		}
		data = buf.Bytes()
	}
	if c.PadTo > 0 {
		if len(data) > c.PadTo {
			t.Fatalf("file of %d bytes is longer than padTo %d", len(data), c.PadTo)
		}
		data = append(data, strings.Repeat(" ", c.PadTo-len(data))...)
	}
	return data
}

func TestThemeFileContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/themes/theme-file.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Limits struct {
			MaxBytes          int `json:"maxBytes"`
			MaxThemes         int `json:"maxThemes"`
			MaxAccents        int `json:"maxAccents"`
			MaxIDBytes        int `json:"maxIdBytes"`
			MaxNameCodePoints int `json:"maxNameCodePoints"`
		} `json:"limits"`
		ColorKeys []string   `json:"colorKeys"`
		Cases     []fileCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Limits.MaxBytes != MaxFileBytes || doc.Limits.MaxThemes != MaxThemes || doc.Limits.MaxAccents != MaxAccents ||
		doc.Limits.MaxIDBytes != maxIDBytes || doc.Limits.MaxNameCodePoints != maxNameRunes {
		t.Errorf("limits %+v differ from the code", doc.Limits)
	}
	if strings.Join(doc.ColorKeys, ",") != strings.Join(ColorKeys, ",") {
		t.Errorf("colorKeys %v, code %v", doc.ColorKeys, ColorKeys)
	}
	if len(doc.Cases) < 40 {
		t.Fatalf("only %d cases", len(doc.Cases))
	}
	for _, c := range doc.Cases {
		t.Run(c.Name, func(t *testing.T) {
			got, err := ParseFile(fileBytes(t, c))
			if !c.Expect.OK {
				fe, ok := err.(*FileError)
				if !ok {
					t.Fatalf("ParseFile = %v, %v; want %s at %s", got, err, c.Expect.Code, c.Expect.Path)
				}
				if fe.Code != c.Expect.Code || fe.Path != c.Expect.Path {
					t.Fatalf("error %s at %s, want %s at %s", fe.Code, fe.Path, c.Expect.Code, c.Expect.Path)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseFile: %v", err)
			}
			var ids []string
			for i, th := range got {
				ids = append(ids, th.ID)
				if c.Expect.Accents != nil {
					var keys []string
					for _, a := range th.Accents {
						keys = append(keys, a.Key)
					}
					if strings.Join(keys, ",") != strings.Join(c.Expect.Accents[i], ",") {
						t.Errorf("theme %s accents %v, want %v", th.ID, keys, c.Expect.Accents[i])
					}
				}
			}
			if strings.Join(ids, ",") != strings.Join(c.Expect.IDs, ",") {
				t.Errorf("ids %v, want %v", ids, c.Expect.IDs)
			}
		})
	}
}

// A parsed theme writes back as the canonical file form: members in the
// contract's order, accents in file order, family omitted when empty; and
// that form parses to the same theme.
func TestThemeJSONRoundTrip(t *testing.T) {
	in := `[{"defaultAccent":"b","accents":{"z":"#000000","b":"#ffffff"},"colors":{"gradeEasy":"#0000ff","chrome":"#000000","panel":"#111111","raised":"#222222","line":"#333333","text":"#eeeeee","muted":"#aaaaaa","good":"#00ff00","warn":"#ffff00","bad":"#ff0000","gradeAgain":"#ff0000","gradeHard":"#ff8800","gradeGood":"#00ff00"},"scheme":"dark","name":"N","id":"n"}]`
	got, err := ParseFile([]byte(in))
	if err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(got[0])
	if err != nil {
		t.Fatal(err)
	}
	want := `{"id":"n","name":"N","scheme":"dark","colors":{"chrome":"#000000","panel":"#111111","raised":"#222222","line":"#333333","text":"#eeeeee","muted":"#aaaaaa","good":"#00ff00","warn":"#ffff00","bad":"#ff0000","gradeAgain":"#ff0000","gradeHard":"#ff8800","gradeGood":"#00ff00","gradeEasy":"#0000ff"},"accents":{"z":"#000000","b":"#ffffff"},"defaultAccent":"b"}`
	if string(out) != want {
		t.Fatalf("marshal\n got %s\nwant %s", out, want)
	}
	back, err := ParseTheme(out)
	if err != nil || back.ID != "n" || back.Accents[0].Key != "z" || back.Colors.GradeEasy != "#0000ff" {
		t.Fatalf("ParseTheme = %+v, %v", back, err)
	}
}
