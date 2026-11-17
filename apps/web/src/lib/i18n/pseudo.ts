// The test-only pseudo-locale en-XA (spec Ruling): every message wrapped in ⟦…⟧ and every ASCII letter accented,
// arguments, tags and plural structure kept. Tests generate it from en.json; it is never a shipped catalogue.
import { parseMessage, type Segment } from './message';

const LOWER = 'ȧƀƈḓḗƒɠħīĵķŀḿƞǿƥɋřşŧŭṽẇẋẏẑ';
const UPPER = 'ȦƁƇḒḖƑƓĦĪĴĶĿḾȠǾƤɊŘŞŦŬṼẆẊẎẐ';
const lower = Array.from(LOWER);
const upper = Array.from(UPPER);

/** Every ASCII letter replaced by an accented look-alike (one code point each). */
export function pseudoText(s: string): string {
	return s.replace(/[A-Za-z]/g, (c) => {
		const code = c.charCodeAt(0);
		return code >= 97 ? lower[code - 97] : upper[code - 65];
	});
}

function serialize(segments: Segment[]): string {
	return segments
		.map((s) => {
			if (s.type === 'text') return pseudoText(s.value);
			if (s.type === 'arg') return `{${s.name}}`;
			if (s.type === 'count') return '#';
			return `<${s.name}>${serialize(s.children)}</${s.name}>`;
		})
		.join('');
}

/** One pseudo message: the text accented and wrapped; plurals wrapped per branch. */
export function pseudoMessage(message: string): string {
	const p = parseMessage(message);
	if (p.plural === null) return message === '' ? '' : `⟦${serialize(p.segments)}⟧`;
	const branches = Object.entries(p.plural.branches)
		.map(([category, segments]) => `${category} {⟦${serialize(segments ?? [])}⟧}`)
		.join(' ');
	return `{${p.plural.arg}, plural, ${branches}}`;
}

/** The pseudo catalogue of a catalogue (same keys). */
export function pseudoCatalogue<T extends Record<string, string>>(catalogue: T): T {
	return Object.fromEntries(Object.entries(catalogue).map(([k, m]) => [k, pseudoMessage(m)])) as T;
}
