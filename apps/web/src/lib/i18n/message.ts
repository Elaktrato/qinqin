// The catalogue message syntax (issue #73, docs/contracts/i18n/README.md "Message syntax"): an ICU subset that
// converts one-to-one to Android resources. `{name}` arguments, a plural as the whole message (CLDR categories,
// `#` the formatted count), `<tag>…</tag>` rich-text spans, literal apostrophes. In-house on Intl (spec Ruling:
// no i18n dependency). Fixtures: messages.json, invalid-messages.json, plural-categories.json.

export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

export type MessageErrorKind =
	| 'select'
	| 'argType'
	| 'exactMatch'
	| 'nestedPlural'
	| 'partialPlural'
	| 'missingOther'
	| 'unknownCategory'
	| 'duplicateCategory'
	| 'unbalanced'
	| 'badArgName'
	| 'strayHash'
	| 'badTag'
	| 'nestedTag'
	| 'tagInPlural'
	| 'missingArg'
	| 'pluralNotNumber';

export class MessageError extends Error {
	readonly kind: MessageErrorKind;
	constructor(kind: MessageErrorKind, message: string, detail = '') {
		super(`${kind}${detail ? ` (${detail})` : ''} in message ${JSON.stringify(message)}`);
		this.name = 'MessageError';
		this.kind = kind;
	}
}

export type Segment =
	| { type: 'text'; value: string }
	| { type: 'arg'; name: string }
	| { type: 'count' }
	| { type: 'tag'; name: string; children: Segment[] };

export interface ParsedMessage {
	/** Segments of a non-plural message (empty for a plural). */
	segments: Segment[];
	/** The plural, when the whole message is one. */
	plural: { arg: string; branches: Partial<Record<PluralCategory, Segment[]>> } | null;
}

/** A formatted rich-text part: plain text, or the text inside one tag. */
export type Part = { text: string } | { tag: string; text: string };

export interface FormatOptions {
	/** `throw` (development, tests): a missing argument is a MessageError; `keep` (production): `{name}` stays. */
	missing?: 'throw' | 'keep';
}

const NAME = /^[a-z][a-zA-Z0-9]*$/;
const isCategory = (s: string): s is PluralCategory => (PLURAL_CATEGORIES as readonly string[]).includes(s);

class Parser {
	i = 0;
	constructor(readonly src: string) {}

	fail(kind: MessageErrorKind, detail = ''): never {
		throw new MessageError(kind, this.src, detail);
	}

	skipSpace(): void {
		while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i++;
	}

	/** At `{`: reads `name` and an optional `, type`; leaves `i` after the `}` or the type word. */
	argHeader(): { name: string; type: string | null } {
		const start = ++this.i;
		while (this.i < this.src.length && !'{},'.includes(this.src[this.i])) this.i++;
		if (this.i >= this.src.length || this.src[this.i] === '{') this.fail('unbalanced', 'unclosed argument');
		const raw = this.src.slice(start, this.i);
		const sep = this.src[this.i];
		this.i++;
		if (sep === '}') {
			if (!NAME.test(raw)) this.fail('badArgName', raw);
			return { name: raw, type: null };
		}
		const name = raw.trim();
		if (!NAME.test(name)) this.fail('badArgName', raw);
		this.skipSpace();
		const typeStart = this.i;
		while (this.i < this.src.length && /[a-zA-Z]/.test(this.src[this.i])) this.i++;
		return { name, type: this.src.slice(typeStart, this.i) };
	}

	/** Index after a valid `<name>` or `</name>` at `i`, or -1. */
	tagAt(): { name: string; closing: boolean; end: number } | null {
		const m = /^<(\/?)([a-z][a-zA-Z0-9]*)>/.exec(this.src.slice(this.i));
		return m ? { closing: m[1] === '/', name: m[2], end: this.i + m[0].length } : null;
	}

	/** A sequence until the end (top), a `}` (branch) or the closing tag (inside a tag). */
	sequence(ctx: { branch: boolean; tag: string | null }): Segment[] {
		const out: Segment[] = [];
		let text = '';
		const flush = () => {
			if (text) out.push({ type: 'text', value: text });
			text = '';
		};
		while (this.i < this.src.length) {
			const c = this.src[this.i];
			if (c === '{') {
				const at = this.i;
				const { name, type } = this.argHeader();
				if (type === null) {
					flush();
					out.push({ type: 'arg', name });
					continue;
				}
				if (type === 'plural') {
					if (ctx.branch) this.fail('nestedPlural');
					if (at !== 0 || ctx.tag !== null) this.fail('partialPlural');
					this.i = at;
					return [];
				}
				if (type === 'select') this.fail('select');
				this.fail('argType', type);
			}
			if (c === '}') {
				if (ctx.branch) {
					flush();
					return out;
				}
				this.fail('unbalanced', 'stray }');
			}
			if (c === '#') {
				if (!ctx.branch) this.fail('strayHash');
				flush();
				out.push({ type: 'count' });
				this.i++;
				continue;
			}
			if (c === '<') {
				const tag = this.tagAt();
				if (ctx.branch) this.fail(tag ? 'tagInPlural' : 'badTag');
				if (tag === null) this.fail('badTag');
				if (tag.closing) {
					if (tag.name !== ctx.tag) this.fail('badTag', `unexpected </${tag.name}>`);
					flush();
					this.i = tag.end;
					return out;
				}
				if (ctx.tag !== null) this.fail('nestedTag');
				flush();
				this.i = tag.end;
				const children = this.sequence({ branch: false, tag: tag.name });
				out.push({ type: 'tag', name: tag.name, children });
				continue;
			}
			text += c;
			this.i++;
		}
		if (ctx.branch) this.fail('unbalanced', 'unclosed branch');
		if (ctx.tag !== null) this.fail('badTag', `unclosed <${ctx.tag}>`);
		flush();
		return out;
	}

	/** The whole message as a plural (`i` = 0, at the `{`). */
	plural(): NonNullable<ParsedMessage['plural']> {
		const { name } = this.argHeader();
		this.skipSpace();
		if (this.src[this.i] !== ',') this.fail('unbalanced', 'expected , after plural');
		this.i++;
		const branches: Partial<Record<PluralCategory, Segment[]>> = {};
		for (;;) {
			this.skipSpace();
			if (this.i >= this.src.length) this.fail('unbalanced', 'unclosed plural');
			if (this.src[this.i] === '}') {
				this.i++;
				break;
			}
			const start = this.i;
			while (this.i < this.src.length && !/[\s{}]/.test(this.src[this.i])) this.i++;
			const selector = this.src.slice(start, this.i);
			if (selector.startsWith('=')) this.fail('exactMatch', selector);
			if (!isCategory(selector)) this.fail('unknownCategory', selector);
			if (branches[selector] !== undefined) this.fail('duplicateCategory', selector);
			this.skipSpace();
			if (this.src[this.i] !== '{') this.fail('unbalanced', `expected { after ${selector}`);
			this.i++;
			branches[selector] = this.sequence({ branch: true, tag: null });
			this.i++; // the branch's }
		}
		if (this.i !== this.src.length) this.fail('partialPlural');
		if (branches.other === undefined) this.fail('missingOther');
		return { arg: name, branches };
	}
}

const parsedCache = new Map<string, ParsedMessage>();

/** Parses a message (cached); throws a MessageError naming the kind for anything outside the subset. */
export function parseMessage(message: string): ParsedMessage {
	const hit = parsedCache.get(message);
	if (hit !== undefined) return hit;
	const p = new Parser(message);
	const segments = p.sequence({ branch: false, tag: null });
	const parsed: ParsedMessage = p.i === 0 && message.startsWith('{') && segments.length === 0 && message.length > 0
		? { segments: [], plural: p.plural() }
		: { segments, plural: null };
	parsedCache.set(message, parsed);
	return parsed;
}

function collect(segments: Segment[], args: Set<string>, tags: Set<string>): void {
	for (const s of segments) {
		if (s.type === 'arg') args.add(s.name);
		else if (s.type === 'tag') {
			tags.add(s.name);
			collect(s.children, args, tags);
		}
	}
}

/** Argument names, tag names (sorted) and plural categories (message order) — the catalogue parity check. */
export function messageShape(message: string | ParsedMessage): {
	args: string[];
	tags: string[];
	plural: boolean;
	categories: PluralCategory[];
} {
	const p = typeof message === 'string' ? parseMessage(message) : message;
	const args = new Set<string>();
	const tags = new Set<string>();
	collect(p.segments, args, tags);
	if (p.plural) {
		args.add(p.plural.arg);
		for (const b of Object.values(p.plural.branches)) collect(b ?? [], args, tags);
	}
	return {
		args: [...args].sort(),
		tags: [...tags].sort(),
		plural: p.plural !== null,
		categories: p.plural ? (Object.keys(p.plural.branches) as PluralCategory[]) : []
	};
}

const safeLocales = new Map<string, string>();
function safeLocale(locale: string): string {
	let s = safeLocales.get(locale);
	if (s === undefined) {
		try {
			s = Intl.getCanonicalLocales(locale)[0] ?? 'en';
		} catch {
			s = 'en';
		}
		safeLocales.set(locale, s);
	}
	return s;
}

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

/** The CLDR cardinal category of `n` in `locale` (an invalid locale counts as `en`). */
export function pluralCategory(locale: string, n: number): PluralCategory {
	const l = safeLocale(locale);
	let r = pluralRules.get(l);
	if (r === undefined) pluralRules.set(l, (r = new Intl.PluralRules(l)));
	return r.select(n) as PluralCategory;
}

function formatCount(locale: string, n: number): string {
	const l = safeLocale(locale);
	let f = numberFormats.get(l);
	if (f === undefined) numberFormats.set(l, (f = new Intl.NumberFormat(l)));
	return f.format(n);
}

type Args = Readonly<Record<string, string | number | undefined>>;

/** Rich-text parts of a formatted message: text and tag spans, adjacent text merged, empty text dropped. */
export function formatParts(
	message: string | ParsedMessage,
	locale: string,
	args: Args = {},
	opts: FormatOptions = {}
): Part[] {
	const raw = typeof message === 'string' ? message : '';
	const p = typeof message === 'string' ? parseMessage(message) : message;
	const strict = (opts.missing ?? 'throw') === 'throw';
	for (const name of messageShape(p).args)
		if (args[name] === undefined && strict) throw new MessageError('missingArg', raw, name);

	let segments = p.segments;
	let count = '';
	if (p.plural) {
		const v = args[p.plural.arg];
		const branches = p.plural.branches;
		if (typeof v === 'number' && Number.isFinite(v)) {
			segments = branches[pluralCategory(locale, v)] ?? branches.other ?? [];
			count = formatCount(locale, v);
		} else {
			if (strict) throw new MessageError('pluralNotNumber', raw, p.plural.arg);
			segments = branches.other ?? [];
			count = v === undefined ? `{${p.plural.arg}}` : String(v);
		}
	}

	const text = (s: Segment): string => {
		if (s.type === 'text') return s.value;
		if (s.type === 'count') return count;
		if (s.type === 'arg') {
			const v = args[s.name];
			return v === undefined ? `{${s.name}}` : String(v);
		}
		return s.children.map(text).join('');
	};
	const out: Part[] = [];
	for (const s of segments) {
		if (s.type === 'tag') {
			out.push({ tag: s.name, text: text(s) });
			continue;
		}
		const t = text(s);
		const last = out[out.length - 1];
		if (last !== undefined && !('tag' in last)) last.text += t;
		else if (t) out.push({ text: t });
	}
	return out.filter((x) => 'tag' in x || x.text !== '');
}

/** The plain text of a formatted message (a tag's content kept, the tag dropped). */
export function formatMessage(
	message: string | ParsedMessage,
	locale: string,
	args: Args = {},
	opts: FormatOptions = {}
): string {
	return formatParts(message, locale, args, opts)
		.map((x) => x.text)
		.join('');
}
