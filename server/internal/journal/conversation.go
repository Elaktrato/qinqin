package journal

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"qinqin/internal/ai"
)

// The conversation partner (#185, docs/contracts/journal/conversations.json):
// a conversation is a draft of the journal. A turn appends the learner's
// message (with its corrections) and the partner's reply; saving turns it
// into an entry, discarding deletes it.

// Limits of a conversation (the contract's `limits`). 25 learner messages of
// MaxMessageRunes and 25 replies of MaxReplyRunes, with the transcript's
// separators, stay under an entry's MaxTextRunes.
const (
	MaxTopicRunes    = MaxTitleRunes
	MaxMessageRunes  = 1000
	MaxReplyRunes    = 800
	MaxMessages      = 50
	MaxConversations = 20
)

// Conversation errors.
var (
	ErrConversationFull  = errors.New("journal: the conversation is full")
	ErrConversationLimit = errors.New("journal: too many open conversations")
	ErrNothingToSave     = errors.New("journal: the conversation has no messages")
	ErrEmptyMessage      = errors.New("journal: the message is empty")
	ErrMessageTooLong    = errors.New("journal: the message is too long")
)

// Message is one message of a conversation; a partner message names the
// model and provider that wrote it.
type Message struct {
	Seq         int          `json:"seq"`
	Role        string       `json:"role"`
	Text        string       `json:"text"`
	Annotations []Annotation `json:"annotations"`
	Model       string       `json:"model,omitempty"`
	Provider    string       `json:"provider,omitempty"`
	CreatedAt   string       `json:"createdAt"`
}

// Conversation is a conversation with its messages in order.
type Conversation struct {
	ID        string    `json:"id"`
	Topic     string    `json:"topic"`
	Level     string    `json:"level"`
	CreatedAt string    `json:"createdAt"`
	UpdatedAt string    `json:"updatedAt"`
	Messages  []Message `json:"messages"`
}

// ConversationSummary is a conversation in the list, without its messages.
type ConversationSummary struct {
	ID           string `json:"id"`
	Topic        string `json:"topic"`
	Level        string `json:"level"`
	MessageCount int    `json:"messageCount"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

// NewConversationID returns a random id of 16 hex characters.
func NewConversationID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic("journal: no randomness: " + err.Error())
	}
	return "c" + hex.EncodeToString(b)
}

// ValidateStart checks the topic and the level of a new conversation.
func ValidateStart(topic, level string) error {
	switch {
	case !ai.ValidLevel(level):
		return invalid("level must be one of %s.", strings.Join(ai.ConverseLevels, ", "))
	case !utf8.ValidString(topic) || utf8.RuneCountInString(topic) > MaxTopicRunes || !plainText(topic):
		return invalid("topic must be plain text of at most %d characters.", MaxTopicRunes)
	}
	return nil
}

// CheckTurnText checks the learner's text of a turn: blank text opens a
// conversation without messages and is ErrEmptyMessage after that; longer
// than MaxMessageRunes is ErrMessageTooLong; control characters are an
// InvalidError.
func CheckTurnText(text string, hasMessages bool) error {
	switch {
	case strings.TrimSpace(text) == "":
		if hasMessages {
			return ErrEmptyMessage
		}
		return nil
	case !utf8.ValidString(text) || !plainText(text):
		return invalid("text must be plain text.")
	case utf8.RuneCountInString(text) > MaxMessageRunes:
		return ErrMessageTooLong
	}
	return nil
}

// TurnTextCode is the API error code of a CheckTurnText error ("" for none).
func TurnTextCode(err error) string {
	var inv *InvalidError
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ErrEmptyMessage):
		return "empty"
	case errors.Is(err, ErrMessageTooLong):
		return "too_long"
	case errors.As(err, &inv):
		return "bad_request"
	}
	return "internal"
}

// ConversationFull reports whether a learner turn (two messages) no longer fits.
func ConversationFull(c Conversation) bool { return len(c.Messages)+2 > MaxMessages }

// PartnerReply is the model's reply as stored: plain text, trimmed, cut to
// MaxReplyRunes. ok is false for an empty reply or one not written in the
// workspace language's script (CorrectionFitsLanguage, the language profile).
func PartnerReply(language, reply string) (string, bool) {
	r := cutRunes(plainOnly(reply), MaxReplyRunes)
	r = strings.TrimSpace(r)
	if r == "" || !CorrectionFitsLanguage(language, r) {
		return "", false
	}
	return r, true
}

// TurnAnnotations validates the model's corrections of the learner's text
// with the journal's rules and gives them ids unique in the conversation
// ("m<seq>a<n>").
func TurnAnnotations(text, language string, seq int, raw []ai.RawAnnotation) []Annotation {
	anns, _ := ResolveAnnotations(text, language, raw)
	out := make([]Annotation, 0, len(anns))
	for i, a := range anns {
		a.ID = fmt.Sprintf("m%da%d", seq, i+1)
		out = append(out, a)
	}
	return out
}

// Transcript is the text of the entry a saved conversation becomes: one
// paragraph per message, the partner's lines quoted with "> ".
func Transcript(c Conversation) string {
	parts := make([]string, 0, len(c.Messages))
	for _, m := range c.Messages {
		if m.Role == "partner" {
			parts = append(parts, "> "+m.Text)
		} else {
			parts = append(parts, m.Text)
		}
	}
	return strings.Join(parts, "\n\n")
}

// CreateConversation starts a conversation; ErrConversationLimit when the
// workspace already has MaxConversations (checked in the insert itself).
func CreateConversation(ctx context.Context, q Querier, userID, workspaceID int64, id, topic, level string) (Conversation, error) {
	if !ValidEntryID(id) {
		return Conversation{}, invalid("id must be 1 to 64 letters, digits, '-' or '_'.")
	}
	if err := ValidateStart(topic, level); err != nil {
		return Conversation{}, err
	}
	stamp := stampNow()
	res, err := q.ExecContext(ctx, `
		INSERT INTO journal_conversations (user_id, workspace_id, id, topic, level, created_at, updated_at)
		SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6
		WHERE (SELECT COUNT(*) FROM journal_conversations WHERE user_id = ?1 AND workspace_id = ?2) < ?7`,
		userID, workspaceID, id, strings.TrimSpace(topic), level, stamp, MaxConversations)
	if err != nil {
		return Conversation{}, fmt.Errorf("journal: create conversation: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return Conversation{}, err
	} else if n == 0 {
		return Conversation{}, ErrConversationLimit
	}
	return Conversation{ID: id, Topic: strings.TrimSpace(topic), Level: level, CreatedAt: stamp, UpdatedAt: stamp, Messages: []Message{}}, nil
}

// ListConversations returns the workspace's conversations, most recently
// updated first, without their messages.
func ListConversations(ctx context.Context, q Querier, userID, workspaceID int64) ([]ConversationSummary, error) {
	rows, err := q.QueryContext(ctx, `SELECT c.id, c.topic, c.level, c.created_at, c.updated_at,
		(SELECT COUNT(*) FROM journal_messages m WHERE m.user_id = c.user_id AND m.workspace_id = c.workspace_id AND m.conversation_id = c.id)
		FROM journal_conversations c WHERE c.user_id = ? AND c.workspace_id = ? ORDER BY c.updated_at DESC, c.id`, userID, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("journal: list conversations: %w", err)
	}
	defer rows.Close()
	out := []ConversationSummary{}
	for rows.Next() {
		var s ConversationSummary
		if err := rows.Scan(&s.ID, &s.Topic, &s.Level, &s.CreatedAt, &s.UpdatedAt, &s.MessageCount); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetConversation returns one conversation with its messages, or ErrNotFound.
func GetConversation(ctx context.Context, q Querier, userID, workspaceID int64, id string) (Conversation, error) {
	c := Conversation{Messages: []Message{}}
	err := q.QueryRowContext(ctx, `SELECT id, topic, level, created_at, updated_at FROM journal_conversations
		WHERE user_id = ? AND workspace_id = ? AND id = ?`, userID, workspaceID, id).Scan(&c.ID, &c.Topic, &c.Level, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Conversation{}, ErrNotFound
	}
	if err != nil {
		return Conversation{}, fmt.Errorf("journal: get conversation: %w", err)
	}
	rows, err := q.QueryContext(ctx, `SELECT seq, role, text, annotations, model, provider, created_at FROM journal_messages
		WHERE user_id = ? AND workspace_id = ? AND conversation_id = ? ORDER BY seq`, userID, workspaceID, id)
	if err != nil {
		return Conversation{}, fmt.Errorf("journal: get messages: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			m    Message
			anns string
		)
		if err := rows.Scan(&m.Seq, &m.Role, &m.Text, &anns, &m.Model, &m.Provider, &m.CreatedAt); err != nil {
			return Conversation{}, err
		}
		if err := json.Unmarshal([]byte(anns), &m.Annotations); err != nil {
			return Conversation{}, fmt.Errorf("journal: decode annotations: %w", err)
		}
		if m.Annotations == nil {
			m.Annotations = []Annotation{}
		}
		c.Messages = append(c.Messages, m)
	}
	return c, rows.Err()
}

func deleteConversationTx(ctx context.Context, q Querier, userID, workspaceID int64, id string) error {
	res, err := q.ExecContext(ctx, `DELETE FROM journal_conversations WHERE user_id = ? AND workspace_id = ? AND id = ?`, userID, workspaceID, id)
	if err != nil {
		return fmt.Errorf("journal: delete conversation: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return ErrNotFound
	}
	if _, err := q.ExecContext(ctx, `DELETE FROM journal_messages WHERE user_id = ? AND workspace_id = ? AND conversation_id = ?`, userID, workspaceID, id); err != nil {
		return fmt.Errorf("journal: delete messages: %w", err)
	}
	return nil
}

// DeleteConversation discards a conversation with its messages; a missing
// one is ErrNotFound.
func DeleteConversation(ctx context.Context, sqlDB *sql.DB, userID, workspaceID int64, id string) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("journal: delete conversation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := deleteConversationTx(ctx, tx, userID, workspaceID, id); err != nil {
		return err
	}
	return tx.Commit()
}

func insertMessage(ctx context.Context, q Querier, userID, workspaceID int64, convID string, m Message) error {
	anns := m.Annotations
	if anns == nil {
		anns = []Annotation{}
	}
	b, err := json.Marshal(anns)
	if err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `INSERT INTO journal_messages (user_id, workspace_id, conversation_id, seq, role, text, annotations, model, provider, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, userID, workspaceID, convID, m.Seq, m.Role, m.Text, string(b), m.Model, m.Provider, m.CreatedAt); err != nil {
		return fmt.Errorf("journal: insert message: %w", err)
	}
	return nil
}

// AppendTurn stores one turn in one transaction: the learner's message (nil
// when the partner opens) and the partner's reply, numbered after the last
// message. ErrNotFound when the conversation is gone (discarded while the AI
// answered), ErrConversationFull when the turn does not fit. Answers the
// conversation as stored.
func AppendTurn(ctx context.Context, sqlDB *sql.DB, userID, workspaceID int64, id string, learner *Message, reply Message) (Conversation, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Conversation{}, fmt.Errorf("journal: append turn: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var count, last int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(MAX(seq), 0) FROM journal_messages
		WHERE user_id = ? AND workspace_id = ? AND conversation_id = ?`, userID, workspaceID, id).Scan(&count, &last); err != nil {
		return Conversation{}, err
	}
	stamp := stampNow()
	res, err := tx.ExecContext(ctx, `UPDATE journal_conversations SET updated_at = ? WHERE user_id = ? AND workspace_id = ? AND id = ?`, stamp, userID, workspaceID, id)
	if err != nil {
		return Conversation{}, fmt.Errorf("journal: append turn: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return Conversation{}, err
	} else if n == 0 {
		return Conversation{}, ErrNotFound
	}
	msgs := []Message{reply}
	if learner != nil {
		msgs = []Message{*learner, reply}
	}
	if count+len(msgs) > MaxMessages {
		return Conversation{}, ErrConversationFull
	}
	for i, m := range msgs {
		m.Seq, m.CreatedAt = last+i+1, stamp
		if err := insertMessage(ctx, tx, userID, workspaceID, id, m); err != nil {
			return Conversation{}, err
		}
	}
	c, err := GetConversation(ctx, tx, userID, workspaceID, id)
	if err != nil {
		return Conversation{}, err
	}
	return c, tx.Commit()
}

// SaveConversation turns a conversation into a journal entry (title = the
// topic, text = the transcript, source "typed") and deletes it, in one
// transaction. ErrNotFound when it is gone, ErrNothingToSave without
// messages, an InvalidError for a bad entry id or date.
func SaveConversation(ctx context.Context, sqlDB *sql.DB, userID, workspaceID int64, id, entryID, date string) (Entry, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Entry{}, fmt.Errorf("journal: save conversation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	c, err := GetConversation(ctx, tx, userID, workspaceID, id)
	if err != nil {
		return Entry{}, err
	}
	if len(c.Messages) == 0 {
		return Entry{}, ErrNothingToSave
	}
	if _, err := GetEntry(ctx, tx, userID, workspaceID, entryID); err == nil {
		return Entry{}, invalid("an entry with this id exists.")
	} else if !errors.Is(err, ErrNotFound) {
		return Entry{}, err
	}
	e, err := PutEntry(ctx, tx, userID, workspaceID, Entry{ID: entryID, Date: date, Title: c.Topic, Text: Transcript(c), Source: "typed"})
	if err != nil {
		return Entry{}, err
	}
	if err := deleteConversationTx(ctx, tx, userID, workspaceID, id); err != nil {
		return Entry{}, err
	}
	return e, tx.Commit()
}

// restoreConversation writes a conversation of a backup with its messages,
// checked like a live one; ok is false for one the rules refuse.
func restoreConversation(ctx context.Context, q Querier, userID, workspaceID int64, c Conversation) (bool, error) {
	if !ValidEntryID(c.ID) || ValidateStart(c.Topic, c.Level) != nil || len(c.Messages) > MaxMessages {
		return false, nil
	}
	seen := map[int]bool{}
	for _, m := range c.Messages {
		limit := MaxMessageRunes
		if m.Role == "partner" {
			limit = MaxReplyRunes
		} else if m.Role != "learner" {
			return false, nil
		}
		if m.Seq < 1 || seen[m.Seq] || !utf8.ValidString(m.Text) || !plainText(m.Text) || utf8.RuneCountInString(m.Text) > limit {
			return false, nil
		}
		seen[m.Seq] = true
	}
	created := stampOr(c.CreatedAt, stampNow())
	if _, err := q.ExecContext(ctx, `INSERT INTO journal_conversations (user_id, workspace_id, id, topic, level, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, userID, workspaceID, c.ID, c.Topic, c.Level, created, stampOr(c.UpdatedAt, created)); err != nil {
		return false, fmt.Errorf("journal: restore conversation: %w", err)
	}
	for _, m := range c.Messages {
		m.CreatedAt = stampOr(m.CreatedAt, created)
		if err := insertMessage(ctx, q, userID, workspaceID, c.ID, m); err != nil {
			return false, err
		}
	}
	return true, nil
}
