// Who may see which route. Three kinds of path:
//
// - auth-only: the sign-in and register pages. Signed-out visitors only;
//   a signed-in user is sent home.
// - open: reachable signed in and signed out, never redirected. The
//   Sources page is open because licence and attribution credits must be
//   reachable by anyone the content is shown to.
// - private: everything else. Signed-in users only; a signed-out visitor
//   is sent to /login.
//
// Matching is exact after trailing slashes are dropped: `/sources/` is
// open, `/sources/anything` and `/sourcesx` are private (there are no
// subpages under /sources, so an unknown one gets no special treatment).

export type RouteAccess = 'auth-only' | 'open' | 'private';

const AUTH_ONLY: ReadonlySet<string> = new Set(['/login', '/register']);
// /reset is open: a signed-in person opening a reset link must not be bounced
// home; a successful reset replaces the stored token.
const OPEN: ReadonlySet<string> = new Set(['/sources', '/reset']);

/** normalizePath drops trailing slashes; the root stays `/`. */
export function normalizePath(path: string): string {
	return path.replace(/\/+$/, '') || '/';
}

/** routeAccess classifies a pathname. */
export function routeAccess(path: string): RouteAccess {
	const normalized = normalizePath(path);
	if (AUTH_ONLY.has(normalized)) return 'auth-only';
	if (OPEN.has(normalized)) return 'open';
	return 'private';
}

/**
 * allowed is true when the route may render for this session: protected
 * pages never flash while a redirect is in flight, and the auth pages do
 * not show once signed in. Nothing renders before the session has booted.
 */
export function allowed(path: string, signedIn: boolean, booted: boolean): boolean {
	if (!booted) return false;
	switch (routeAccess(path)) {
		case 'auth-only':
			return !signedIn;
		case 'open':
			return true;
		case 'private':
			return signedIn;
	}
}

/** redirectTarget is where the session must go from this path, or null to stay. */
export function redirectTarget(path: string, signedIn: boolean): '/' | '/login' | null {
	switch (routeAccess(path)) {
		case 'auth-only':
			return signedIn ? '/' : null;
		case 'open':
			return null;
		case 'private':
			return signedIn ? null : '/login';
	}
}

// Restricted sessions. A session that must change its password, or must
// enrol a second factor, may use exactly its own page and the open Sources
// page (credits must stay reachable); every other path sends it there. The
// server refuses everything else with 403 as well: this is only the
// friendly half of the gate.

export type SessionRestriction = 'password_change' | 'mfa_enrollment';

const RESTRICTED_HOME: Readonly<Record<SessionRestriction, string>> = {
	password_change: '/account/password',
	mfa_enrollment: '/account/two-factor-setup'
};

/**
 * restrictedTarget is where a restricted session must go from this path, or
 * null to stay (no restriction, its own page, or an open page).
 */
export function restrictedTarget(path: string, restriction: SessionRestriction | null): string | null {
	if (restriction === null) return null;
	const home = RESTRICTED_HOME[restriction];
	const normalized = normalizePath(path);
	if (normalized === home || routeAccess(normalized) === 'open') return null;
	return home;
}
