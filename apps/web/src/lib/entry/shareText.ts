// What the Share action sends out (lib/native/share.ts). Plain text only. An entry shares its headword and its
// first reading and no dictionary text (those glosses carry the licences of their sources); a sentence shares
// its own text with the label of where it comes from.
import type { Entry, Sentence } from '$lib/api/types';

export function entryShareText(entry: Pick<Entry, 'written' | 'readings'>): string {
	const reading = [...entry.readings].sort((a, b) => a.ord - b.ord)[0]?.value.trim();
	return reading ? `${entry.written} (${reading})` : entry.written;
}

export function sentenceShareText(sentence: Pick<Sentence, 'hanzi' | 'pinyin' | 'translation'>, origin: string): string {
	const lines = [sentence.hanzi, sentence.pinyin, sentence.translation].map((s) => (s ?? '').trim()).filter((s) => s !== '');
	if (origin.trim() !== '') lines.push(`(${origin.trim()})`);
	return lines.join('\n');
}
