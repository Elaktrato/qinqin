// Routing inside /p/flashcards: `rest` is what follows the slug.

export type FlashcardsRoute =
	| { view: 'list' }
	| { view: 'deck'; deckId: string }
	| { view: 'settings'; deckId: string }
	| { view: 'system-level'; packId: string; level: string }
	| { view: 'system-plugin'; plugin: string; key: string };

const LIST: FlashcardsRoute = { view: 'list' };

/** Anything unknown or malformed is the list; segments are percent-decoded one by one. */
export function parseFlashcardsRoute(rest: string): FlashcardsRoute {
	let parts: string[];
	try {
		parts = rest
			.split('/')
			.filter((s) => s !== '')
			.map((s) => decodeURIComponent(s));
	} catch {
		return LIST;
	}
	if (parts.length === 2 && parts[0] === 'deck') return { view: 'deck', deckId: parts[1] };
	if (parts.length === 3 && parts[0] === 'deck' && parts[2] === 'settings') {
		return { view: 'settings', deckId: parts[1] };
	}
	if (parts.length === 4 && parts[0] === 'system' && parts[1] === 'level') {
		return { view: 'system-level', packId: parts[2], level: parts[3] };
	}
	if (parts.length === 4 && parts[0] === 'system' && parts[1] === 'plugin') {
		return { view: 'system-plugin', plugin: parts[2], key: parts[3] };
	}
	return LIST;
}

/**
 * The page receives SvelteKit's rest parameter, which is already percent-decoded:
 * encode its segments again so a name containing '%' is not decoded twice.
 */
export function parseDecodedFlashcardsRoute(rest: string): FlashcardsRoute {
	return parseFlashcardsRoute(
		rest
			.split('/')
			.map((segment) => encodeURIComponent(segment))
			.join('/')
	);
}

const enc = encodeURIComponent;

export function flashcardsHref(route: FlashcardsRoute): string {
	switch (route.view) {
		case 'list':
			return '/p/flashcards';
		case 'deck':
			return `/p/flashcards/deck/${enc(route.deckId)}`;
		case 'settings':
			return `/p/flashcards/deck/${enc(route.deckId)}/settings`;
		case 'system-level':
			return `/p/flashcards/system/level/${enc(route.packId)}/${enc(route.level)}`;
		case 'system-plugin':
			return `/p/flashcards/system/plugin/${enc(route.plugin)}/${enc(route.key)}`;
	}
}
