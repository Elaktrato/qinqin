package ai

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const customIDPrefix = "custom-"

// ErrInvalidEndpoint wraps every refusal of a custom endpoint's fields
// (a blocked URL is ErrEndpointBlocked instead).
var ErrInvalidEndpoint = errors.New("ai: invalid custom endpoint")

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidEndpoint, fmt.Sprintf(format, a...))
}

// CustomInput creates an admin-registered OpenAI-compatible endpoint.
type CustomInput struct {
	Name, BaseURL, DefaultModel string
	Vision, KeyRequired         bool
	Structured                  Structured // empty means json_object
	MaxOutputTokens             *int
}

// CustomPatch changes the mutable fields; the URL, name and key-required
// flag are fixed at creation so an endpoint cannot be swapped under keys.
type CustomPatch struct {
	DefaultModel    *string
	Vision          *bool
	Structured      *Structured
	MaxOutputTokens *int
	// ClearMaxOutputTokens removes the cap (a JSON null in the PATCH body).
	ClearMaxOutputTokens bool
}

// CustomStore keeps the custom endpoints. Policy decides which URLs Create
// accepts (QINQIN_AI_ALLOW_PRIVATE).
type CustomStore struct {
	DB     *sql.DB
	Now    func() time.Time
	Policy GuardPolicy
}

const maxCustomTokens = 1_000_000

var idEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

func newCustomID() (string, error) {
	b := make([]byte, 7)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return customIDPrefix + strings.ToLower(idEncoding.EncodeToString(b))[:10], nil
}

// confusables maps letters that look like Latin ones (Cyrillic, Greek, small
// capitals, a few others) to the Latin letter, after lower-casing.
var confusables = map[rune]rune{
	'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's',
	'ԁ': 'd', 'һ': 'h', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b', 'ѵ': 'v', 'ԛ': 'q', 'ԝ': 'w',
	'α': 'a', 'ο': 'o', 'ν': 'v', 'ι': 'i', 'κ': 'k', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ε': 'e',
	'β': 'b', 'γ': 'y', 'η': 'n', 'μ': 'u', 'ϲ': 'c', 'ϳ': 'j',
	'ɡ': 'g', 'ɑ': 'a', 'ɩ': 'i', 'ᴏ': 'o', 'ᴀ': 'a', 'ɪ': 'i', 'ʀ': 'r', 'ᴅ': 'd', 'ᴇ': 'e', 'ᴍ': 'm', 'ᴛ': 't', 'ᴜ': 'u',
	'ı': 'i', 'ℓ': 'l', 'ǀ': 'l', 'ꓲ': 'l',
}

// foldName normalises a name for comparison: NFKC (fullwidth and compatibility
// forms), lower case, look-alike letters to Latin, and everything that is not
// a letter or digit dropped. tokens keeps the word boundaries.
func foldName(name string) (squashed string, tokens []string) {
	var cur, all strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			tokens = append(tokens, cur.String())
			cur.Reset()
		}
	}
	for _, r := range norm.NFKC.String(name) {
		r = unicode.ToLower(r)
		if m, ok := confusables[r]; ok {
			r = m
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			cur.WriteRune(r)
			all.WriteRune(r)
		} else {
			flush()
		}
	}
	flush()
	return all.String(), tokens
}

// brands may not appear in a custom endpoint's name: it could pose as the
// provider to collect keys. Short ones only count as a whole word.
var brands = []string{"openai", "anthropic", "gemini", "google", "deepseek", "mistral", "xai", "groq", "openrouter", "ollama", "chatgpt", "claude"}

func containsBrand(squashed string, tokens []string) bool {
	for _, b := range brands {
		if len(b) <= 3 {
			if squashed == b {
				return true
			}
			for _, t := range tokens {
				if t == b {
					return true
				}
			}
			continue
		}
		if strings.Contains(squashed, b) {
			return true
		}
	}
	return false
}

// checkName validates a name and returns it with its comparison key.
func checkName(name string) (string, string, error) {
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n < 1 || n > 40 {
		return "", "", invalid("name must be 1 to 40 characters")
	}
	for _, r := range name {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != ' ' && r != '-' && r != '_' && r != '.' {
			return "", "", invalid("name may contain letters, digits, spaces, - _ and . only")
		}
	}
	key, tokens := foldName(name)
	if key == "" {
		return "", "", invalid("name must contain a letter or digit")
	}
	if containsBrand(key, tokens) {
		return "", "", invalid("name must not contain the name of a built-in provider or a well-known AI brand")
	}
	for _, b := range Builtins() {
		bid, _ := foldName(b.ID)
		bname, _ := foldName(b.Name)
		if key == bid || key == bname {
			return "", "", invalid("name is too close to the built-in provider %s", b.Name)
		}
	}
	return name, key, nil
}

func checkTokens(n *int) error {
	if n != nil && (*n < 1 || *n > maxCustomTokens) {
		return invalid("max output tokens must be between 1 and %d", maxCustomTokens)
	}
	return nil
}

func (c *CustomStore) now() time.Time {
	if c.Now != nil {
		return c.Now().UTC()
	}
	return time.Now().UTC()
}

const customColumns = `id, name, base_url, default_model, vision, structured, max_output_tokens, key_required`

func scanCustom(s rowScanner) (ProviderSpec, error) {
	var sp ProviderSpec
	var vision, keyReq int
	var max sql.NullInt64
	var structured string
	if err := s.Scan(&sp.ID, &sp.Name, &sp.BaseURL, &sp.DefaultModel, &vision, &structured, &max, &keyReq); err != nil {
		return sp, err
	}
	sp.Kind, sp.Vision, sp.KeyRequired = KindOpenAI, vision != 0, keyReq != 0
	sp.Custom = true
	sp.Structured = Structured(structured)
	sp.Models = []ModelSpec{{ID: sp.DefaultModel, Label: sp.DefaultModel}}
	sp.TokenField = "max_tokens"
	sp.ValidateBy = "models"
	if max.Valid {
		sp.MaxOutputTokens = int(max.Int64)
	}
	return sp, nil
}

// Create registers an endpoint. A new id is drawn each time and never reused.
func (c *CustomStore) Create(ctx context.Context, adminID int64, in CustomInput) (ProviderSpec, error) {
	name, nameKey, err := checkName(in.Name)
	if err != nil {
		return ProviderSpec{}, err
	}
	u, err := CheckEndpointURL(in.BaseURL, c.Policy)
	if err != nil {
		return ProviderSpec{}, err
	}
	if !ValidModelID(in.DefaultModel) {
		return ProviderSpec{}, invalid("default model is not a valid model id")
	}
	if in.Structured == "" {
		in.Structured = StructuredObject
	}
	if !in.Structured.valid() {
		return ProviderSpec{}, invalid("structured mode must be json_schema, json_object or prompt")
	}
	if err := checkTokens(in.MaxOutputTokens); err != nil {
		return ProviderSpec{}, err
	}
	var max any
	if in.MaxOutputTokens != nil {
		max = *in.MaxOutputTokens
	}
	for attempt := 0; attempt < 5; attempt++ {
		id, err := newCustomID()
		if err != nil {
			return ProviderSpec{}, err
		}
		_, err = c.DB.ExecContext(ctx, `INSERT INTO ai_custom_providers (id, name, name_key, base_url, default_model, vision, structured, max_output_tokens, key_required, created_by, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, name, nameKey, u.String(), in.DefaultModel, b2i(in.Vision), string(in.Structured), max, b2i(in.KeyRequired), adminID, stamp(c.now()))
		if err != nil && strings.Contains(err.Error(), "UNIQUE") {
			if strings.Contains(err.Error(), "name_key") {
				return ProviderSpec{}, invalid("an endpoint with this name exists")
			}
			continue // an id collision: draw again
		}
		if err != nil {
			return ProviderSpec{}, err
		}
		return c.Get(ctx, id)
	}
	return ProviderSpec{}, errors.New("ai: could not draw a free custom id")
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// Update changes the mutable fields of an endpoint.
func (c *CustomStore) Update(ctx context.Context, id string, in CustomPatch) (ProviderSpec, error) {
	cur, err := c.Get(ctx, id)
	if err != nil {
		return ProviderSpec{}, err
	}
	if in.DefaultModel != nil {
		if !ValidModelID(*in.DefaultModel) {
			return ProviderSpec{}, invalid("default model is not a valid model id")
		}
		cur.DefaultModel = *in.DefaultModel
	}
	if in.Vision != nil {
		cur.Vision = *in.Vision
	}
	if in.Structured != nil {
		if !in.Structured.valid() {
			return ProviderSpec{}, invalid("structured mode must be json_schema, json_object or prompt")
		}
		cur.Structured = *in.Structured
	}
	if err := checkTokens(in.MaxOutputTokens); err != nil {
		return ProviderSpec{}, err
	}
	if in.MaxOutputTokens != nil {
		cur.MaxOutputTokens = *in.MaxOutputTokens
	}
	if in.ClearMaxOutputTokens {
		cur.MaxOutputTokens = 0
	}
	var max any
	if cur.MaxOutputTokens > 0 {
		max = cur.MaxOutputTokens
	}
	if _, err := c.DB.ExecContext(ctx, `UPDATE ai_custom_providers SET default_model = ?, vision = ?, structured = ?, max_output_tokens = ? WHERE id = ?`,
		cur.DefaultModel, b2i(cur.Vision), string(cur.Structured), max, id); err != nil {
		return ProviderSpec{}, err
	}
	return c.Get(ctx, id)
}

// Delete removes an endpoint; the caller removes its keys and selections.
func (c *CustomStore) Delete(ctx context.Context, id string) error {
	res, err := c.DB.ExecContext(ctx, `DELETE FROM ai_custom_providers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrUnknownProvider
	}
	return nil
}

// List returns every endpoint, oldest first.
func (c *CustomStore) List(ctx context.Context) ([]ProviderSpec, error) {
	rows, err := c.DB.QueryContext(ctx, `SELECT `+customColumns+` FROM ai_custom_providers ORDER BY created_at, rowid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProviderSpec
	for rows.Next() {
		sp, err := scanCustom(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sp)
	}
	return out, rows.Err()
}

// Get returns one endpoint, or ErrUnknownProvider.
func (c *CustomStore) Get(ctx context.Context, id string) (ProviderSpec, error) {
	sp, err := scanCustom(c.DB.QueryRowContext(ctx, `SELECT `+customColumns+` FROM ai_custom_providers WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return ProviderSpec{}, ErrUnknownProvider
	}
	return sp, err
}
