// The topic-label generator's pure parts (#220): the topic list, the OpenMoji
// group -> topic table, the word lists the agents label (HSK 1-4, ≈ N5-N3),
// the agents' answers, the review decision, the labels file and the coverage
// report. No I/O here, so scripts/topics-lib.test.mjs can test it on small
// fixtures; scripts/build-topic-labels.mjs and scripts/topic-coverage.mjs add
// the files. The format is docs/contracts/topics/README.md.

export const GROUPS_HEADER = ['concept', 'group', 'subgroup'];
export const GROUP_TOPICS_HEADER = ['group', 'subgroup', 'topics'];
export const TOPIC_ID = /^[a-z][a-z0-9]{1,23}$/;
/** Shown to the agents per sense; longer entries are cut (the label is about the common senses). */
export const MAX_SENSES = 6;
export const MAX_GLOSSES = 4;
export const MAX_TOPICS = 3;
const MAX_NOTE = 300;

/** Confidence of a label by how its review went (README "Confidence"). */
export const CONFIDENCE = { confirmed: 0.95, changed: 0.9, adjudicated: 0.8, adjudicatedOwn: 0.7, disputed: 0.5, picture: 0.6 };

/** The ids of docs/contracts/topics/topics.json, in list order. */
export function topicIds(list) {
	const ids = [];
	for (const t of list.topics ?? []) {
		if (!TOPIC_ID.test(t.id ?? '')) throw new Error(`topic id ${JSON.stringify(t.id)} is not a lower-case id`);
		if (ids.includes(t.id)) throw new Error(`topic ${t.id} is listed twice`);
		ids.push(t.id);
	}
	return ids;
}

// ---- pictures

/** openmoji.json -> the group and subgroup of each concept in `concepts`, sorted by concept. */
export function groupRows(openmoji, concepts) {
	return openmoji
		.filter((o) => concepts.has(o.hexcode))
		.map((o) => ({ concept: o.hexcode, group: o.group, subgroup: o.subgroups }))
		.sort((x, y) => (x.concept < y.concept ? -1 : x.concept > y.concept ? 1 : 0));
}

/** The group -> topic table as a function; a subgroup row wins over the group's `*` row. */
export function groupTopics(table, ids) {
	const at = new Map();
	for (const r of table) {
		const topics = r.topics.split(',').map((s) => s.trim()).filter(Boolean);
		for (const t of topics) if (!ids.includes(t)) throw new Error(`group ${r.group}/${r.subgroup}: unknown topic ${t}`);
		at.set(`${r.group}/${r.subgroup}`, topics);
	}
	return (group, subgroup) => at.get(`${group}/${subgroup}`) ?? at.get(`${group}/*`) ?? [];
}

/** The picture mapping rows of one language -> key -> [{sense, topics, note}] (rows whose group maps to no topic are left out). */
export function pictureTopics(mapRows, language, groups, topicOf) {
	const byConcept = new Map(groups.map((g) => [g.concept, g]));
	const out = new Map();
	for (const r of mapRows) {
		if (r.language !== language) continue;
		const g = byConcept.get(r.concept);
		if (!g) continue;
		const topics = topicOf(g.group, g.subgroup);
		if (!topics.length) continue;
		const sense = Number(r.sense);
		const list = out.get(r.target) ?? [];
		const same = list.find((x) => x.sense === sense);
		if (same) {
			for (const t of topics) if (!same.topics.includes(t)) same.topics.push(t);
		} else list.push({ sense, topics: [...topics], note: r.note ?? '' });
		out.set(r.target, list);
	}
	for (const list of out.values()) list.sort((a, b) => a.sense - b.sense);
	return out;
}

const pictureHint = (list) => {
	const out = [];
	for (const p of list ?? []) for (const t of p.topics) if (!out.includes(t)) out.push(t);
	return out;
};

// ---- word lists

const MARKS = { ā: 'a', á: 'a', ǎ: 'a', à: 'a', ē: 'e', é: 'e', ě: 'e', è: 'e', ī: 'i', í: 'i', ǐ: 'i', ì: 'i', ō: 'o', ó: 'o', ǒ: 'o', ò: 'o', ū: 'u', ú: 'u', ǔ: 'u', ù: 'u', ǖ: 'v', ǘ: 'v', ǚ: 'v', ǜ: 'v', ü: 'v', ń: 'n', ň: 'n', ǹ: 'n', ḿ: 'm' };

/** Pinyin without tones, spaces or punctuation, ü as v: what two spellings of a reading share. */
export function toneless(pinyin) {
	return pinyin
		.toLowerCase()
		.replace(/u:/g, 'v')
		.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ]/g, (c) => MARKS[c])
		.replace(/[^a-z]/g, '');
}

/** CC-CEDICT text -> simplified form -> senses, one per line in file order, numbered from 1 (the picture mapping's numbering). */
export function cedictSenses(text) {
	const out = new Map();
	for (const line of text.split('\n')) {
		if (!line || line.startsWith('#')) continue;
		const m = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/.exec(line);
		if (!m) continue;
		const glosses = m[4].split('/').map((g) => g.trim()).filter(Boolean);
		if (!glosses.length) continue;
		const list = out.get(m[2]) ?? [];
		list.push({ n: list.length + 1, reading: m[3], glosses });
		out.set(m[2], list);
	}
	return out;
}

const entriesOf = (level) => level.entries.map((e) => (typeof e === 'string' ? { form: e } : e));
const levelNumber = (name) => Number(/(\d+)/.exec(name)?.[1] ?? NaN);
const cut = (senses) => senses.slice(0, MAX_SENSES).map((s) => ({ ...s, glosses: s.glosses.slice(0, MAX_GLOSSES) }));

/** The HSK levels up to maxLevel -> one target per form, in list order; senses of the listed readings first. */
export function zhTargets(levels, senses, picture, maxLevel) {
	const out = [];
	const at = new Map();
	for (const level of levels.levels) {
		if (!(levelNumber(level.name) <= maxLevel)) continue;
		for (const e of entriesOf(level)) {
			const seen = at.get(e.form);
			if (seen) {
				if (e.reading && !seen.readings.includes(e.reading)) seen.readings.push(e.reading);
				continue;
			}
			const t = { key: e.form, form: e.form, readings: e.reading ? [e.reading] : [] };
			at.set(e.form, t);
			out.push(t);
		}
	}
	return out.map(({ key, form, readings }) => {
		const all = senses.get(key) ?? [];
		const first = [];
		for (const r of readings) for (const s of all) if (toneless(s.reading) === toneless(r) && !first.includes(s)) first.push(s);
		const ordered = [...first, ...all.filter((s) => !first.includes(s))];
		const t = { key, form, reading: readings.join(' / '), senses: cut(ordered), picture: pictureHint(picture.get(key)) };
		if (!t.reading) delete t.reading;
		return t;
	});
}

const KANA = /^[\u3040-\u30ff\u30fc]+$/u;

/** Which JMdict entry a listed Japanese word is (README "Japanese words"), or null. */
function jaEntry(byForm, form, reading) {
	const all = byForm.get(form) ?? [];
	const ok = (e) => !reading || e.forms.includes(reading);
	const order = (list) => [...list].sort((a, b) => a.rank - b.rank);
	const tries = KANA.test(form) && !reading
		? [all.filter((e) => !e.forms.some((f) => !KANA.test(f))), all]
		: [all.filter((e) => e.forms[0] === form && ok(e)), all.filter(ok)];
	for (const list of tries) if (list.length) return order(list)[0];
	return null;
}

/** The ≈ N5-N3 levels of a jlpt-words list -> one target per listed (form, reading), in list order. */
export function jaTargets(levels, jmdict, picture, levelNames) {
	const byForm = new Map();
	for (const e of jmdict) for (const f of new Set(e.forms)) byForm.set(f, [...(byForm.get(f) ?? []), e]);
	const out = [];
	const seen = new Set();
	for (const level of levels.levels) {
		if (!levelNames.includes(level.name)) continue;
		for (const e of entriesOf(level)) {
			const id = `${e.form}\t${e.reading ?? ''}`;
			if (seen.has(id)) continue;
			seen.add(id);
			const entry = jaEntry(byForm, e.form, e.reading);
			const senses = entry ? cut(entry.senses.map((glosses, i) => ({ n: i + 1, glosses }))) : [];
			out.push({ key: entry?.target ?? '', form: e.form, reading: e.reading, senses, picture: pictureHint(entry ? picture.get(entry.target) : []) });
		}
	}
	return out;
}

// ---- agent answers

/** One JSON object per line; code fences, prose and broken lines are skipped. */
export function parseJsonLines(text) {
	const out = [];
	for (const raw of text.split('\n')) {
		const line = raw.trim().replace(/,$/, '');
		if (!line.startsWith('{')) continue;
		try {
			out.push(JSON.parse(line));
		} catch {
			// a line the agent broke is answered again by the next run
		}
	}
	return out;
}

const cleanTopics = (list, ids) => {
	const out = [];
	for (const t of Array.isArray(list) ? list : []) if (ids.includes(t) && !out.includes(t)) out.push(t);
	return out.slice(0, MAX_TOPICS);
};

/**
 * Agent answers -> item number -> {ok: true} (a confirmation) or {t, s?, n?}: the topics of the word, of the senses
 * that differ, and the agent's note. Unknown topic ids are dropped; an answer left without a topic is no answer.
 */
export function readAnswers(lines, ids) {
	const out = new Map();
	for (const a of lines) {
		if (!Number.isInteger(a.i)) continue;
		if (a.v === 'ok') {
			out.set(a.i, { ok: true });
			continue;
		}
		const t = cleanTopics(a.t, ids);
		if (!t.length) continue;
		const answer = { t };
		const s = {};
		for (const [k, v] of Object.entries(a.s ?? {})) {
			const topics = cleanTopics(v, ids);
			if (/^[1-9]\d?$/.test(k) && topics.length) s[k] = topics;
		}
		if (Object.keys(s).length) answer.s = s;
		if (typeof a.n === 'string' && a.n.trim()) answer.n = a.n.trim();
		out.set(a.i, answer);
	}
	return out;
}

const shape = (x) => JSON.stringify([x.t, Object.entries(x.s ?? {}).sort()]);
const notes = (...xs) => xs.map((x) => x?.n).filter(Boolean).join(' | ').slice(0, MAX_NOTE);

/**
 * The review decision of one word (README "Review"): the suggestion, two teachers' answers (a, b) and, where they
 * differ, an adjudicator's (c). Returns the topics, sense topics, confidence, review state and the notes.
 */
export function decide(suggestion, { a, b, c }) {
	const va = a?.ok ? suggestion : a;
	const vb = b?.ok ? suggestion : b;
	const out = (v, confidence, review, note) => {
		const d = { t: v.t, confidence, review, note };
		if (v.s && Object.keys(v.s).length) d.s = v.s;
		return d;
	};
	if (va && vb && shape(va) === shape(vb)) {
		if (shape(va) === shape(suggestion)) return out(suggestion, CONFIDENCE.confirmed, 'confirmed', notes(a, b));
		return out(va, CONFIDENCE.changed, 'changed', notes(a, b));
	}
	if (c) {
		const picked = [va, vb].some((v) => v && shape(v) === shape(c));
		return out(c, picked ? CONFIDENCE.adjudicated : CONFIDENCE.adjudicatedOwn, 'adjudicated', notes(a, b, c));
	}
	return out(suggestion, CONFIDENCE.disputed, 'disputed', notes(a, b));
}

// ---- the labels file

/**
 * Batches (items, the suggestion, teacher answers a and b, adjudication c, the sense check d) and the picture topics -> the labels file of
 * a language. Words come in batch and item order, each followed by its sense rows; the words the pictures label and no
 * batch covers follow, by key. Same inputs, same file.
 */
export function buildLabels(language, batches, picture, ids, meta) {
	const labels = [];
	const covered = new Set();
	for (const batch of [...batches].sort((x, y) => x.batch - y.batch)) {
		const suggest = readAnswers(batch.suggest ?? [], ids);
		const a = readAnswers(batch.a ?? [], ids);
		const b = readAnswers(batch.b ?? [], ids);
		const c = readAnswers(batch.c ?? [], ids);
		const senseCheck = new Map((batch.d ?? []).filter((x) => Number.isInteger(x.i) && Array.isArray(x.keep)).map((x) => [x.i, x.keep.map(Number)]));
		const r = batch.reviewers;
		for (const item of batch.items) {
			const s = suggest.get(item.i);
			if (!s || s.ok) continue;
			const d = decide(s, { a: a.get(item.i), b: b.get(item.i), c: c.get(item.i) });
			const by = [r.a, r.b, ...(c.has(item.i) && d.review === 'adjudicated' ? [r.c] : [])];
			// the sense check: a teacher keeps only the sense rows a learner of these levels needs
			const check = senseCheck.get(item.i);
			if (check && d.s) {
				const dropped = Object.keys(d.s).filter((n) => !check.includes(Number(n)));
				for (const n of dropped) delete d.s[n];
				if (dropped.length) {
					d.note = [d.note.slice(0, MAX_NOTE - 40), `sense check: sense ${dropped.join(', ')} dropped`].filter(Boolean).join(' | ');
					if (!by.includes(r.d)) by.push(r.d);
				}
			}
			const base = { key: item.key || item.form, form: item.form };
			// a Chinese label is the whole simplified-form entry: its readings are only shown to the agents
			if (item.reading && language !== 'zh') base.reading = item.reading;
			const row = (sense, topics) => {
				const l = { ...base };
				if (sense) l.sense = sense;
				Object.assign(l, { topics, confidence: d.confidence, basis: 'agent', review: d.review, by });
				if (d.note) l.note = d.note;
				return l;
			};
			labels.push(row(0, d.t));
			for (const [n, topics] of Object.entries(d.s ?? {}).sort((x, y) => Number(x[0]) - Number(y[0]))) labels.push(row(Number(n), topics));
			covered.add(item.key || item.form);
		}
	}
	const rest = [...picture.keys()].filter((k) => !covered.has(k)).sort();
	for (const key of rest) {
		for (const p of picture.get(key)) {
			const l = { key, form: language === 'ja' ? p.note || key : key };
			if (p.sense) l.sense = p.sense;
			Object.assign(l, { topics: p.topics.slice(0, MAX_TOPICS), confidence: CONFIDENCE.picture, basis: 'picture', review: 'picture' });
			labels.push(l);
		}
	}
	return {
		version: 1,
		language,
		license: 'CC-BY-SA-4.0',
		attribution: meta.attribution,
		humanReviewed: false,
		reviewers: meta.reviewers,
		labels
	};
}

/** The labels file as text: the header fields as usual JSON, one label per line, so a changed label is a one-line diff. */
export function formatLabels(file) {
	const { labels, ...head } = file;
	const top = JSON.stringify(head, null, 1).replace(/\n}$/, '');
	return `${top},\n "labels": [\n${labels.map((l) => '  ' + JSON.stringify(l)).join(',\n')}\n ]\n}\n`;
}

// ---- lookup and coverage (the rule of docs/contracts/topics/README.md "Looking up a word")

/** The topics of a listed word: rows with its form (and reading, when both have one); for a kana word without such a row, rows with that reading. */
export function topicsFor(file, { form, reading }) {
	let rows = file.labels.filter((l) => l.form === form && (!reading || !l.reading || l.reading === reading));
	if (!rows.length && KANA.test(form) && !reading) rows = file.labels.filter((l) => l.reading === form);
	rows = [...rows].sort((x, y) => (x.sense ?? 0) - (y.sense ?? 0));
	const out = [];
	for (const r of rows) for (const t of r.topics) if (!out.includes(t)) out.push(t);
	return out;
}

/** Per level: how many listed words have a topic, the share, and the forms without one. */
export function coverage(levels, file) {
	return levels.levels.map((level) => {
		const entries = entriesOf(level);
		const missing = entries.filter((e) => topicsFor(file, e).length === 0).map((e) => e.form);
		const words = entries.length;
		const labelled = words - missing.length;
		return { level: level.name, words, labelled, share: words ? labelled / words : 0, missing };
	});
}
