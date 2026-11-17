// The catalogue key scheme (docs/contracts/i18n/README.md "Keys"): `area.part.name`, 2–6 lower-camelCase
// segments, at most 120 characters, the first segment from a closed list (the README's list; a test pins both).

export const KEY_AREAS = [
	'app',
	'nav',
	'common',
	'auth',
	'account',
	'search',
	'entry',
	'study',
	'flashcards',
	'reader',
	'journal',
	'grammar',
	'stats',
	'weekly',
	'goals',
	'notes',
	'lookups',
	'settings',
	'admin',
	'sources',
	'packs',
	'pwa',
	'widgets',
	'plugin',
	'apiError',
	'format',
	'features',
	'milestones'
] as const;

export type KeyArea = (typeof KEY_AREAS)[number];

const SEGMENT = /^[a-z][a-zA-Z0-9]*$/;
export const MAX_KEY_LENGTH = 120;

/** What is wrong with a catalogue key (`segments`, `segment`, `area`, `length`), or null. */
export function keyProblem(key: string): 'segments' | 'segment' | 'area' | 'length' | null {
	const segments = key.split('.');
	if (segments.length < 2 || segments.length > 6) return 'segments';
	if (!segments.every((s) => SEGMENT.test(s))) return 'segment';
	if (!(KEY_AREAS as readonly string[]).includes(segments[0])) return 'area';
	if (key.length > MAX_KEY_LENGTH) return 'length';
	return null;
}
