package auth

import "qinqin/internal/model"

// Principal is an authenticated request: the user, the session it came
// in on, and how far that session may go.
type Principal struct {
	User      model.User
	SessionID int64
	Level     string // "full" or "enroll"

	// TemporarySession is true when the user must change the password and
	// this session was created after the change was forced (its id is above
	// the user's watermark): it came from the login with the temporary
	// password, so it may skip the current one. A session that existed
	// before the flag, or a flag with no watermark, is not.
	TemporarySession bool

	// Access token principals (SessionID is 0): the token's row id, its
	// scope ("read" or "write") and the one workspace it is limited to (nil:
	// all of the owner's). Only the API's token gate creates them.
	TokenID        int64
	TokenScope     string
	TokenWorkspace *int64
}

// ViaToken reports whether the request came in on a personal access token
// rather than a session.
func (p *Principal) ViaToken() bool { return p.TokenID != 0 }

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
