// Sentence case for the catalogue's label-like values (#106): a label, heading, tab, action or column reads
// "Add deck", not "Add Deck", and is never written in all caps. The check is on values, never keys: a fix changes
// only the English value (translator notes stay unless the meaning changes).
//
// A word after the first that starts with a capital is a finding unless
//   - it is a proper name in sentenceCaseNames.json (products, palettes, dictionaries, schemes, languages,
//     HSK/JLPT/FSRS/AI/API/TOTP/SMTP, …), reviewed by hand;
//   - it follows a colon, a full stop, an exclamation mark, a question mark, an arrow ("Settings → Features") or
//     an ICU plural branch brace (the start of a sentence inside {…}).
// A value whose every word is capitals fails unless all its words are proper names ("AI" passes).
//
// The label-like keys are the reviewed namespaces below: `title`, `label`, `heading`, `action`, `tabs`, `button`
// and `col` segments, plus a reviewed set of button leaf names. A button whose key is not named here is a gap of
// this list, not of the page.
import names from './sentenceCaseNames.json';

/** Segments whose values are shown as a label, heading, tab, action or column header. */
export const LABEL_SEGMENTS = ['title', 'label', 'heading', 'action', 'tabs', 'button', 'col'] as const;

/** Leaf names that are buttons even without an `action` segment ("Sign in" is auth.signIn.submit). */
export const BUTTON_LEAVES = [
	'add',
	'back',
	'cancel',
	'check',
	'close',
	'confirm',
	'continue',
	'copy',
	'create',
	'delete',
	'discard',
	'download',
	'edit',
	'install',
	'invite',
	'next',
	'previous',
	'remove',
	'rename',
	'retry',
	'save',
	'send',
	'signIn',
	'signOut',
	'submit',
	'uninstall',
	'upload'
] as const;

export interface CaseFinding {
	key: string;
	value: string;
	/** The capitalised word that broke the rule. */
	word: string;
}

/** isLabelKey: the value is shown as a label-like string (see the header). */
export function isLabelKey(key: string): boolean {
	const segments = key.split('.');
	return (
		LABEL_SEGMENTS.some((segment) => segments.includes(segment)) ||
		(BUTTON_LEAVES as readonly string[]).includes(segments[segments.length - 1] ?? '')
	);
}

/** The words of a value with placeholders and markup removed: {name} and <strong> are not words to judge. */
function wordsOf(value: string): { word: string; start: number }[] {
	const text = value
		.replace(/\{[^{}]*\}/g, (m) => ' '.repeat(m.length))
		.replace(/<\/?[a-z][^>]*>/gi, (m) => ' '.repeat(m.length));
	const out: { word: string; start: number }[] = [];
	for (const m of text.matchAll(/\p{L}[\p{L}\p{M}'’.-]*/gu)) out.push({ word: m[0], start: m.index ?? 0 });
	return out;
}

/** A word is at the start of a sentence after one of these (and at the first word). */
function atSentenceStart(value: string, start: number): boolean {
	const before = value.slice(0, start);
	return /(^|[:.!?→]\s|\{\s*|\}\s*)\s*$/.test(before);
}

const NAME_SET = new Set(names as string[]);

/** sentenceCaseFindings: every label-like value whose inner capital or all-caps spelling is not a proper name. */
export function sentenceCaseFindings(catalogue: Record<string, string>): CaseFinding[] {
	const out: CaseFinding[] = [];
	for (const [key, value] of Object.entries(catalogue)) {
		if (typeof value !== 'string' || !isLabelKey(key)) continue;
		const words = wordsOf(value);
		if (words.length === 0) continue;
		// All caps: every word is capitals, and not one of them is a proper name.
		const letters = value.replace(/[^\p{L}]/gu, '');
		if (letters.length > 1 && letters === letters.toUpperCase()) {
			const allNamed = words.every(({ word }) => NAME_SET.has(word));
			if (!allNamed) {
				out.push({ key, value, word: words[0].word });
				continue;
			}
		}
		for (const { word, start } of words.slice(1)) {
			if (!/^\p{Lu}/u.test(word)) continue;
			if (NAME_SET.has(word)) continue;
			if (atSentenceStart(value, start)) continue;
			out.push({ key, value, word });
			break;
		}
	}
	return out;
}
