package api

import "qinqin/internal/auth"

// The two PATCH routes whose re-authentication depends on the change. The
// rule is pinned in docs/contracts/auth/admin-reauth.json, which the web app
// reads too, so a client asks for the password exactly when it is needed.

// userPatchChange is what a PATCH /api/admin/users/{id} changes.
type userPatchChange struct {
	Admin, Disabled *bool
	SetEmail        bool // email present: set or removed
}

// userPatchNeedsReauth: granting admin; setting or removing an address (a
// reset link goes there; on one's own account it would hand over the
// password this check asks for); demoting or disabling another
// administrator (taking the other administrators out of the way).
func userPatchNeedsReauth(targetAdmin, self bool, p userPatchChange) bool {
	switch {
	case p.Admin != nil && *p.Admin:
		return true
	case p.SetEmail:
		return true
	case targetAdmin && !self && ((p.Admin != nil && !*p.Admin) || (p.Disabled != nil && *p.Disabled)):
		return true
	}
	return false
}

var registrationRank = map[string]int{"closed": 0, "invite": 1, "open": 2}
var emailPolicyRank = map[string]int{"off": 0, "optional": 1, "required": 2}

// settingsPatchNeedsReauth: a change that lowers a protection (two-step
// enforcement off, sign-in by emailed code on, registration opened, the email
// policy lowered) or signs everyone else out. Tightening and no-op values do
// not; an unknown value is refused as invalid_setting anyway.
func settingsPatchNeedsReauth(cur auth.Settings, p auth.SettingsPatch, signOutOthers bool) bool {
	lower := func(rank map[string]int, from string, to *string, up bool) bool {
		if to == nil {
			return false
		}
		a, okA := rank[from]
		b, okB := rank[*to]
		if !okA || !okB {
			return false
		}
		if up {
			return b > a
		}
		return b < a
	}
	switch {
	case signOutOthers:
		return true
	case p.MFAEnforced != nil && !*p.MFAEnforced && cur.MFAEnforced:
		return true
	case p.EmailCodeLogin != nil && *p.EmailCodeLogin && !cur.EmailCodeLogin:
		return true
	case lower(registrationRank, cur.Registration, p.Registration, true):
		return true
	case lower(emailPolicyRank, cur.EmailPolicy, p.EmailPolicy, false):
		return true
	}
	return false
}
