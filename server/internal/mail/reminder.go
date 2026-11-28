package mail

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"

	"qinqin/internal/i18n"
)

// ReminderItem is one line of a reminder mail: a kind ("due", "goal",
// "streak", "test") and its count (cards due, streak days; unused for "goal").
type ReminderItem struct {
	Kind  string
	Count int
}

// ReminderData is a reminder mail (#138): counts only, never card text.
type ReminderData struct {
	Site        string // host of the public URL; SendReminder fills it from the settings
	Link        string // where to study
	Unsubscribe string // the one-click unsubscribe link
	Items       []ReminderItem
	// Workspaces holds the own interface-language setting of each workspace
	// the reminder counts ("" = it uses the account's; #297). The mail is
	// written in their shared setting, else the account's (i18n.CommonSetting).
	Workspaces []string
}

var lineKey = map[string]Kind{"due": "reminder_due", "goal": "reminder_goal", "streak": "reminder_streak", "test": "reminder_test"}

// RenderReminder formats the reminder mail in lang (en when the language or a
// key is missing). The subject names no study data (lock screens show it).
func RenderReminder(lang string, d ReminderData) (Message, error) {
	if _, ok := catalogues[lang]; !ok {
		lang = "en"
	}
	var lines []string
	for _, it := range d.Items {
		k, ok := lineKey[it.Kind]
		if !ok {
			return Message{}, fmt.Errorf("mail: unknown reminder kind %q", it.Kind)
		}
		msg, ok := lookup(lang, catalogueKey(k, "body"))
		if !ok {
			return Message{}, fmt.Errorf("mail: no line for %q", it.Kind)
		}
		s, err := i18n.Format(msg, lang, map[string]any{"count": it.Count})
		if err != nil {
			return Message{}, fmt.Errorf("mail: reminder %s: %w", it.Kind, err)
		}
		lines = append(lines, s)
	}
	if len(lines) == 0 {
		return Message{}, errors.New("mail: a reminder needs at least one line")
	}
	return Render(KindReminder, lang, TemplateData{Site: d.Site, Link: d.Link, Unsubscribe: d.Unsubscribe, Lines: strings.Join(lines, "\n")})
}

// ErrCapped is SendReminder's refusal over the hourly cap (a missing
// configuration is ErrNotConfigured).
var ErrCapped = errors.New("mail: hourly cap reached")

// SendReminder renders and sends one reminder mail to `to` now (the caller is
// the scheduler, which has its own once-per-day rule), in the interface
// language its workspaces share (d.Workspaces), else the user's stored account
// setting (userID 0: English). It counts against the hourly cap; the address
// is never logged.
func (s *Service) SendReminder(ctx context.Context, userID int64, to string, d ReminderData) error {
	if s == nil || s.Store == nil {
		return ErrNotConfigured
	}
	t, cfg, err := s.Store.Stored(ctx)
	if err != nil || cfg == nil {
		return ErrNotConfigured
	}
	if !s.underCap(KindReminder) {
		s.logf("mail: dropped kind=%s user=%d reason=hourly_cap", KindReminder, userID)
		return ErrCapped
	}
	d.Site = cfg.Site()
	lang := Language(i18n.CommonSetting(s.accountSetting(ctx, userID), d.Workspaces), "")
	msg, err := RenderReminder(lang, d)
	if err != nil {
		s.logf("mail: failed kind=%s user=%d category=template", KindReminder, userID)
		return err
	}
	msg.To = to
	// RFC 8058 one-click needs an https URL; over an http public URL the
	// headers are left out and the body still carries the link.
	if strings.HasPrefix(d.Unsubscribe, "https://") {
		msg.ListUnsubscribe = d.Unsubscribe
	}
	raw, err := Compose(Sender{Address: cfg.FromAddress, Name: cfg.FromName}, msg, s.clock(), rand.Reader)
	if err != nil {
		s.logf("mail: failed kind=%s user=%d category=compose", KindReminder, userID)
		return err
	}
	if err := s.tune(t).Send(ctx, cfg.FromAddress, to, raw); err != nil {
		var se *SendError
		cat := "internal"
		if errors.As(err, &se) {
			cat = se.Category
		}
		s.logf("mail: failed kind=%s user=%d category=%s", KindReminder, userID, cat)
		return err
	}
	s.logf("mail: sent kind=%s user=%d", KindReminder, userID)
	return nil
}

// The unsubscribe page's texts (a page served by the API, not a mail).
const (
	PageAsk    Kind = "reminder_page_ask"
	PageButton Kind = "reminder_page_button"
	PageDone   Kind = "reminder_page_done"
)

// Line is one catalogue line (body part) of a reminder text kind in lang,
// falling back to English; empty when there is none.
func Line(lang string, k Kind) string {
	if _, ok := catalogues[lang]; !ok {
		lang = "en"
	}
	msg, _ := lookup(lang, catalogueKey(k, "body"))
	s, err := i18n.Format(msg, lang, map[string]any{})
	if err != nil {
		return msg
	}
	return s
}

// PublicURL is the configured public address (no trailing slash), "" when
// mail is not configured.
func (s *Service) PublicURL(ctx context.Context) string {
	if s == nil || s.Store == nil {
		return ""
	}
	_, cfg, err := s.Store.Stored(ctx)
	if err != nil || cfg == nil {
		return ""
	}
	return cfg.PublicURL
}
