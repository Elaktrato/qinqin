// Checks behind catalogue.test.ts (test support, never imported by the app): non-en parity with en, the
// literal keys used in src/, and the call sites of t()/tParts()/<Msg>.
import { MessageError, messageShape, parseMessage } from './message';
import { tagEnd } from './lint';

type Catalogue = Readonly<Record<string, string>>;

/**
 * Problems of a translation against en: a key not in en, a message that does not parse, other argument or tag
 * names, plural-ness, and plural categories other than exactly those of `Intl.PluralRules(lang)`.
 */
export function parityProblems(lang: string, messages: Catalogue, en: Catalogue): string[] {
	const out: string[] = [];
	const expected = [...new Intl.PluralRules(lang).resolvedOptions().pluralCategories].sort();
	for (const key of Object.keys(messages).sort()) {
		if (!(key in en)) {
			out.push(`${key}: not in en`);
			continue;
		}
		let here;
		try {
			here = messageShape(parseMessage(messages[key]));
		} catch (e) {
			out.push(`${key}: does not parse (${e instanceof MessageError ? e.kind : String(e)})`);
			continue;
		}
		const base = messageShape(en[key]);
		if (base.args.join() !== here.args.join()) out.push(`${key}: arguments ${base.args.join()} != ${here.args.join()}`);
		if (base.tags.join() !== here.tags.join()) out.push(`${key}: tags ${base.tags.join()} != ${here.tags.join()}`);
		if (base.plural && !here.plural) out.push(`${key}: plural in en, not here`);
		else if (!base.plural && here.plural) out.push(`${key}: plural here, not in en`);
		else if (here.plural) {
			const got = [...here.categories].sort();
			if (got.join() !== expected.join()) out.push(`${key}: plural categories ${expected.join()} != ${got.join()}`);
		}
	}
	return out;
}

const LITERAL_KEY = /(['"`])([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)\1/g;

/** Every quoted string literal that looks like a catalogue key (typed maps count as use). */
export function literalKeys(text: string): Set<string> {
	return new Set([...text.matchAll(LITERAL_KEY)].map((m) => m[2]));
}

function lineAt(text: string, index: number): number {
	return text.slice(0, index).split('\n').length;
}

/** Index after the bracket matching the one at `i` (`(`, `{`, `[`), skipping quoted strings. */
function matchBracket(text: string, i: number): number {
	let depth = 0;
	for (let j = i; j < text.length; j++) {
		const c = text[j];
		if (c === "'" || c === '"' || c === '`') {
			const end = text.indexOf(c, j + 1);
			if (end < 0) return text.length;
			j = end;
			continue;
		}
		if ('({['.includes(c)) depth++;
		else if (')}]'.includes(c) && --depth === 0) return j + 1;
	}
	return text.length;
}

/** Property names of an object literal's body, or null when one is computed or spread. */
function objectNames(body: string): string[] | null {
	const names: string[] = [];
	let depth = 0;
	let start = 0;
	const entries: string[] = [];
	for (let j = 0; j <= body.length; j++) {
		const c = body[j];
		if (c === undefined || (c === ',' && depth === 0)) {
			entries.push(body.slice(start, j));
			start = j + 1;
		} else if ('({['.includes(c)) depth++;
		else if (')}]'.includes(c)) depth--;
	}
	for (const raw of entries) {
		const e = raw.trim();
		if (e === '') continue;
		const m = /^(?:(['"])?([A-Za-z_$][\w$]*)\1?)\s*(?::|$)/.exec(e);
		if (m === null) return null;
		names.push(m[2]);
	}
	return names.sort();
}

/** Argument names of the expression after a key: `{ … }` → names, nothing → [], anything else → null. */
function argNames(text: string, i: number): string[] | null {
	let j = i;
	while (/\s/.test(text[j] ?? '')) j++;
	if (text[j] === ')') return [];
	if (text[j] !== ',') return null;
	j++;
	while (/\s/.test(text[j] ?? '')) j++;
	if (text[j] !== '{') return null;
	const end = matchBracket(text, j);
	return objectNames(text.slice(j + 1, end - 1));
}

const CALL = /(?<![.\w$])(?:t|tParts)\(\s*(?:(['"])([^'"\n]+)\1|`)/g;
const MSG = /<Msg\b/g;

/** Unknown keys, argument names that differ from the message's, and dynamic (template-literal) keys. */
export function callSiteProblems(path: string, text: string, catalogue: Catalogue): string[] {
	const found: { index: number; problem: string }[] = [];
	const check = (index: number, key: string, names: string[] | null) => {
		const at = `${path}:${lineAt(text, index)}`;
		if (!(key in catalogue)) {
			found.push({ index, problem: `${at}: unknown key ${key}` });
			return;
		}
		if (names === null) return;
		const want = messageShape(catalogue[key]).args;
		if (names.join() !== want.join())
			found.push({ index, problem: `${at}: ${key} arguments ${names.join()} != ${want.join()}` });
	};
	for (const m of text.matchAll(CALL)) {
		const index = m.index ?? 0;
		if (m[2] === undefined) {
			found.push({ index, problem: `${path}:${lineAt(text, index)}: dynamic key` });
			continue;
		}
		check(index, m[2], argNames(text, index + m[0].length));
	}
	for (const m of text.matchAll(MSG)) {
		const index = m.index ?? 0;
		const tag = text.slice(index, tagEnd(text, index));
		if (/\bkey=\{\s*`/.test(tag)) {
			found.push({ index, problem: `${path}:${lineAt(text, index)}: dynamic key` });
			continue;
		}
		const key = /\bkey="([^"]+)"/.exec(tag)?.[1];
		if (key === undefined) continue;
		const a = /\bargs=\{/.exec(tag);
		let names: string[] | null = [];
		if (a !== null) {
			const open = a.index + a[0].length - 1;
			const inner = tag.slice(open + 1, matchBracket(tag, open) - 1).trim();
			names = inner.startsWith('{') && inner.endsWith('}') ? objectNames(inner.slice(1, -1)) : null;
		}
		check(index, key, names);
	}
	return found.sort((a, b) => a.index - b.index).map((f) => f.problem);
}
