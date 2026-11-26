// What the Share action sends out (lib/native/share.ts). Plain text only. An entry shares its headword and its
// first reading and no dictionary text (those glosses carry the licences of their sources); a sentence shares
// its own text with the label of where it comes from (a Tatoeba sentence: its owner and page).
import type { Entry, Sentence, SentenceCredit } from '$lib/api/types';

export function entryShareText(entry: Pick<Entry, 'written' | 'readings'>): string {
	const reading = [...entry.readings].sort((a, b) => a.ord - b.ord)[0]?.value.trim();
	return reading ? `${entry.written} (${reading})` : entry.written;
}

/** The credit of a pack sentence as plain text, with the pages to follow: "Tatoeba · owner <url>, translation owner <url>". */
export function creditText(credit: SentenceCredit): string {
	const who = credit.owner ? `${credit.source} · ${credit.owner}` : credit.source;
	let text = `${who} ${credit.url}`;
	if (credit.translationUrl) {
		text += `, translation${credit.translationOwner ? ` ${credit.translationOwner}` : ''} ${credit.translationUrl}`;
	}
	return text;
}

export function sentenceShareText(sentence: Pick<Sentence, 'hanzi' | 'pinyin' | 'translation'>, origin: string): string {
	const lines = [sentence.hanzi, sentence.pinyin, sentence.translation].map((s) => (s ?? '').trim()).filter((s) => s !== '');
	if (origin.trim() !== '') lines.push(`(${origin.trim()})`);
	return lines.join('\n');
}
