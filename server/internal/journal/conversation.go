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
	"unicode"
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
	// ErrReplyEmpty and ErrReplyLanguage refuse a partner reply (PartnerReply).
	ErrReplyEmpty    = errors.New("journal: the reply is empty")
	ErrReplyLanguage = errors.New("journal: the reply is not in the workspace language")
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
	// TurnID is the client's id of the turn that wrote the message; both
	// messages of a turn carry it.
	TurnID    string `json:"turnId"`
	CreatedAt string `json:"createdAt"`
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

// WordSample is what a turn may send of the studied words: the first
// ai.MaxConverseWords of the most recently reviewed ones (SuggestionInput),
// never the whole deck.
func WordSample(studied []string) []string {
	if len(studied) > ai.MaxConverseWords {
		return studied[:ai.MaxConverseWords]
	}
	return studied
}

// ConversationFull reports whether a learner turn (two messages) no longer fits.
func ConversationFull(c Conversation) bool { return len(c.Messages)+2 > MaxMessages }

// PartnerReply is the model's reply as stored: plain text, trimmed, cut to
// MaxReplyRunes. ErrReplyEmpty for an empty reply, ErrReplyLanguage for one
// that is not mostly written in the workspace language's script
// (ReplyFitsLanguage).
func PartnerReply(language, reply string) (string, error) {
	r := strings.TrimSpace(cutRunes(plainOnly(reply), MaxReplyRunes))
	switch {
	case r == "":
		return "", ErrReplyEmpty
	case !ReplyFitsLanguage(language, r):
		return "", ErrReplyLanguage
	}
	return r, nil
}

// ReplyFitsLanguage is the journal's script check (CorrectionFitsLanguage,
// the language profile) plus a majority: at least half of the reply's
// letters must be in the language's script, so a reply in English with one
// word of the language is refused. A language whose script the check does
// not know passes, as in CorrectionFitsLanguage.
func ReplyFitsLanguage(language, reply string) bool {
	if !CorrectionFitsLanguage(language, reply) {
		return false
	}
	inScript, letters := 0, 0
	for _, r := range reply {
		if !unicode.IsLetter(r) {
			continue
		}
		letters++
		if CorrectionFitsLanguage(language, string(r)) {
			inScript++
		}
	}
	return letters == 0 || 2*inScript >= letters
}

// TurnAnnotations validates the model's corrections of the learner's text
// with the journal's rules. AppendTurn gives them their ids.
func TurnAnnotations(text, language string, raw []ai.RawAnnotation) []Annotation {
	anns, _ := ResolveAnnotations(text, language, raw)
	if anns == nil {
		anns = []Annotation{}
	}
	return anns
}

// Transcript is the text of the entry a saved conversation becomes: one
// paragraph per message (separated by a blank line). Every line of a partner
// message is quoted with "> " (an empty line with ">"); a learner line that
// starts with ">" is escaped with a backslash ("\>"), so it never reads as the
// partner's. A transcript over an entry's MaxTextRunes, which only a
// pathological line structure reaches, is cut by SaveConversation.
func Transcript(c Conversation) string {
	parts := make([]string, 0, len(c.Messages))
	for _, m := range c.Messages {
		lines := strings.Split(m.Text, "\n")
		for i, l := range lines {
			switch {
			case m.Role == "partner" && l == "":
				lines[i] = ">"
			case m.Role == "partner":
				lines[i] = "> " + l
			case strings.HasPrefix(l, ">"):
				lines[i] = "\\" + l
			}
		}
		parts = append(parts, strings.Join(lines, "\n"))
	}
	return strings.Join(parts, "\n\n")
}

// HasTurn reports whether the conversation holds a message of the turn.
func HasTurn(c Conversation, turnID string) bool {
	for _, m := range c.Messages {
		if m.TurnID == turnID {
			return true
		}
	}
	return false
}

// takeWriteLock is a write statement that changes no row: run first in a
// transaction it takes SQLite's write lock, as BEGIN IMMEDIATE does (the
// pattern of pack.BeginWrite, #192).
const takeWriteLock = `UPDATE journal_conversations SET id = id WHERE 0`

// afterBegin, when set by a test of this package, runs right after
// beginWrite took the lock.
var afterBegin func(*sql.Tx)

// beginWrite begins a transaction that holds the write lock from the start.
// A deferred transaction that reads first takes a WAL snapshot; its first
// write then fails at once with SQLITE_BUSY_SNAPSHOT when another
// connection committed in between (a 500 after a paid AI call), and the busy
// timeout does not help. With the lock taken first the other writer waits.
func beginWrite(ctx context.Context, sqlDB *sql.DB) (*sql.Tx, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, takeWriteLock); err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("journal: take the write lock: %w", err)
	}
	if afterBegin != nil {
		afterBegin(tx)
	}
	return tx, nil
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
	rows, err := q.QueryContext(ctx, `SELECT seq, role, text, annotations, model, provider, turn_id, created_at FROM journal_messages
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
		if err := rows.Scan(&m.Seq, &m.Role, &m.Text, &anns, &m.Model, &m.Provider, &m.TurnID, &m.CreatedAt); err != nil {
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
	tx, err := beginWrite(ctx, sqlDB)
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
	if _, err := q.ExecContext(ctx, `INSERT INTO journal_messages (user_id, workspace_id, conversation_id, seq, role, text, annotations, model, provider, turn_id, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, userID, workspaceID, convID, m.Seq, m.Role, m.Text, string(b), m.Model, m.Provider, m.TurnID, m.CreatedAt); err != nil {
		return fmt.Errorf("journal: insert message: %w", err)
	}
	return nil
}

// AppendTurn stores one turn in one transaction that holds the write lock:
// the learner's message (nil when the partner opens) and the partner's reply,
// numbered after the last stored message, both marked with turnID. The
// learner's annotation ids are given here from the seq the message really
// gets ("m<seq>a<n>"), so a turn of another tab that landed first cannot make
// them collide. A turn id already stored (a retry) stores nothing and answers
// the conversation as it is. ErrNotFound when the conversation is gone
// (discarded while the AI answered), ErrConversationFull when the turn does
// not fit.
func AppendTurn(ctx context.Context, sqlDB *sql.DB, userID, workspaceID int64, id, turnID string, learner *Message, reply Message) (Conversation, error) {
	if !ValidEntryID(turnID) {
		return Conversation{}, invalid("turnId must be 1 to 64 letters, digits, '-' or '_'.")
	}
	tx, err := beginWrite(ctx, sqlDB)
	if err != nil {
		return Conversation{}, fmt.Errorf("journal: append turn: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	c, err := GetConversation(ctx, tx, userID, workspaceID, id)
	if err != nil {
		return Conversation{}, err
	}
	if HasTurn(c, turnID) {
		return c, nil
	}
	msgs := []Message{reply}
	if learner != nil {
		msgs = []Message{*learner, reply}
	}
	if len(c.Messages)+len(msgs) > MaxMessages {
		return Conversation{}, ErrConversationFull
	}
	last := 0
	for _, m := range c.Messages {
		last = max(last, m.Seq)
	}
	stamp := stampNow()
	if _, err := tx.ExecContext(ctx, `UPDATE journal_conversations SET updated_at = ? WHERE user_id = ? AND workspace_id = ? AND id = ?`, stamp, userID, workspaceID, id); err != nil {
		return Conversation{}, fmt.Errorf("journal: append turn: %w", err)
	}
	for i, m := range msgs {
		m.Seq, m.CreatedAt, m.TurnID = last+i+1, stamp, turnID
		anns := make([]Annotation, len(m.Annotations))
		for j, a := range m.Annotations {
			a.ID = fmt.Sprintf("m%da%d", m.Seq, j+1)
			anns[j] = a
		}
		m.Annotations = anns
		if err := insertMessage(ctx, tx, userID, workspaceID, id, m); err != nil {
			return Conversation{}, err
		}
	}
	out, err := GetConversation(ctx, tx, userID, workspaceID, id)
	if err != nil {
		return Conversation{}, err
	}
	return out, tx.Commit()
}

// SaveConversation turns a conversation into a journal entry (title = the
// topic, text = the transcript, source "typed") and deletes it, in one
// transaction. ErrNotFound when it is gone, ErrNothingToSave without
// messages, an InvalidError for a bad entry id or date.
func SaveConversation(ctx context.Context, sqlDB *sql.DB, userID, workspaceID int64, id, entryID, date string) (Entry, error) {
	tx, err := beginWrite(ctx, sqlDB)
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
	e, err := PutEntry(ctx, tx, userID, workspaceID, Entry{ID: entryID, Date: date, Title: c.Topic, Text: cutRunes(Transcript(c), MaxTextRunes), Source: "typed"})
	if err != nil {
		return Entry{}, err
	}
	if err := deleteConversationTx(ctx, tx, userID, workspaceID, id); err != nil {
		return Entry{}, err
	}
	return e, tx.Commit()
}

// maxModelRunes caps a stored model or provider name.
const maxModelRunes = 200

// validStored reports whether a conversation of a backup keeps the live
// rules: a valid id, topic and level; at most MaxMessages, numbered 1..n, the
// partner first and then learner and partner in turns (what turns write);
// texts within their caps; a partner message without annotations, a learner
// message without model and provider; every annotation as a turn stores it.
func validStored(c Conversation) bool {
	if !ValidEntryID(c.ID) || ValidateStart(c.Topic, c.Level) != nil || len(c.Messages) > MaxMessages {
		return false
	}
	for i, m := range c.Messages {
		role, limit := "learner", MaxMessageRunes
		if i%2 == 0 {
			role, limit = "partner", MaxReplyRunes
		}
		if m.Seq != i+1 || m.Role != role || !utf8.ValidString(m.Text) || !plainText(m.Text) || strings.TrimSpace(m.Text) == "" ||
			utf8.RuneCountInString(m.Text) > limit {
			return false
		}
		if role == "learner" && (m.Model != "" || m.Provider != "") {
			return false
		}
		if role == "partner" && (len(m.Annotations) > 0 || !shortPlain(m.Model) || !shortPlain(m.Provider)) {
			return false
		}
		for j, a := range m.Annotations {
			if a.ID != fmt.Sprintf("m%da%d", m.Seq, j+1) || a.Quote == "" || !strings.Contains(m.Text, a.Quote) ||
				(a.Kind != "mistake" && a.Kind != "suggestion") || !fieldOK(a.Correction, maxFieldRunes) ||
				!fieldOK(a.Explanation, maxFieldRunes) || !fieldOK(a.Category, 40) || !fieldOK(a.Prefix, contextRunes) || !fieldOK(a.Suffix, contextRunes) {
				return false
			}
		}
	}
	return true
}

func fieldOK(s string, n int) bool {
	return utf8.ValidString(s) && plainText(s) && utf8.RuneCountInString(s) <= n
}

func shortPlain(s string) bool {
	return fieldOK(s, maxModelRunes) && !strings.ContainsAny(s, "\n\r\t")
}

// turnIDs keeps the archive's turn ids when every turn's messages share one
// valid id and no two turns share it; otherwise every turn gets a new one.
func turnIDs(msgs []Message) []string {
	out := make([]string, len(msgs))
	turnOf := func(i int) int { return (i + 1) / 2 } // 0 the opening, then the pairs
	seen := map[string]int{}
	keep := true
	for i, m := range msgs {
		t := turnOf(i)
		if prev, ok := seen[m.TurnID]; !ValidEntryID(m.TurnID) || (ok && prev != t) || (i%2 == 0 && i > 0 && msgs[i-1].TurnID != m.TurnID) {
			keep = false
			break
		}
		seen[m.TurnID] = t
	}
	for i, m := range msgs {
		if keep {
			out[i] = m.TurnID
		} else {
			out[i] = fmt.Sprintf("restored-%d", turnOf(i))
		}
	}
	return out
}

// restoreConversation writes a conversation of a backup with its messages
// when it keeps the live rules (validStored) and the workspace has room
// (MaxConversations). ok is false for one refused, also for an id the
// workspace already holds (a duplicate row of the archive).
func restoreConversation(ctx context.Context, q Querier, userID, workspaceID int64, c Conversation) (bool, error) {
	if !validStored(c) {
		return false, nil
	}
	var open, dup int
	if err := q.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(id = ?3), 0) FROM journal_conversations
		WHERE user_id = ?1 AND workspace_id = ?2`, userID, workspaceID, c.ID).Scan(&open, &dup); err != nil {
		return false, fmt.Errorf("journal: restore conversation: %w", err)
	}
	if dup > 0 || open >= MaxConversations {
		return false, nil
	}
	created := stampOr(c.CreatedAt, stampNow())
	if _, err := q.ExecContext(ctx, `INSERT INTO journal_conversations (user_id, workspace_id, id, topic, level, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, userID, workspaceID, c.ID, c.Topic, c.Level, created, stampOr(c.UpdatedAt, created)); err != nil {
		return false, fmt.Errorf("journal: restore conversation: %w", err)
	}
	ids := turnIDs(c.Messages)
	for i, m := range c.Messages {
		m.CreatedAt, m.TurnID = stampOr(m.CreatedAt, created), ids[i]
		if err := insertMessage(ctx, q, userID, workspaceID, c.ID, m); err != nil {
			return false, err
		}
	}
	return true, nil
}
