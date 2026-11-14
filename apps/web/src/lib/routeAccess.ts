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
const OPEN: ReadonlySet<string> = new Set(['/sources']);

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

/**
 * redirectsOnUnauthorized is true when a 401 on this path must send the
 * user to /login. On the auth pages that would loop; on an open page the
 * user is quietly signed out and stays where they are.
 */
export function redirectsOnUnauthorized(path: string): boolean {
	return routeAccess(path) === 'private';
}
