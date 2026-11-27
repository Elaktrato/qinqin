// What an entry card in the lookup popup shows, derived from one lookup
// result. Pure, so the display rules are tested without rendering.
import { t } from '$lib/i18n';
import { formatNumber } from '$lib/i18n/format';
import type { LookupResult } from '$lib/api/types';
import { formatReading } from '$lib/languages/format';

type Sense = LookupResult['senses'][number];
type Frequency = LookupResult['frequencies'][number];

const MAX_OTHER_FORMS = 4;

/** rubyReading is the furigana over a Japanese word written differently from its reading. */
export function rubyReading(r: LookupResult, lang: string): string {
	if (lang !== 'ja' || r.kind !== 'word' || !r.reading || r.reading === r.term) return '';
	return r.reading;
}

/**
 * readingLine is the plain-text reading shown beside the term: every
 * pinyin reading of a Chinese entry joined with " · " (Chinese keeps one
 * entry per written form), or the on/kun readings of a Japanese character
 * grouped by type. Empty for a Japanese word, whose reading is ruby.
 * `shows` is the hidden-romanisation rule (#284, useRomanisation().shows):
 * a hidden type is left out, and so is the untyped fallback of a Chinese
 * entry (its pinyin); with pinyin hidden a Chinese entry shows its bopomofo.
 */
export function readingLine(r: LookupResult, lang: string, shows: (type: string) => boolean = () => true): string {
	if (lang === 'zh') {
		// With pinyin hidden, bopomofo (when shown) stands in for it.
		const type = shows('pinyin') ? 'pinyin' : shows('bopomofo') ? 'bopomofo' : null;
		if (type === null) return '';
		const values = [...new Set(r.readings.filter((x) => x.type === type).map((x) => x.value))];
		return values.length > 0 ? values.join(' · ') : type === 'pinyin' ? r.reading : '';
	}
	if (r.kind !== 'character') return '';
	const byType = new Map<string, string[]>();
	for (const reading of r.readings) {
		if (!shows(reading.type)) continue;
		byType.set(reading.type, [...(byType.get(reading.type) ?? []), reading.value]);
	}
	return [...byType].map(([type, values]) => formatReading(type, values.join(', '))).join(' · ');
}

// SEARCH_ONLY is JMdict's sK flag: a form kept for searching, never shown.
const SEARCH_ONLY = 'sK';

/**
 * otherForms lists other written forms of the entry (traditional
 * characters, kanji variants; 事 for an entry shown as こと); JMdict's
 * search-only (sK) forms are hidden, irregular (iK) and rare (rK) ones
 * stay. The popup shows at most four, the entry page all of them.
 */
export function otherForms(
	r: { forms: readonly { text: string; flags?: readonly string[] }[]; term: string },
	max = MAX_OTHER_FORMS
): string[] {
	return r.forms
		.filter((f) => !f.flags?.includes(SEARCH_ONLY))
		.map((f) => f.text)
		.filter((text) => text !== r.term)
		.slice(0, max);
}

/** joinForms lists written forms: with 、 in Japanese, with " · " in Chinese. */
export function joinForms(forms: string[], lang: string): string {
	return forms.join(lang === 'ja' ? '、' : ' · ');
}

/** frequencyLabel is a pack's display value, else its rank with thousands separators. */
export function frequencyLabel(f: Frequency): string {
	return f.display || formatNumber(f.rank);
}

/** dictionaryNames lists each source dictionary of the senses once, in order. */
export function dictionaryNames(r: LookupResult): string[] {
	return [...new Set(r.senses.map((s) => s.dictionaryName))];
}

/** shownSenses are the senses with something to show. */
export function shownSenses(r: LookupResult): Sense[] {
	return r.senses.filter((s) => s.glosses.length > 0);
}

/** senseChips are a sense's part-of-speech and other tags; "usually kana" shows per entry. */
export function senseChips(s: Sense): string[] {
	return [...s.pos, ...s.tags.filter((t) => t !== 'uk')];
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** hasCjk reports Han or kana in a gloss: such text can be scanned with Shift+hover. */
export function hasCjk(text: string): boolean {
	return CJK.test(text);
}

export interface Xref {
	headword: string;
	reading?: string;
	senseNo?: number;
}

/**
 * parseXref splits a JMdict cross-reference, `headword[・reading][・senseNo]`.
 * Only the headword is worth a lookup; the rest is shown as plain text.
 */
export function parseXref(text: string): Xref {
	const parts = text.split('・');
	const xref: Xref = { headword: parts[0] };
	let rest = parts.slice(1);
	const last = rest.at(-1);
	if (last !== undefined && /^\d+$/.test(last)) {
		xref.senseNo = Number(last);
		rest = rest.slice(0, -1);
	}
	if (rest.length > 0) xref.reading = rest.join('・');
	return xref;
}

/** moreLabel words a "show more" button of hidden senses or entries. */
export function moreLabel(hidden: number, kind: 'sense' | 'entry'): string {
	return kind === 'sense' ? t('reader.entry.moreSenses', { count: hidden }) : t('reader.entry.moreEntries', { count: hidden });
}

/**
 * levelChips are the result's level chips ("HSK 3"): one per scheme, in result
 * order. A level already named with its scheme's first word (the bundled
 * "HSK 3.0 (words)" scheme names its levels "HSK 1"…) is shown alone.
 */
export function levelChips(r: LookupResult): string[] {
	return (r.levels ?? []).map((l) => {
		const word = l.scheme.trim().split(/\s+/)[0] ?? '';
		return word && l.level.startsWith(word) ? l.level : t('reader.entry.level', { scheme: l.scheme, level: l.level });
	});
}
