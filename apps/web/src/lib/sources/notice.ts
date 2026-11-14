// A pack or plugin notice is plain text in a tiny markup: paragraphs are
// separated by a blank line, and the only markup is a link written as
// `[text](https://…)`. parseNotice turns it into nodes the Sources page
// renders with Svelte elements, so no notice is ever parsed as HTML.
// Anything that is not a well-formed https link (http:, javascript:,
// data:, relative paths, unbalanced brackets) stays plain text.

export type NoticePart = { type: 'text'; text: string } | { type: 'link'; text: string; href: string };

export interface NoticeParagraph {
	type: 'p';
	parts: NoticePart[];
}

/** parseNotice splits a notice into paragraphs of text and https links. */
export function parseNotice(source: string | null | undefined): NoticeParagraph[] {
	if (!source) return [];
	return source
		.replace(/\r\n?/g, '\n')
		.split(/\n[ \t]*\n/)
		.map((block) => block.replace(/\s*\n\s*/g, ' ').trim())
		.filter((block) => block !== '')
		.map((block) => ({ type: 'p', parts: parseInline(block) }));
}

/**
 * matchPairs maps each opening bracket index to its balanced closing
 * index in one pass, so hostile input ("[[[[…") stays linear.
 */
function matchPairs(text: string, open: string, close: string): Map<number, number> {
	const pairs = new Map<number, number>();
	const stack: number[] = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === open) stack.push(i);
		else if (text[i] === close && stack.length > 0) pairs.set(stack.pop()!, i);
	}
	return pairs;
}

function parseInline(text: string): NoticePart[] {
	const brackets = matchPairs(text, '[', ']');
	const parens = matchPairs(text, '(', ')');
	const parts: NoticePart[] = [];
	let plain = '';
	let i = 0;
	while (i < text.length) {
		if (text[i] === '[') {
			const close = brackets.get(i);
			if (close !== undefined && text[close + 1] === '(') {
				const end = parens.get(close + 1);
				const label = text.slice(i + 1, close).trim();
				const href = end === undefined ? null : safeHref(text.slice(close + 2, end));
				if (label !== '' && !label.includes('](') && href !== null) {
					if (plain) parts.push({ type: 'text', text: plain });
					plain = '';
					parts.push({ type: 'link', text: label, href });
					i = end! + 1;
					continue;
				}
			}
		}
		plain += text[i];
		i++;
	}
	if (plain) parts.push({ type: 'text', text: plain });
	return parts;
}

/** safeHref accepts only an absolute https URL with no whitespace or control characters. */
export function safeHref(raw: string): string | null {
	if (!/^https:\/\/[^\s/\\?#\u0000-\u001f\u007f][^\s\u0000-\u001f\u007f]*$/i.test(raw)) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.hostname === '') return null;
	return url.href;
}

/** A run of text with the language tag CJK runs need (`undefined` for the rest). */
export interface ScriptRun {
	text: string;
	lang?: string;
}

// Han (incl. extensions and compatibility), kana, CJK symbols and
// punctuation, and full-width forms.
const CJK =
	/[⺀-⿟　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿＀-￯]|[\u{20000}-\u{3134f}]/u;
const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;

/**
 * cjkLang picks the language tag for the CJK runs of a notice: Japanese
 * when it has kana, else the pack's language, else `und` (undetermined)
 * rather than guessing.
 */
export function cjkLang(text: string, language?: string): string {
	if (KANA.test(text)) return 'ja';
	const primary = (language ?? '').trim().toLowerCase().split(/[-_]/)[0];
	if (primary === 'ja' || primary === 'zh' || primary === 'ko') return language!.trim();
	return 'und';
}

/** scriptRuns splits text into CJK runs (tagged `lang`) and the rest. */
export function scriptRuns(text: string, lang: string): ScriptRun[] {
	const runs: ScriptRun[] = [];
	for (const char of text) {
		const cjk = CJK.test(char);
		const last = runs[runs.length - 1];
		if (last && (last.lang !== undefined) === cjk) last.text += char;
		else runs.push(cjk ? { text: char, lang } : { text: char });
	}
	return runs;
}
