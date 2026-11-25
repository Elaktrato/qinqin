// Character anatomy (#212): the parts a character is built from, each with its meaning, from data the app
// already has: the installed components packs (GET /api/components, #71) and the character universe's first
// gloss per character (GET /api/characters). No new data is bundled. Contract: docs/contracts/aids/.

export interface AnatomyPart {
	glyph: string;
	/** The part's first gloss when the dictionary has the part as a character, else null. */
	meaning: string | null;
	/** True for the part that is the character's Kangxi radical. */
	isRadical: boolean;
}

/** Parts shown at most (a pack lists up to 32 graphical elements; the first few are the structure). */
export const MAX_PARTS = 8;

/**
 * anatomyOf: the parts of one character in the pack's order, each once, without the character itself, at most
 * MAX_PARTS. `radical` (the character's radical, when known) marks the part it equals.
 */
export function anatomyOf(
	char: string,
	components: Readonly<Record<string, readonly string[]>>,
	meanings: ReadonlyMap<string, string>,
	radical?: string
): AnatomyPart[] {
	if ([...char].length !== 1) return [];
	const seen = new Set<string>();
	const out: AnatomyPart[] = [];
	for (const glyph of components[char] ?? []) {
		if (glyph === char || seen.has(glyph)) continue;
		seen.add(glyph);
		out.push({ glyph, meaning: meanings.get(glyph) ?? null, isRadical: radical !== undefined && glyph === radical });
		if (out.length === MAX_PARTS) break;
	}
	return out;
}

/** meaningIndex: character -> first gloss, from the universe rows (`c`, `m`). */
export function meaningIndex(rows: readonly { c: string; m?: string }[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const row of rows) if (row.m) out.set(row.c, row.m);
	return out;
}

export interface AnatomyDeps {
	/** The components index of the character's language. */
	components: () => Promise<{ chars: Record<string, string[]> }>;
	/** The character universe of the language. */
	universe: () => Promise<readonly { c: string; m?: string }[]>;
}

/**
 * loadAnatomy loads what anatomyOf needs. Each request settles on its own: without the universe the parts
 * show without meanings, without the components there is nothing to show (an empty list, never an error).
 */
export async function loadAnatomy(char: string, deps: AnatomyDeps, radical?: string): Promise<AnatomyPart[]> {
	const [components, universe] = await Promise.allSettled([deps.components(), deps.universe()]);
	if (components.status !== 'fulfilled') return [];
	const meanings = universe.status === 'fulfilled' ? meaningIndex(universe.value) : new Map<string, string>();
	return anatomyOf(char, components.value.chars, meanings, radical);
}
