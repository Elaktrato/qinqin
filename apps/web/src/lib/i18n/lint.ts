// Heuristics of the hard-coded-string lint (issue #73, spec "Lint against new hard-coded strings"). Test and
// dev-script code only: hardcoded.test.ts walks src/ with them, scripts/i18n-inventory.mjs counts with them.
// A heuristic, not an AST analysis (spec Ruling): it catches the common case at near-zero cost; the allowlist
// is reviewed in diffs. Plain erasable TypeScript only, so Node can run it with type stripping.

export interface Finding {
	line: number;
	text: string;
}

interface Hit extends Finding {
	index: number;
}

interface Lit {
	index: number;
	text: string;
}

const PLACEHOLDER = '{…}';
/** A catalogue key (`area.part.name`): a literal like that is a `t()` argument, never interface text. */
const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const LINT_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label']);

const letterCount = (s: string): number => (s.split(PLACEHOLDER).join('').match(/\p{L}/gu) ?? []).length;
const hasLetters = (s: string): boolean => letterCount(s) >= 2;

/** Capital first letter, a space, two or more words with letters. */
/** SVG path data (`M12 22 L88 22`): commands and numbers only. */
const isPathData = (t: string): boolean => /^[MLHVCSQTAZ][\d\s.,MLHVCSQTAZmlhvcsqtaz-]*$/.test(t) && /\d/.test(t);

function isSentence(s: string): boolean {
	const t = s.trim();
	if (!/^\p{Lu}/u.test(t) || !/\s/.test(t) || isPathData(t)) return false;
	return t.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length >= 2;
}

const blank = (s: string): string => s.replace(/[^\n]/g, ' ');

function lineAt(src: string, index: number): number {
	let n = 1;
	for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') n++;
	return n;
}

/** The markup of a .svelte file: `<script>`, `<style>` and HTML comments blanked, positions kept. */
export function markupOnly(src: string): string {
	return src
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, blank)
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, blank)
		.replace(/<!--[\s\S]*?-->/g, blank);
}

/** Only the contents of the `<script>` blocks of a .svelte file, everything else blanked, positions kept. */
export function scriptOnly(src: string): string {
	let out = '';
	let last = 0;
	for (const m of src.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/g)) {
		const start = (m.index ?? 0) + m[1].length;
		out += blank(src.slice(last, start)) + m[2];
		last = start + m[2].length;
	}
	return out + blank(src.slice(last));
}

const REGEX_BEFORE = /[(,=:[!&|?{};+\-*%<>~^]/;
const REGEX_KEYWORD = /\b(?:return|typeof|case|yield|in|of|delete|void|throw)$/;

/** Index after the quoted string starting at `i` (`'` or `"`), and its value; a newline ends it. */
function readQuoted(code: string, i: number, to: number): [number, string] {
	const q = code[i];
	let j = i + 1;
	let v = '';
	while (j < to && code[j] !== q && code[j] !== '\n') {
		if (code[j] === '\\') {
			v += code[j + 1] ?? '';
			j += 2;
			continue;
		}
		v += code[j];
		j++;
	}
	return [j + 1, v];
}

/** Index after the `}` matching the `{` at `i`, skipping strings, templates and comments. */
export function matchBrace(code: string, i: number, to: number = code.length): number {
	let depth = 0;
	let j = i;
	while (j < to) {
		const c = code[j];
		if (c === "'" || c === '"') {
			j = readQuoted(code, j, to)[0];
			continue;
		}
		if (c === '`') {
			j = readTemplate(code, j, to, [])[0];
			continue;
		}
		if (c === '/' && code[j + 1] === '/') {
			const nl = code.indexOf('\n', j);
			j = nl < 0 ? to : nl;
			continue;
		}
		if (c === '/' && code[j + 1] === '*') {
			const end = code.indexOf('*/', j + 2);
			j = end < 0 ? to : end + 2;
			continue;
		}
		if (c === '{') depth++;
		else if (c === '}') {
			depth--;
			if (depth === 0) return j + 1;
		}
		j++;
	}
	return to;
}

/** Index after the template literal at `i`, its text (`${…}` as a placeholder); nested literals go to `out`. */
function readTemplate(code: string, i: number, to: number, out: Lit[]): [number, string] {
	let j = i + 1;
	let v = '';
	while (j < to && code[j] !== '`') {
		if (code[j] === '\\') {
			v += code[j + 1] ?? '';
			j += 2;
			continue;
		}
		if (code[j] === '$' && code[j + 1] === '{') {
			const end = matchBrace(code, j + 1, to);
			out.push(...scanJs(code, j + 2, end - 1));
			v += PLACEHOLDER;
			j = end;
			continue;
		}
		v += code[j];
		j++;
	}
	return [j + 1, v];
}

/** String and template literals of JS/TS code (comments and regex literals skipped), in source order. */
export function scanJs(code: string, from = 0, to = code.length): Lit[] {
	const out: Lit[] = [];
	let i = from;
	let prevIdx = -1;
	while (i < to) {
		const c = code[i];
		if (c === '/' && code[i + 1] === '/') {
			const nl = code.indexOf('\n', i);
			i = nl < 0 || nl > to ? to : nl;
			continue;
		}
		if (c === '/' && code[i + 1] === '*') {
			const end = code.indexOf('*/', i + 2);
			i = end < 0 ? to : end + 2;
			continue;
		}
		if (c === "'" || c === '"') {
			const [next, text] = readQuoted(code, i, to);
			out.push({ index: i, text });
			prevIdx = next - 1;
			i = next;
			continue;
		}
		if (c === '`') {
			const [next, text] = readTemplate(code, i, to, out);
			out.push({ index: i, text });
			prevIdx = next - 1;
			i = next;
			continue;
		}
		if (c === '/') {
			const prev = prevIdx < 0 ? '' : code[prevIdx];
			const isRegex =
				prev === '' ||
				REGEX_BEFORE.test(prev) ||
				(/\w/.test(prev) && REGEX_KEYWORD.test(code.slice(Math.max(from, prevIdx - 10), prevIdx + 1)));
			if (isRegex) {
				let j = i + 1;
				let inClass = false;
				while (j < to && code[j] !== '\n') {
					const ch = code[j];
					if (ch === '\\') {
						j += 2;
						continue;
					}
					if (ch === '[') inClass = true;
					else if (ch === ']') inClass = false;
					else if (ch === '/' && !inClass) break;
					j++;
				}
				prevIdx = j;
				i = j + 1;
				continue;
			}
		}
		if (!/\s/.test(c)) prevIdx = i;
		i++;
	}
	return out.sort((a, b) => a.index - b.index);
}

/** A literal passed straight to an `Error`/`DOMException` constructor or a `console` method (developer text, not shown). */
function isDeveloperText(code: string, index: number): boolean {
	return /(?:\b\w*Error|\bDOMException|\bconsole\.\w+)\s*\(\s*$/.test(code.slice(Math.max(0, index - 80), index));
}

/** `{n} reviews`, `${n} minute${…}`: a placeholder, a space, then a word of two or more letters. */
const isWordTemplate = (s: string): boolean => /^\{[^{}]*\}\s+\p{L}{2,}/u.test(s.trim());

/** A lower-case sentence: a lower-case first letter and three or more words with letters (`could not save it`). */
function isLowerSentence(s: string): boolean {
	const t = s.trim();
	return /^\p{Ll}/u.test(t) && t.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length >= 3;
}

/** A literal assigned to an error, notice or message (`error = '…'`, `languageError = '…'`, `{ message: '…' }`). */
function isMessageTarget(code: string, index: number): boolean {
	return /\b\w*(?:error|Error|notice|Notice|message|Message)\s*[=:]\s*$/.test(
		code.slice(Math.max(0, index - 80), index)
	);
}

function sentenceHits(code: string, from: number, to: number, templates = false): Hit[] {
	return scanJs(code, from, to)
		.filter(
			(l) =>
				(isSentence(l.text) ||
					(templates && isWordTemplate(l.text)) ||
					(isLowerSentence(l.text) && isMessageTarget(code, l.index))) &&
				!isDeveloperText(code, l.index)
		)
		.map((l) => ({ index: l.index, line: lineAt(code, l.index), text: l.text.trim() }));
}

/** Sentence-like string literals in code: the whole file (.ts) or its `<script>` blocks (.svelte). */
export function tsFindings(src: string, svelte: boolean): Finding[] {
	const code = svelte ? scriptOnly(src) : src;
	return sentenceHits(code, 0, code.length, true).map(strip);
}

const strip = ({ line, text }: Hit): Finding => ({ line, text });

function decodeText(s: string): string {
	return s
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&\w+;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Index after the tag starting at `i` (`<`), skipping quoted values and `{…}` expressions. */
export function tagEnd(m: string, i: number): number {
	let j = i + 1;
	while (j < m.length) {
		const c = m[j];
		if (c === '"' || c === "'") {
			const end = m.indexOf(c, j + 1);
			j = end < 0 ? m.length : end + 1;
			continue;
		}
		if (c === '{') {
			j = matchBrace(m, j);
			continue;
		}
		if (c === '>') return j + 1;
		j++;
	}
	return m.length;
}

interface MarkupResult {
	text: Hit[];
	lang: Hit[];
}

function analyseTag(m: string, start: number, end: number, res: MarkupResult): void {
	let j = start + 1;
	while (j < end && /[^\s/>]/.test(m[j])) j++; // tag name
	while (j < end) {
		const c = m[j];
		if (/[\s/>]/.test(c)) {
			j++;
			continue;
		}
		if (c === '{') {
			const close = matchBrace(m, j, end);
			res.text.push(...sentenceHits(m, j + 1, close - 1));
			j = close;
			continue;
		}
		const nameStart = j;
		while (j < end && /[^\s=/>{]/.test(m[j])) j++;
		const name = m.slice(nameStart, j);
		if (m[j] !== '=') continue;
		j++;
		const v = m[j];
		if (v === '"' || v === "'") {
			const valueStart = j + 1;
			let k = valueStart;
			let text = '';
			while (k < end && m[k] !== v) {
				if (m[k] === '{') {
					const close = matchBrace(m, k, end);
					res.text.push(...sentenceHits(m, k + 1, close - 1));
					text += PLACEHOLDER;
					k = close;
					continue;
				}
				text += m[k];
				k++;
			}
			const literal = decodeText(text);
			if (LINT_ATTRS.has(name) && hasLetters(literal))
				res.text.push({ index: valueStart, line: lineAt(m, valueStart), text: literal });
			if (name === 'lang' && !text.includes(PLACEHOLDER))
				res.lang.push({ index: nameStart, line: lineAt(m, nameStart), text: `lang="${text}"` });
			j = k + 1;
		} else if (v === '{') {
			const close = matchBrace(m, j, end);
			if (LINT_ATTRS.has(name)) {
				for (const l of scanJs(m, j + 1, close - 1))
					if (hasLetters(l.text) && !KEY.test(l.text) && !isDeveloperText(m, l.index))
						res.text.push({ index: l.index, line: lineAt(m, l.index), text: l.text.trim() });
			} else res.text.push(...sentenceHits(m, j + 1, close - 1));
			j = close;
		} else {
			while (j < end && /[^\s/>]/.test(m[j])) j++;
		}
	}
}

function analyseMarkup(src: string): MarkupResult {
	const m = markupOnly(src);
	const res: MarkupResult = { text: [], lang: [] };
	let run = '';
	let runStart = -1;
	const flush = () => {
		const t = decodeText(run);
		if (hasLetters(t)) res.text.push({ index: runStart, line: lineAt(m, runStart), text: t });
		run = '';
		runStart = -1;
	};
	let i = 0;
	while (i < m.length) {
		const c = m[i];
		if (c === '<' && /[A-Za-z/!]/.test(m[i + 1] ?? '')) {
			flush();
			const end = tagEnd(m, i);
			analyseTag(m, i, end, res);
			i = end;
			continue;
		}
		if (c === '{') {
			const end = matchBrace(m, i);
			res.text.push(...sentenceHits(m, i + 1, end - 1));
			if (/^\s*[#:/@]/.test(m.slice(i + 1, end - 1))) flush();
			else {
				if (runStart < 0) runStart = i;
				run += ` ${PLACEHOLDER} `;
			}
			i = end;
			continue;
		}
		if (runStart < 0 && !/\s/.test(c)) runStart = i;
		run += c;
		i++;
	}
	flush();
	const byIndex = (a: Hit, b: Hit) => a.index - b.index;
	return { text: res.text.sort(byIndex), lang: res.lang.sort(byIndex) };
}

/** Text nodes and the five text attributes of a .svelte file's markup with two or more letters. */
export function markupFindings(src: string): Finding[] {
	return analyseMarkup(src).text.map(strip);
}

/** Literal `lang="…"` attributes in a .svelte file's markup (study text takes `studyLang`, spec). */
export function langFindings(src: string): Finding[] {
	return analyseMarkup(src).lang.map(strip);
}

const INTL = /Intl\.(?:\w*Format|PluralRules)\(|toLocale\w*String\(/g;

function blankComments(code: string): string {
	return code.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre: string | undefined) =>
		(pre ?? '') + blank(m.slice((pre ?? '').length))
	);
}

/** Fixed-locale formatting calls (`Intl.*Format(`, `Intl.PluralRules(`, `toLocale*String(`), comments skipped. */
export function intlFindings(src: string, svelte = false): Finding[] {
	const code = svelte ? blankComments(scriptOnly(src)) + '\n' + markupOnly(src) : blankComments(src);
	const lines = svelte ? src.split('\n').length : 0;
	const out: Finding[] = [];
	for (const m of code.matchAll(INTL)) {
		let line = lineAt(code, m.index ?? 0);
		if (svelte && line > lines) line -= lines;
		out.push({ line, text: m[0] });
	}
	return out.sort((a, b) => a.line - b.line);
}

/** The names a caught error goes by in this code base. */
const ERR = String.raw`(?:err|e|error|ex|reason|cause)`;
/**
 * The ways to the text of a caught error or an error body: `err.message` (also `e`, `error`, `ex`, `reason`,
 * `cause`), `(x as Error).message`, `body.message` / `body?.message`, `String(err)`, `${err}`, `err.toString()`,
 * `'' + err`, and destructuring `{ message } = err`.
 */
const ERR_MESSAGE = new RegExp(
	[
		String.raw`\b${ERR}\??\.message\b(?!s)`,
		String.raw`\(\s*\w+\s+as\s+\w*Error\s*\)\??\.message\b`,
		String.raw`\bbody\??\.message\b`,
		String.raw`\bString\(${ERR}\)`,
		String.raw`\$\{\s*${ERR}\s*\}`,
		String.raw`\b${ERR}\??\.toString\(`,
		String.raw`(['"])\1\s*\+\s*${ERR}\b`,
		String.raw`\{[^{}]*\bmessage\b[^{}]*\}\s*=\s*${ERR}\b`
	].join('|'),
	'g'
);

/**
 * Where a caught error's own text is read (#168, the `errmsg` rule): screens show `errorText(err, fallback)`, never
 * the server's English `message` or an `Error`'s developer text. Comments are skipped; a .svelte file is checked in
 * its script and its markup.
 */
export function errMessageFindings(src: string, svelte: boolean): Finding[] {
	const code = svelte ? blankComments(scriptOnly(src)) : blankComments(src);
	const out: Finding[] = [];
	for (const m of code.matchAll(ERR_MESSAGE)) out.push({ line: lineAt(code, m.index ?? 0), text: m[0] });
	if (svelte) {
		const markup = markupOnly(src);
		for (const m of markup.matchAll(ERR_MESSAGE)) out.push({ line: lineAt(markup, m.index ?? 0), text: m[0] });
	}
	return out.sort((a, b) => a.line - b.line);
}
