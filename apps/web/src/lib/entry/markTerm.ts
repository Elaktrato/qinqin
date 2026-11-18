// markTerm splits an example sentence around every occurrence of the
// entry's word, so the page can set the word in the reading accent (and
// <b>) while the rest stays plain (#104). Pure: no HTML.

export interface TermSegment {
	text: string;
	match: boolean;
}

export function markTerm(sentence: string, term: string): TermSegment[] {
	if (!term || !sentence.includes(term)) return sentence ? [{ text: sentence, match: false }] : [];
	const out: TermSegment[] = [];
	let at = 0;
	for (;;) {
		const next = sentence.indexOf(term, at);
		if (next < 0) break;
		if (next > at) out.push({ text: sentence.slice(at, next), match: false });
		out.push({ text: term, match: true });
		at = next + term.length;
	}
	if (at < sentence.length) out.push({ text: sentence.slice(at), match: false });
	return out;
}
