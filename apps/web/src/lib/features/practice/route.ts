// The routes of /practice: the list of drills (`/practice`), a drill's round (`/practice/<drill>`), a drill's own
// weakest round (`/practice/<drill>/weakest`) and the round across drills (`/practice/weakest`). A drill that does
// not apply to the workspace, or any other path, is the list.

export type PracticeRoute =
	| { view: 'list' }
	| { view: 'drill'; drill: string }
	| { view: 'drillWeakest'; drill: string }
	| { view: 'weakest' };

export const WEAKEST = 'weakest';

/** parsePracticeRoute reads the path after `/practice/`; `available` are the ids of the drills that apply. */
export function parsePracticeRoute(rest: string, available: readonly string[]): PracticeRoute {
	const parts = rest.split('/').filter((p) => p !== '');
	if (parts.length === 1 && parts[0] === WEAKEST) return { view: 'weakest' };
	if (parts.length === 0 || parts.length > 2 || !available.includes(parts[0])) return { view: 'list' };
	if (parts.length === 1) return { view: 'drill', drill: parts[0] };
	return parts[1] === WEAKEST ? { view: 'drillWeakest', drill: parts[0] } : { view: 'list' };
}

export function practiceHref(route: PracticeRoute): string {
	if (route.view === 'weakest') return `/practice/${WEAKEST}`;
	if (route.view === 'drill') return `/practice/${route.drill}`;
	if (route.view === 'drillWeakest') return `/practice/${route.drill}/${WEAKEST}`;
	return '/practice';
}
