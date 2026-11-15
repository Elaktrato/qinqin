package mail

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"time"

	"qinqin/internal/netguard"
	"qinqin/internal/secretbox"
)

// PasswordAAD binds the sealed SMTP password to its purpose.
const PasswordAAD = "qinqin/smtp/v1|password"

// Validation and state errors; the API maps each to its own code.
var (
	ErrInvalidHost        = errors.New("invalid host")
	ErrHostBlocked        = errors.New("host blocked")
	ErrInvalidPort        = errors.New("invalid port")
	ErrInvalidTLS         = errors.New("invalid tls mode")
	ErrCredentialsNeedTLS = errors.New("credentials need tls")
	ErrPasswordRequired   = errors.New("username needs a password")
	ErrInvalidFrom        = errors.New("invalid from address")
	ErrInvalidPublicURL   = errors.New("invalid public url")
	ErrReentryRequired    = errors.New("password must be entered again")
	ErrSecretUnavailable  = errors.New("QINQIN_SECRET unavailable")
	ErrNotConfigured      = errors.New("mail not configured")
)

// PasswordState is what a reader may learn about the stored password.
type PasswordState string

const (
	PasswordSet           PasswordState = "set"
	PasswordNone          PasswordState = "none"
	PasswordUndecryptable PasswordState = "undecryptable"
)

// Config is the SMTP configuration without its password: nothing in this
// struct can leak the secret, whatever formats it.
type Config struct {
	Host        string        `json:"host"`
	Port        int           `json:"port"`
	TLS         Mode          `json:"tls"`
	Username    string        `json:"username"`
	Password    PasswordState `json:"password"`
	FromAddress string        `json:"fromAddress"`
	FromName    string        `json:"fromName"`
	PublicURL   string        `json:"publicUrl"`
	UpdatedAt   string        `json:"updatedAt"`
}

// Site is the host of the public URL, named in every mail.
func (c Config) Site() string {
	u, err := url.Parse(c.PublicURL)
	if err != nil {
		return ""
	}
	return u.Host
}

// Input is a full settings object from the admin form. Password: nil keeps
// the stored one, "" clears it, anything else replaces it.
type Input struct {
	Config
	PasswordValue *string
}

// Prepared is a validated Input merged with the stored row; the effective
// password stays unexported.
type Prepared struct {
	Config
	password string
	changed  bool // the password changes with a save (replace or clear)
}

// Store keeps the one settings row.
type Store struct {
	DB       *sql.DB
	Current  *secretbox.Sealer // nil: no usable QINQIN_SECRET
	Previous *secretbox.Sealer
	Policy   netguard.GuardPolicy
	Now      func() time.Time
}

func (s *Store) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

type row struct {
	cfg   Config
	ct    []byte
	nonce []byte
	fp    string
}

func (s *Store) load(ctx context.Context) (*row, error) {
	var r row
	var ct, nonce []byte
	var fp sql.NullString
	var mode string
	err := s.DB.QueryRowContext(ctx, `SELECT host, port, tls_mode, username, password_ct, password_nonce, secret_fp,
		from_address, from_name, public_url, updated_at FROM smtp_settings WHERE id = 1`).
		Scan(&r.cfg.Host, &r.cfg.Port, &mode, &r.cfg.Username, &ct, &nonce, &fp, &r.cfg.FromAddress, &r.cfg.FromName, &r.cfg.PublicURL, &r.cfg.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load smtp settings: %w", err)
	}
	r.cfg.TLS = Mode(mode)
	r.ct, r.nonce, r.fp = ct, nonce, fp.String
	r.cfg.Password = PasswordNone
	if len(ct) > 0 {
		r.cfg.Password = PasswordSet
		if _, err := s.open(&r); err != nil {
			r.cfg.Password = PasswordUndecryptable
		}
	}
	return &r, nil
}

func (s *Store) open(r *row) (string, error) {
	for _, sl := range []*secretbox.Sealer{s.Current, s.Previous} {
		if sl != nil && sl.Fingerprint() == r.fp {
			plain, err := sl.Open(r.ct, r.nonce, PasswordAAD)
			if err != nil {
				return "", secretbox.ErrOpen
			}
			return string(plain), nil
		}
	}
	return "", secretbox.ErrOpen
}

// Load returns the stored configuration, nil when none is saved.
func (s *Store) Load(ctx context.Context) (*Config, error) {
	r, err := s.load(ctx)
	if err != nil || r == nil {
		return nil, err
	}
	return &r.cfg, nil
}

// Configured is the single predicate behind every "needs email" decision:
// the row has host, from address and public URL, and its password is absent
// or decryptable.
func (s *Store) Configured(ctx context.Context) bool {
	c, err := s.Load(ctx)
	return err == nil && c != nil && c.Host != "" && c.FromAddress != "" && c.PublicURL != "" && c.Password != PasswordUndecryptable
}

var hostLabel = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

func validHost(h string) bool {
	if h == "" || len(h) > 253 {
		return false
	}
	if strings.Contains(h, ":") {
		_, err := netip.ParseAddr(h)
		return err == nil
	}
	for _, l := range strings.Split(strings.TrimSuffix(h, "."), ".") {
		if !hostLabel.MatchString(l) {
			return false
		}
	}
	return true
}

// NormalisePublicURL returns the canonical public URL (no trailing slash)
// or ErrInvalidPublicURL: absolute http(s), a host, no userinfo, query or
// fragment, no path other than "/".
func NormalisePublicURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Hostname() == "" ||
		u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(raw, "#") ||
		(u.Path != "" && u.Path != "/") || u.Opaque != "" {
		return "", ErrInvalidPublicURL
	}
	for _, r := range u.Host {
		if r <= ' ' || r > '~' {
			return "", ErrInvalidPublicURL
		}
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), nil
}

// Prepare validates in and merges it with the stored row (password keep /
// clear / replace, the re-entry rule). It writes nothing.
func (s *Store) Prepare(ctx context.Context, in Input) (*Prepared, error) {
	c := in.Config
	c.Host = strings.ToLower(strings.TrimSpace(c.Host))
	c.Username = strings.TrimSpace(c.Username)
	c.FromName = strings.TrimSpace(c.FromName)
	switch {
	case !validHost(c.Host):
		return nil, ErrInvalidHost
	case netguard.CheckHost(c.Host, s.Policy) != nil:
		return nil, ErrHostBlocked
	case c.Port < 1 || c.Port > 65535:
		return nil, ErrInvalidPort
	case !c.TLS.Valid():
		return nil, ErrInvalidTLS
	case c.TLS == ModeNone && c.Username != "":
		return nil, ErrCredentialsNeedTLS
	}
	if strings.ContainsAny(c.Username, "\r\n\x00") || len(c.Username) > 256 || len([]rune(c.FromName)) > 100 || strings.ContainsAny(c.FromName, "\r\n\x00") {
		return nil, ErrInvalidHost
	}
	from, err := ValidAddress(strings.TrimSpace(c.FromAddress))
	if err != nil {
		return nil, ErrInvalidFrom
	}
	c.FromAddress = from
	if c.PublicURL, err = NormalisePublicURL(c.PublicURL); err != nil {
		return nil, err
	}
	stored, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	p := &Prepared{Config: c}
	switch {
	case in.PasswordValue != nil && *in.PasswordValue == "":
		p.changed = true // cleared
	case in.PasswordValue != nil:
		p.password, p.changed = *in.PasswordValue, true
	case stored != nil && stored.cfg.Password != PasswordNone:
		moved := stored.cfg.Host != c.Host || stored.cfg.Port != c.Port || stored.cfg.TLS != c.TLS || stored.cfg.Username != c.Username
		if moved || stored.cfg.Password == PasswordUndecryptable {
			return nil, ErrReentryRequired
		}
		if p.password, err = s.open(stored); err != nil {
			return nil, ErrReentryRequired
		}
	}
	if c.Username != "" && p.password == "" {
		return nil, ErrPasswordRequired
	}
	if p.password != "" && s.Current == nil {
		return nil, ErrSecretUnavailable
	}
	if p.password == "" {
		p.Config.Password = PasswordNone
	} else {
		p.Config.Password = PasswordSet
	}
	return p, nil
}

// PrepareStored returns the saved configuration as a Prepared (for a test
// mail without a draft).
func (s *Store) PrepareStored(ctx context.Context) (*Prepared, error) {
	r, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, ErrNotConfigured
	}
	p := &Prepared{Config: r.cfg}
	if r.cfg.Password == PasswordUndecryptable {
		return nil, ErrReentryRequired
	}
	if r.cfg.Password == PasswordSet {
		if p.password, err = s.open(r); err != nil {
			return nil, ErrReentryRequired
		}
	}
	return p, nil
}

// Save writes a prepared configuration.
func (s *Store) Save(ctx context.Context, p *Prepared, updatedBy int64) error {
	var ct, nonce []byte
	var fp any
	if p.password != "" {
		var err error
		if ct, nonce, err = s.Current.Seal([]byte(p.password), PasswordAAD); err != nil {
			return err
		}
		fp = s.Current.Fingerprint()
	}
	var by any
	if updatedBy != 0 {
		by = updatedBy
	}
	_, err := s.DB.ExecContext(ctx, `
		INSERT INTO smtp_settings (id, host, port, tls_mode, username, password_ct, password_nonce, secret_fp, from_address, from_name, public_url, updated_at, updated_by)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET host=excluded.host, port=excluded.port, tls_mode=excluded.tls_mode, username=excluded.username,
			password_ct=excluded.password_ct, password_nonce=excluded.password_nonce, secret_fp=excluded.secret_fp,
			from_address=excluded.from_address, from_name=excluded.from_name, public_url=excluded.public_url,
			updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
		p.Host, p.Port, string(p.TLS), p.Username, nullBytes(ct), nullBytes(nonce), fp, p.FromAddress, p.FromName, p.PublicURL,
		s.now().UTC().Format(time.RFC3339), by)
	if err != nil {
		return fmt.Errorf("save smtp settings: %w", err)
	}
	return nil
}

func nullBytes(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}

// Delete removes the configuration (mail-dependent features go inactive).
func (s *Store) Delete(ctx context.Context) error {
	if _, err := s.DB.ExecContext(ctx, `DELETE FROM smtp_settings WHERE id = 1`); err != nil {
		return fmt.Errorf("delete smtp settings: %w", err)
	}
	return nil
}

// Transport returns the transport of a prepared (draft or saved) configuration.
func (p *Prepared) Transport(policy netguard.GuardPolicy) Transport {
	return Transport{Host: p.Host, Port: p.Port, TLS: p.TLS, Username: p.Username, Password: p.password, Policy: policy}
}

// Stored returns the transport and configuration of the saved row.
func (s *Store) Stored(ctx context.Context) (Transport, *Config, error) {
	r, err := s.load(ctx)
	if err != nil || r == nil {
		return Transport{}, nil, err
	}
	t := Transport{Host: r.cfg.Host, Port: r.cfg.Port, TLS: r.cfg.TLS, Username: r.cfg.Username, Policy: s.Policy}
	if r.cfg.Password == PasswordSet {
		if t.Password, err = s.open(r); err != nil {
			return Transport{}, nil, err
		}
	}
	return t, &r.cfg, nil
}

// String redacts: formatting a Prepared (or its sibling values) never shows the password.
func (p Prepared) String() string { return "mail.Prepared{" + p.Host + "}" }

// GoString redacts too (%#v).
func (p Prepared) GoString() string { return p.String() }
