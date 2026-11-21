// The entry page's Related section (#104): the dictionaries' cross-references,
// in order, distinct, never the word itself.

import { parseXref } from '$lib/features/reader/entryDisplay';
import type { Entry } from '$lib/api/types';

export function relatedWords(entry: Entry): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const group of entry.senseGroups ?? []) {
		for (const xref of group.xrefs ?? []) {
			const word = parseXref(xref).headword.trim();
			if (!word || word === entry.written || seen.has(word)) continue;
			seen.add(word);
			out.push(word);
		}
	}
	return out;
}
