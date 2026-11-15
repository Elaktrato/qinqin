// Routing inside /p/grammar: `rest` is what follows the slug.

export type GrammarRoute =
	| { view: 'browse' }
	| { view: 'lesson'; pack: string; lesson: string }
	| { view: 'practice'; pack: string; lesson: string };

export function parseGrammarRoute(rest: string): GrammarRoute {
	const parts = rest.split('/').filter((s) => s !== '');
	if (parts.length === 2) return { view: 'lesson', pack: parts[0], lesson: parts[1] };
	if (parts.length === 3 && parts[2] === 'practice') {
		return { view: 'practice', pack: parts[0], lesson: parts[1] };
	}
	return { view: 'browse' };
}

export function grammarHref(route: GrammarRoute): string {
	switch (route.view) {
		case 'browse':
			return '/p/grammar';
		case 'lesson':
			return `/p/grammar/${route.pack}/${route.lesson}`;
		case 'practice':
			return `/p/grammar/${route.pack}/${route.lesson}/practice`;
	}
}
