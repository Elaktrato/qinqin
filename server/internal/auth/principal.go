package auth

import "qinqin/internal/model"

// Principal is an authenticated request: the user, the session it came
// in on, and how far that session may go.
type Principal struct {
	User      model.User
	SessionID int64
	Level     string // "full" or "enroll"

	// SessionCreated and MustChangeSetAt (RFC 3339, "" when unset) let the
	// change-password route tell a session born from the temporary password
	// from one that existed before an admin set the flag.
	SessionCreated  string
	MustChangeSetAt string
}

// Restriction names why the session may not use the whole API: "" (no
// restriction), "password_change" or "mfa_enrollment". The temporary
// password goes first, so password_change wins.
func (p *Principal) Restriction() string {
	switch {
	case p.User.MustChangePassword:
		return "password_change"
	case p.Level == LevelEnroll:
		return "mfa_enrollment"
	}
	return ""
}
