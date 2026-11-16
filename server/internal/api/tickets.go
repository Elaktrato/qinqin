package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

// Download tickets: a browser navigation cannot send the bearer token, so a
// download is a two-step: an authenticated POST issues a 128-bit single-use
// ticket (60 s), and the unauthenticated GET of its URL streams the file. A
// ticket is bound to a user and a kind, stored only as its SHA-256, in memory
// (a restart only invalidates pending downloads).
const ticketTTL = 60 * time.Second

type ticket struct {
	userID  int64
	kind    string
	expires time.Time
}

type ticketStore struct {
	mu sync.Mutex
	m  map[string]ticket // sha256 hex of the token -> ticket
}

func newTicketStore() *ticketStore { return &ticketStore{m: map[string]ticket{}} }

func hashTicket(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// issue creates a ticket for userID and kind valid for ttl from now and
// returns the token (never stored). Expired tickets are purged on the way.
func (ts *ticketStore) issue(userID int64, kind string, ttl time.Duration, now time.Time) string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("api: no randomness: " + err.Error())
	}
	token := hex.EncodeToString(b[:])
	ts.mu.Lock()
	defer ts.mu.Unlock()
	for k, t := range ts.m {
		if !now.Before(t.expires) {
			delete(ts.m, k)
		}
	}
	ts.m[hashTicket(token)] = ticket{userID: userID, kind: kind, expires: now.Add(ttl)}
	return token
}

// consume spends a ticket of the given kind. Unknown, used, expired and
// wrong-kind tickets are all refused alike; a wrong-kind attempt does not
// spend the ticket.
func (ts *ticketStore) consume(token, kind string, now time.Time) (userID int64, ok bool) {
	if token == "" {
		return 0, false
	}
	key := hashTicket(token)
	ts.mu.Lock()
	defer ts.mu.Unlock()
	t, found := ts.m[key]
	if !found || t.kind != kind {
		return 0, false
	}
	delete(ts.m, key)
	if !now.Before(t.expires) {
		return 0, false
	}
	return t.userID, true
}
