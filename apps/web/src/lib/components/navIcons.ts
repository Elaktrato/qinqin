// Which glyph a shell navigation item shows. Pure, so the mapping is
// tested without rendering; NavIcon.svelte draws the glyphs.

export type NavIconName =
	| 'search'
	| 'map'
	| 'cards'
	| 'book'
	| 'books'
	| 'gear'
	| 'signout'
	| 'plugin';

// Keys are normalised (lower case, no `qinqin-` pack prefix).
const KNOWN = new Map<string, NavIconName>([
	['search', 'search'],
	['map', 'map'],
	['study', 'cards'],
	['flashcards', 'cards'],
	['cards', 'cards'],
	['reader', 'book'],
	['library', 'book'],
	['sources', 'books'],
	['settings', 'gear'],
	['signout', 'signout'],
	['sign out', 'signout'],
	['logout', 'signout']
]);

function lookup(key: string | undefined): NavIconName | undefined {
	if (!key) return undefined;
	const normal = key.trim().toLowerCase().replace(/^qinqin-/, '');
	return KNOWN.get(normal);
}

/**
 * iconFor picks the glyph for a nav item from its slug, else its title,
 * case-insensitively; anything unknown (a new plugin) gets the neutral
 * plugin glyph.
 */
export function iconFor(slug: string, title?: string): NavIconName {
	return lookup(slug) ?? lookup(title) ?? 'plugin';
}
