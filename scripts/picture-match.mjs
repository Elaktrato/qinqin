// The word -> picture matcher of the images packs (#216). Pure: no files, no
// network. scripts/build-picture-map.mjs reads the upstream data and calls
// matchEntries; scripts/picture-match.test.mjs pins the rules.
//
// A concept is one picture: {id, label (English), tags[] (English keywords),
// pos ('noun' | 'verb' | ...), native: {<lang>: {name, keywords[]}}}. For
// OpenMoji the native part is the CLDR emoji annotation of the language (its
// short name, "tts", and its keywords); Mulberry has none and matches through
// English only. An entry is one dictionary word: {target, forms[], senses[][],
// note, rank}. target is what the map row names (the entry's key); forms are
// the strings its native name is compared with (written forms, and readings
// when it has no written form); senses are the English glosses per sense in
// the order the importer stores them, so a map row can name its sense.
//
// Evidence, per entry and concept:
//   name      an entry form equals the concept's native name           90
//   keyword   an entry form equals one of its native keywords, and
//             no other concept has that keyword (review only)          60
//   label     a sense's FIRST gloss equals the concept's English label 80
//             (a later gloss: 60)
//   tag       the gloss equals an English keyword only this concept
//             has (first gloss 60, later 50)
// A name that a gloss confirms is "name+gloss": the larger score plus 10.
// A row is written when the best candidate scores at least THRESHOLD and is
// the only one at that score; everything else is a review row with its
// reason and candidates. A verb gloss ("to eat") matches verb pictures only,
// and a plain gloss never matches a verb picture.

export const THRESHOLD = 70;

const SKIP_GLOSS = /^(surname|cl:|variant of|old variant of|japanese variant of|also written|abbr\.? for|abbreviation of|see |same as|erhua variant|archaic variant|used in|taiwan pr\.|pr\. )/i;

/** Lower-case, drop parenthesised remarks, articles and the "to " of a verb.
 * Returns {text, verb}, or null for a gloss that is not a meaning. */
export function normalizeGloss(gloss) {
	let g = String(gloss ?? '').trim();
	if (!g || SKIP_GLOSS.test(g)) return null;
	if (/^[A-Z][a-z]/.test(g)) return null; // a capital: a proper name (Red Square), never a picture's word
	g = g.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').toLowerCase();
	g = g.replace(/\s+/g, ' ').trim();
	let verb = false;
	if (/^to\s/.test(g)) {
		verb = true;
		g = g.slice(3);
	}
	g = g.replace(/^(a|an|the)\s+/, '').replace(/[.,;:!?]+$/, '').trim();
	return g ? { text: g, verb } : null;
}

/** A picture label (an OpenMoji annotation, a Mulberry file name). */
export function normalizeLabel(s) {
	return String(s ?? '')
		.replace(/\([^)]*\)/g, ' ')
		.replace(/_/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase()
		.replace(/^-+\s*|\s*-+$/g, '')
		.trim();
}

/** Katakana to hiragana (the CLDR Japanese names mix both). */
export function foldKana(s) {
	return String(s).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const nativeKey = (lang, s) => (lang === 'ja' ? foldKana(s) : s).normalize('NFKC').trim();

function addTo(map, key, id) {
	if (!key) return;
	let set = map.get(key);
	if (!set) map.set(key, (set = new Set()));
	set.add(id);
}

function buildIndex(concepts, lang) {
	const ix = { name: new Map(), keyword: new Map(), label: new Map(), tag: new Map(), byId: new Map() };
	for (const c of concepts) {
		ix.byId.set(c.id, c);
		const n = c.native?.[lang];
		if (n?.name) addTo(ix.name, nativeKey(lang, n.name), c.id);
		for (const k of n?.keywords ?? []) addTo(ix.keyword, nativeKey(lang, k), c.id);
		addTo(ix.label, normalizeLabel(c.label), c.id);
		for (const t of c.tags ?? []) addTo(ix.tag, normalizeLabel(t), c.id);
	}
	return ix;
}

// One sense's gloss evidence: {concept -> {score, ambiguous}}.
function glossEvidence(ix, sense) {
	const found = new Map(); // concept -> score
	const ambiguous = new Set();
	sense.forEach((raw, j) => {
		const g = normalizeGloss(raw);
		if (!g) return;
		const fits = (id) => (ix.byId.get(id).pos === 'verb') === g.verb;
		for (const [index, first, later] of [
			[ix.label, 80, 60],
			[ix.tag, 60, 50]
		]) {
			const ids = [...(index.get(g.text) ?? [])].filter(fits);
			if (ids.length === 0) continue;
			const score = j === 0 ? first : later;
			if (ids.length > 1) ids.forEach((id) => ambiguous.add(id));
			else found.set(ids[0], Math.max(found.get(ids[0]) ?? 0, score));
			break; // the label index outranks the tag index
		}
	});
	return { found, ambiguous };
}

/**
 * Match entries to concepts for one language.
 * opts: threshold (default THRESHOLD), styleOffset (added to every score; a
 * second picture set ranks below the first), maxPerConcept (a word list can
 * hold dozens of words glossed "dog": keep the best-ranked N per concept, the
 * rest go to the review list).
 * Returns {rows: [{target, sense, concept, score, basis, note}], review:
 * [{target, note, reason, candidates}]}.
 */
export function matchEntries(entries, concepts, lang, opts = {}) {
	const threshold = opts.threshold ?? THRESHOLD;
	const offset = opts.styleOffset ?? 0;
	const ix = buildIndex(concepts, lang);
	const rows = [];
	const review = [];

	const formCount = new Map();
	for (const e of entries) for (const f of new Set(e.forms.map((x) => nativeKey(lang, x)))) formCount.set(f, (formCount.get(f) ?? 0) + 1);

	entries.forEach((e, index) => {
		const rank = e.rank ?? index;
		const forms = [...new Set(e.forms.map((f) => nativeKey(lang, f)))];
		// native evidence
		let nameIds = new Set();
		let keywordIds = new Set();
		for (const f of forms) {
			for (const id of ix.name.get(f) ?? []) nameIds.add(id);
			for (const id of ix.keyword.get(f) ?? []) keywordIds.add(id);
		}
		let native = null; // {concept, score, basis}
		let nativeAmbiguous = [];
		if (nameIds.size === 1) native = { concept: [...nameIds][0], score: 90, basis: 'name' };
		else if (nameIds.size > 1) nativeAmbiguous = [...nameIds];
		else if (keywordIds.size === 1) native = { concept: [...keywordIds][0], score: 60, basis: 'keyword' };
		else if (keywordIds.size > 1) nativeAmbiguous = [...keywordIds];

		// gloss evidence per sense (1-based)
		const senseEv = e.senses.map((s) => glossEvidence(ix, s));
		const make = (sense, concept, score, basis) => ({ target: e.target, sense, concept, score: Math.min(100, score + offset), basis, note: e.note ?? '', rank });

		const entryRows = [];
		let reason = '';
		let candidates = [];

		let confirmed = false;
		if (native) {
			senseEv.forEach((ev, i) => {
				const g = ev.found.get(native.concept);
				// a name confirmed by any gloss evidence; a keyword only by a first-gloss label match
				if (g !== undefined && (native.basis === 'name' || g >= 80)) {
					confirmed = true;
					entryRows.push(make(i + 1, native.concept, Math.max(g, native.score) + 10, 'name+gloss'));
				}
			});
		}
		if (!confirmed) {
			// gloss evidence on its own: one candidate per sense
			senseEv.forEach((ev, i) => {
				const best = Math.max(0, ...ev.found.values());
				const top = [...ev.found].filter(([, s]) => s === best);
				if (top.length === 1) {
					const [concept, score] = top[0];
					if (native && native.basis === 'name' && concept !== native.concept && score >= threshold) {
						reason = 'conflict';
						candidates = [native.concept, concept];
					} else if (score >= threshold) {
						entryRows.push(make(i + 1, concept, score, 'gloss'));
					} else if (!reason) {
						reason = 'weak';
						candidates = [concept];
					}
				} else if (top.length > 1) {
					if (!reason) {
						reason = 'ambiguous-gloss';
						candidates = top.map(([c]) => c);
					}
				} else if (ev.ambiguous.size && !reason) {
					reason = 'ambiguous-gloss';
					candidates = [...ev.ambiguous];
				}
			});
			if (reason === 'conflict') {
				entryRows.length = 0;
			} else if (native && entryRows.length === 0) {
				// native evidence without a gloss to confirm it
				const homograph = forms.some((f) => formCount.get(f) > 1);
				if (native.score < threshold) {
					reason = 'weak';
					candidates = [native.concept];
				} else if (e.senses.length === 1 && !homograph) {
					entryRows.push(make(0, native.concept, native.score, native.basis));
					reason = '';
				} else {
					reason = homograph ? 'homograph' : 'multi-sense-unconfirmed';
					candidates = [native.concept];
				}
			} else if (native && entryRows.length > 0 && native.basis === 'name') {
				// gloss rows exist for other concepts than the name: the name is a conflict
				if (!entryRows.some((r) => r.concept === native.concept)) {
					reason = 'conflict';
					candidates = [native.concept, ...entryRows.map((r) => r.concept)];
					entryRows.length = 0;
				}
			}
			if (entryRows.length === 0 && !reason && nativeAmbiguous.length) {
				reason = 'ambiguous-keyword';
				candidates = nativeAmbiguous;
			}
		}
		if (entryRows.length === 0) {
			if (reason) review.push({ target: e.target, note: e.note ?? '', reason, candidates: [...new Set(candidates)] });
			return;
		}
		rows.push(...entryRows);
	});

	// A concept shared by too many words: keep the best.
	if (opts.maxPerConcept) {
		const byConcept = new Map();
		for (const r of rows) {
			const list = byConcept.get(r.concept) ?? [];
			list.push(r);
			byConcept.set(r.concept, list);
		}
		const dropped = new Set();
		for (const [concept, list] of byConcept) {
			const targets = new Map(); // best row per target
			for (const r of list) if (!targets.has(r.target) || targets.get(r.target).score < r.score) targets.set(r.target, r);
			const ranked = [...targets.values()].sort((a, b) => b.score - a.score || a.rank - b.rank);
			for (const r of ranked.slice(opts.maxPerConcept)) {
				dropped.add(r.target + '\u0000' + concept);
				review.push({ target: r.target, note: r.note, reason: 'over-cap', candidates: [concept] });
			}
		}
		for (let i = rows.length - 1; i >= 0; i--) if (dropped.has(rows[i].target + '\u0000' + rows[i].concept)) rows.splice(i, 1);
	}
	return { rows: rows.map(({ rank, ...r }) => r), review };
}
