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

// lookalike folds a name to lowercase letters and digits, so "Open AI" and
// "open-ai" collide with the built-in "OpenAI".
func lookalike(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func checkName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n < 1 || n > 40 {
		return "", invalid("name must be 1 to 40 characters")
	}
	if strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return "", invalid("name must not contain control characters")
	}
	folded := lookalike(name)
	for _, b := range Builtins() {
		if folded == lookalike(b.ID) || folded == lookalike(b.Name) {
			return "", invalid("name is too close to the built-in provider %s", b.Name)
		}
	}
	return name, nil
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
	name, err := checkName(in.Name)
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
	existing, err := c.List(ctx)
	if err != nil {
		return ProviderSpec{}, err
	}
	for _, e := range existing {
		if strings.EqualFold(e.Name, name) {
			return ProviderSpec{}, invalid("an endpoint with this name exists")
		}
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
		_, err = c.DB.ExecContext(ctx, `INSERT INTO ai_custom_providers (id, name, base_url, default_model, vision, structured, max_output_tokens, key_required, created_by, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, name, u.String(), in.DefaultModel, b2i(in.Vision), string(in.Structured), max, b2i(in.KeyRequired), adminID, stamp(c.now()))
		if err != nil && strings.Contains(err.Error(), "UNIQUE") {
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
