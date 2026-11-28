// The doubtful-picture review (#274), pure parts: which automatic word -> picture mappings are doubtful, the batches
// the teacher agents review, how two teachers and an adjudicator decide, and the rows the decisions add to the
// committed maps (scripts/images/<pack>/removed.tsv and manual.tsv). The I/O is scripts/picture-review.mjs.

export const REMOVED_HEADER = ['language', 'target', 'sense', 'concept', 'note'];
export const BATCH = 250;
const VERDICTS = new Set(['accept', 'remove', 'change']);
const MAX_REASON = 300;

/**
 * doubtReasons: why an automatic mapping may be wrong (plan ruling 9). ctx: the entry's sense count, how many words
 * of the language the pack maps to this picture, and the word's length in characters. A manual row is never doubtful.
 */
export function doubtReasons(r, { senses, shared, length }) {
	if (r.basis === 'manual') return [];
	const out = [];
	const sense = Number(r.sense);
	if (r.basis === 'gloss' || r.basis === 'keyword') out.push('one-gloss-match');
	if (senses > 1 && sense === 0) out.push('whole-entry-of-several-senses');
	else if (sense > 1) out.push('not-the-first-sense');
	else if (senses > 1) out.push('several-senses');
	if (shared > 3) out.push('shared-picture');
	if (r.language === 'zh' && length === 1) out.push('single-character');
	if (Number(r.score) < 75) out.push('weak-score');
	return out;
}

/** batches: the items in as few batches of at most `max` as possible, of even size, numbered from 1 within each. */
export function batches(items, max = BATCH) {
	const out = [];
	const n = Math.ceil(items.length / Math.max(1, Math.ceil(items.length / max)));
	for (let at = 0; at < items.length; at += n) out.push({ n: out.length + 1, items: items.slice(at, at + n).map((it, k) => ({ i: k + 1, ...it })) });
	return out;
}

/** readVerdicts: agent answer lines -> item number -> {v, to?, r?}. A change needs the name of the picture. */
export function readVerdicts(lines) {
	const out = new Map();
	for (const a of lines) {
		if (!Number.isInteger(a?.i) || !VERDICTS.has(a.v)) continue;
		const verdict = { v: a.v };
		if (a.v === 'change') {
			if (typeof a.to !== 'string' || !a.to.trim()) continue;
			verdict.to = a.to.trim().toLowerCase();
		}
		if (typeof a.r === 'string' && a.r.trim()) verdict.r = a.r.trim().slice(0, MAX_REASON);
		out.set(a.i, verdict);
	}
	return out;
}

const same = (a, b) => a.v === b.v && (a.v !== 'change' || a.to.toLowerCase() === b.to.toLowerCase());

/** decideItem: two teachers who agree decide; otherwise the adjudicator (c) does; without answers it is undecided. */
export function decideItem(a, b, c) {
	if (!a || !b) return { v: 'undecided' };
	if (same(a, b)) return a.v === 'change' ? { v: 'change', to: b.to.toLowerCase(), by: 'both' } : { v: a.v, by: 'both' };
	if (!c) return { v: 'disputed' };
	return c.v === 'change' ? { v: 'change', to: c.to.toLowerCase(), by: 'adjudicator' } : { v: c.v, by: 'adjudicator' };
}

/**
 * decisionRows: the decided items -> the rows each pack's removed.tsv and manual.tsv gain. A removal or a change
 * removes the doubtful row from its own pack; a change names the right picture by its English name, and `names` maps
 * such a name to {pack, concept} (OpenMoji first): the word gets that picture as a manual row of that pack. A name no
 * pack has leaves the word without the doubtful picture (a wrong picture is worse than none).
 */
export function decisionRows(items, names) {
	const removed = [];
	const manual = [];
	for (const it of items) {
		const d = it.decision;
		if (!d || (d.v !== 'remove' && d.v !== 'change')) continue;
		const to = d.v === 'change' ? names.get(d.to) : undefined;
		if (to && to.pack === it.pack && to.concept === it.concept) continue; // "changed" to the same picture
		const note = `#274 review: ${it.word}${d.v === 'change' ? ` -> ${d.to}` : ''}`;
		removed.push({ pack: it.pack, language: it.language, target: it.target, sense: String(it.sense), concept: it.concept, note });
		if (to) manual.push({ pack: to.pack, language: it.language, target: it.target, sense: String(it.sense), concept: to.concept, note });
	}
	return { removed, manual };
}
