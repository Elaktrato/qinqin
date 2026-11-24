// Routing inside /journal: the part of the URL after it is the view.

export type JournalRoute =
	| { view: 'list' }
	| { view: 'new' }
	| { view: 'entry'; id: string }
	| { view: 'photo' }
	| { view: 'settings' };

const BASE = '/journal';
const list: JournalRoute = { view: 'list' };

function decode(part: string): string | null {
	try {
		return decodeURIComponent(part);
	} catch {
		return null;
	}
}

/** Maps the part after /journal to a view; unknown input is the list. */
export function parseJournalRoute(rest: string): JournalRoute {
	const parts = rest.split('/').filter((part) => part !== '');
	if (parts.length === 0) return list;
	if (parts.length === 1) {
		if (parts[0] === 'new') return { view: 'new' };
		if (parts[0] === 'photo') return { view: 'photo' };
		if (parts[0] === 'settings') return { view: 'settings' };
		return list;
	}
	if (parts.length === 2 && parts[0] === 'e') {
		const id = decode(parts[1]);
		return id ? { view: 'entry', id } : list;
	}
	return list;
}

export function journalHref(route: JournalRoute): string {
	switch (route.view) {
		case 'list':
			return BASE;
		case 'entry':
			return `${BASE}/e/${encodeURIComponent(route.id)}`;
		default:
			return `${BASE}/${route.view}`;
	}
}

/** The new-entry URL, optionally with a title to pre-fill (`?title=`). */
export function newEntryHref(title = ''): string {
	const t = title.trim();
	return t ? `${BASE}/new?title=${encodeURIComponent(t)}` : `${BASE}/new`;
}
