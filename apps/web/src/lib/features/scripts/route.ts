// The routes of /scripts: the overview of a writing system (`/scripts`, `/scripts/hangul`) and a practice round
// (`/scripts/hangul/practice/recognise`). A name the language does not have falls back to its first system.

import { MODES, type Mode } from './types';

export type ScriptsRoute = { view: 'overview'; system: string } | { view: 'practice'; system: string; mode: Mode };

/** parseScriptsRoute reads the path after `/scripts/`; `available` are the system ids of the workspace's language. */
export function parseScriptsRoute(rest: string, available: readonly string[]): ScriptsRoute {
	const parts = rest.split('/').filter((p) => p !== '');
	const first = available[0] ?? '';
	const system = parts[0] !== undefined && available.includes(parts[0]) ? parts[0] : first;
	if (parts.length === 3 && parts[0] === system && parts[1] === 'practice' && (MODES as readonly string[]).includes(parts[2])) {
		return { view: 'practice', system, mode: parts[2] as Mode };
	}
	return { view: 'overview', system };
}

export function scriptsHref(route: ScriptsRoute | { view: 'home' }): string {
	if (route.view === 'home') return '/scripts';
	if (route.view === 'practice') return `/scripts/${route.system}/practice/${route.mode}`;
	return `/scripts/${route.system}`;
}
