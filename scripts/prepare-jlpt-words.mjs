#!/usr/bin/env node
// Build the estimated JLPT word list, the bundled levels pack jlpt-words
// (≈ N5 … ≈ N1), from data already in the repository (#219).
//
// Usage:
//   node scripts/prepare-jlpt-words.mjs [--packs <dir>] [--out <dir>] [--base <dir>]
//   node scripts/prepare-jlpt-words.mjs --calibrate [--packs <dir>] [--base <dir>]
//
// Inputs, all bundled under <packs> (default plugins/data); nothing here
// touches the network:
//   jiten-frequency/freq.csv.gz  Jiten word frequency ranks (CC BY-SA 4.0)
//   jmdict/jmdict.xml.gz         JMdict (CC BY-SA 4.0, EDRDG)
//   jlpt-kanji/levels.json       the approximate JLPT kanji levels
//                                (kanjiapi.dev MIT + KANJIDIC2 CC BY-SA 4.0)
// and their LICENSE files and manifest versions. It (re)writes
// <out>/jlpt-words (default <out> = <packs>).
//
// No official JLPT vocabulary list has been published since 2010. The
// estimate (see the constants below):
//   - one Jiten rank is one word: Jiten lists every form and reading of a
//     word on its own row with the same rank. Each rank is matched to the
//     JMdict entry that has most of its rows as a written form with that
//     reading (a kana row: as a reading); ranks no entry matches go to
//     UNMATCHED.tsv, never guessed (matchRank);
//   - kanjiLevel: the hardest jlpt-kanji level among the word's kanji, a
//     kanji without a level counting as N1; kana-only and usually-kana
//     words have none;
//   - rankLevel: the Jiten rank against the thresholds R5 < R4 < R3 < R2 <
//     R1; a word ranked beyond R1 is not listed;
//   - the estimate is the harder of the two.
//
// The optional base list (--base <dir>, a local step: its licence must be
// confirmed first, see the #219 plan) is a directory with n5.csv … n1.csv
// whose `expression` and `reading` columns name the words (the format of
// the Waller-derived open-anki-jlpt-decks files) and its LICENSE. Each base
// word is matched to JMdict by form and reading (unmatched and ambiguous
// words are reported per level), keeps its base level, and the estimate
// fills the rest. --calibrate --base fits the thresholds on 80 % of the base
// words and reports the agreement on the 20 % held out, per level.
//
// The output depends only on the input files: a re-run reproduces the pack
// byte for byte.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { levelsJSON } from './prepare-hsk-syllabus.mjs';
import { PackError, records, vocabForms, writePack } from './prepare-level-packs.mjs';

/** The level names, easiest first: "≈" says they are an estimate. */
export const LEVEL_NAMES = ['≈ N5', '≈ N4', '≈ N3', '≈ N2', '≈ N1'];
const KEYS = ['R5', 'R4', 'R3', 'R2', 'R1'];

/**
 * TARGET_CUMULATIVE are the commonly cited cumulative sizes of the JLPT
 * vocabulary (about 800 words at N5, 1,500 up to N4, 3,700 up to N3, 6,000
 * up to N2 and 10,000 up to N1): sizes, not a list, and the only outside
 * information the estimate uses.
 */
export const TARGET_CUMULATIVE = [800, 1500, 3700, 6000, 10000];

/**
 * THRESHOLDS are the Jiten rank cuts (rank ≤ R5 → ≈ N5, … ≤ R1 → ≈ N1, beyond
 * R1 not listed). With the "harder of kanji level and rank level" rule the
 * cumulative size up to a level depends on that level's cut alone, so each cut
 * is the smallest rank at which the cumulative size reaches its target
 * (fitThresholds; `--calibrate` prints the fit again).
 *
 * Fitted 2026-11-27 on jiten-frequency 2026-11-12, JMdict 2026-11-11 and
 * jlpt-kanji kanjiapi.dev@76aa080+kanjidic2@2026-11-11. Evaluation (no ground
 * truth exists here; consistency checks, see the #219 plan and
 * docs/sources.md):
 *   - levels ≈ N5 800, ≈ N4 700, ≈ N3 2,200, ≈ N2 2,299, ≈ N1 4,000 (cumulative
 *     800 / 1,500 / 3,700 / 5,999 / 9,999: one {form, reading} two entries share
 *     is listed once);
 *   - 67,000 Jiten ranks matched to JMdict, 10,944 unmatched (11 within R1, in
 *     UNMATCHED.tsv), 11,636 ties broken (mostly kana rows of particles and
 *     beyond R1), 160 grammar expressions within R1 left out;
 *   - one-kanji words at their kanji's own level: 522 of 696 (75.0 %);
 *   - JLPT kanji whose easiest word is at the kanji's level: 1,637 of 1,704
 *     (96.1 %), 50 one level harder, 17 more;
 *   - words with a JMdict priority tag: ≈ N5 80.8 %, ≈ N4 82.6 %, ≈ N3 81.3 %,
 *     ≈ N2 76.3 %, ≈ N1 73.6 % (falls only weakly: Jiten ranks media use,
 *     JMdict's tags newspaper use and a 1990s word list).
 * No base list was available (its licence is unconfirmed): accuracy against
 * a list is unmeasured. With one, run --calibrate --base <dir>.
 */
export const THRESHOLDS = { R5: 2203, R4: 3249, R3: 5633, R2: 8336, R1: 11441 };

export const JLPT_WORDS_NOTICE =
	'The JLPT word levels are an estimate, not an official list: no official JLPT vocabulary list has been ' +
	'published since 2010. qinqin computes them from data it already bundles: a word gets the harder of two ' +
	'levels, the hardest JLPT level of its kanji (from the approximate JLPT kanji list, itself from ' +
	'[kanjiapi.dev](https://github.com/onlyskin/kanjiapi.dev), MIT, and KANJIDIC2) and a level from how often ' +
	'it is used ([Jiten](https://jiten.moe/frequency-dictionaries) frequency ranks, CC BY-SA 4.0); kana words go ' +
	'by frequency alone. The words and readings are ' +
	'[JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project) entries (CC BY-SA 4.0, ' +
	'EDRDG). The level sizes follow the commonly cited ones (about 800, 1,500, 3,700, 6,000 and 10,000 words up ' +
	'to N5 … N1); a word can be a level off. The list is CC BY-SA 4.0.';

const HAN = /\p{Script=Han}/u;
const ITERATION_MARK = '々';

function fail(message) {
	throw new PackError(message);
}

// ---- parsing

/**
 * parseJiten reads freq.csv (term,reading,rank) into one group per rank,
 * ranks ascending, rows in file order: one rank is one word.
 */
export function parseJiten(text) {
	const rows = records(text, 'freq.csv', ['term', 'reading', 'rank']);
	const byRank = new Map();
	for (const row of rows) {
		const rank = Number(row.rank);
		if (!Number.isInteger(rank) || rank < 1) fail(`freq.csv: rank ${JSON.stringify(row.rank)} of ${row.term} is not a positive integer`);
		if (!byRank.has(rank)) byRank.set(rank, []);
		byRank.get(rank).push({ term: row.term.trim(), reading: row.reading.trim() });
	}
	return [...byRank.keys()].sort((a, b) => a - b).map((rank) => ({ rank, rows: byRank.get(rank) }));
}

const xmlText = (s) =>
	s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&')
		.trim();
const tags = (body, tag) => [...body.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => xmlText(m[1]));
const entities = (body, tag) => [...body.matchAll(new RegExp(`<${tag}>&([^;<]+);</${tag}>`, 'g'))].map((m) => m[1]);

/**
 * parseJMdict reads JMdict XML into entries: seq, kebs [{text, inf}], rebs
 * [{text, inf, restr, nokanji}], uk (the first sense is tagged "usually
 * written using kana alone"), pri (the number of priority tags, a rough
 * commonness used to break ties and in the consistency checks) and expOnly
 * (every sense is an expression, `exp`).
 */
export function parseJMdict(xml) {
	const out = [];
	for (const chunk of xml.split('<entry>').slice(1)) {
		const body = chunk.slice(0, chunk.indexOf('</entry>'));
		const seq = Number(/<ent_seq>(\d+)<\/ent_seq>/.exec(body)?.[1]);
		if (!seq) continue;
		const kebs = [...body.matchAll(/<k_ele>([\s\S]*?)<\/k_ele>/g)]
			.map((m) => ({ text: tags(m[1], 'keb')[0] ?? '', inf: entities(m[1], 'ke_inf') }))
			.filter((k) => k.text !== '');
		const rebs = [...body.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/g)]
			.map((m) => ({
				text: tags(m[1], 'reb')[0] ?? '',
				inf: entities(m[1], 're_inf'),
				restr: tags(m[1], 're_restr'),
				nokanji: m[1].includes('<re_nokanji')
			}))
			.filter((r) => r.text !== '');
		if (rebs.length === 0) continue;
		const senses = [...body.matchAll(/<sense>([\s\S]*?)<\/sense>/g)].map((m) => m[1]);
		const uk = entities(senses[0] ?? '', 'misc').includes('uk');
		const pri = (body.match(/<(ke|re)_pri>/g) ?? []).length;
		// A sense without <pos> has the part of speech of the sense before it.
		let pos = [];
		let expOnly = senses.length > 0;
		for (const sense of senses) {
			const own = entities(sense, 'pos');
			if (own.length > 0) pos = own;
			if (pos.length === 0 || pos.some((p) => p !== 'exp')) expOnly = false;
		}
		out.push({ seq, kebs, rebs, uk, pri, expOnly });
	}
	return out;
}

/** readsAs reports whether reading r applies to kanji form keb. */
const readsAs = (r, keb) => !r.nokanji && (r.restr.length === 0 || r.restr.includes(keb));

/**
 * jmdictIndex indexes the entries by "form\treading" (every kanji form with
 * every reading that applies to it) and by kana ("\treading": every reading).
 */
export function jmdictIndex(entries) {
	const byKey = new Map();
	const bySeq = new Map();
	const add = (key, e) => {
		const list = byKey.get(key);
		if (!list) byKey.set(key, [e]);
		else if (!list.includes(e)) list.push(e);
	};
	for (const e of entries) {
		bySeq.set(e.seq, e);
		for (const r of e.rebs) {
			add(`\t${r.text}`, e);
			for (const k of e.kebs) if (readsAs(r, k.text)) add(`${k.text}\t${r.text}`, e);
		}
	}
	return { byKey, bySeq };
}

/**
 * kanaWritten: a word read and written in kana: no kanji form but
 * search-only ones (the particle の, searchable as 乃 or 之), or usually kana.
 */
const kanaWritten = (e) => e.uk || !e.kebs.some((k) => !k.inf.includes('sK'));

/**
 * candidates returns the entries one row names: a row with a reading by its
 * form and reading, a kana row (no reading) by its kana.
 */
function candidates(row, index) {
	return index.byKey.get(row.reading ? `${row.term}\t${row.reading}` : `\t${row.term}`) ?? [];
}

/**
 * pick chooses among scored candidates: most rows first, then kana-written
 * entries, then more priority tags, then the lowest sequence number.
 * ambiguous when the best two tie on the number of rows.
 */
function pick(scores) {
	const ranked = [...scores.entries()].sort(
		([a, sa], [b, sb]) => sb - sa || Number(kanaWritten(b)) - Number(kanaWritten(a)) || b.pri - a.pri || a.seq - b.seq
	);
	if (ranked.length === 0) return { entry: null, ambiguous: false };
	return { entry: ranked[0][0], ambiguous: ranked.length > 1 && ranked[1][1] === ranked[0][1] };
}

/** matchRank matches the rows of one Jiten rank to one JMdict entry. */
export function matchRank(rows, index) {
	const scores = new Map();
	for (const row of rows) for (const e of candidates(row, index)) scores.set(e, (scores.get(e) ?? 0) + 1);
	return pick(scores);
}

/**
 * GRAMMAR_HEAD is the first kana of a grammar expression: an `exp`-only
 * entry read with a particle or the copula first (のだ, ですか, として,
 * にとって, かもしれない, だろう) is a grammar pattern, which the JLPT
 * tests as grammar, not vocabulary. Set phrases (ありがとう, お願いします,
 * いただきます) are `exp` too but start otherwise, and stay.
 */
const GRAMMAR_HEAD = /^[のにとでかがはもをへだなや]/u;

/** grammarExpression reports whether the entry is a grammar expression (GRAMMAR_HEAD). */
export function grammarExpression(e) {
	return e.expOnly && GRAMMAR_HEAD.test(e.rebs[0].text);
}

/**
 * matchWords matches every Jiten rank: words [{rank, entry}] (an entry
 * matched by several ranks keeps its best rank), unmatched [{rank, rows}],
 * expressions (grammar expressions left out, see grammarExpression) and the
 * counts of ambiguous matches and repeated entries.
 */
export function matchWords(jiten, index) {
	const words = [];
	const unmatched = [];
	const expressions = [];
	const seen = new Set();
	let ambiguous = 0;
	let repeats = 0;
	for (const { rank, rows } of jiten) {
		const m = matchRank(rows, index);
		if (!m.entry) {
			unmatched.push({ rank, rows });
			continue;
		}
		if (m.ambiguous) ambiguous++;
		if (seen.has(m.entry.seq)) {
			repeats++;
			continue;
		}
		seen.add(m.entry.seq);
		if (grammarExpression(m.entry)) expressions.push({ rank, entry: m.entry });
		else words.push({ rank, entry: m.entry });
	}
	return { words, unmatched, expressions, ambiguous, repeats };
}

const OFF_FORM = new Set(['sK', 'iK', 'oK', 'rK']);
const OFF_READING = new Set(['sk', 'ik', 'ok', 'rk']);

/** headForm is the entry's written form: its first kanji form that is not search-only, irregular, outdated or rare. */
function headForm(e) {
	return (e.kebs.find((k) => !k.inf.some((i) => OFF_FORM.has(i))) ?? e.kebs.find((k) => !k.inf.includes('sK')) ?? e.kebs[0])?.text;
}

/**
 * wordEntry is the word's levels.json entry: {form, reading} for a word
 * with a kanji form (the importer matches both), its kana for a kana-only
 * word.
 */
export function wordEntry(e) {
	const form = headForm(e);
	if (form === undefined) return e.rebs[0].text;
	const fits = e.rebs.filter((r) => readsAs(r, form));
	const reading = (fits.find((r) => !r.inf.some((i) => OFF_READING.has(i))) ?? fits[0] ?? e.rebs[0]).text;
	return { form, reading };
}

/** kanjiLevelMap reads a jlpt-kanji levels.json: kanji → level index (0 = N5). */
export function kanjiLevelMap(levels) {
	const map = new Map();
	if (!Array.isArray(levels?.levels) || levels.levels.length !== LEVEL_NAMES.length) {
		fail(`jlpt-kanji levels.json: want ${LEVEL_NAMES.length} levels, N5 first`);
	}
	levels.levels.forEach((level, i) => {
		for (const ch of level.entries) if (!map.has(ch)) map.set(ch, i);
	});
	return map;
}

// ---- the rules

/**
 * kanjiLevel is the hardest level among the kanji of the word's written
 * form (a kanji without a level counts as N1, index 4; 々 is ignored), or
 * null for a kana-only or usually-kana word: those are read in kana, so
 * their kanji (為 of 為る, する) say nothing about them.
 */
export function kanjiLevel(e, kanji) {
	if (kanaWritten(e)) return null;
	let level = null;
	for (const ch of headForm(e)) {
		if (ch === ITERATION_MARK || !HAN.test(ch)) continue;
		level = Math.max(level ?? 0, kanji.get(ch) ?? LEVEL_NAMES.length - 1);
	}
	return level;
}

/** rankLevel is the level of a Jiten rank, or null beyond R1 (not listed). */
export function rankLevel(rank, thresholds) {
	const i = KEYS.findIndex((key) => rank <= thresholds[key]);
	return i < 0 ? null : i;
}

/** estimateLevel is the harder of the two levels; no rank level: not listed. */
export function estimateLevel(kanjiLvl, rankLvl) {
	if (rankLvl === null) return null;
	return kanjiLvl === null ? rankLvl : Math.max(kanjiLvl, rankLvl);
}

const entryKey = (entry) => (typeof entry === 'string' ? entry : `${entry.form}\t${entry.reading}`);

/**
 * buildLevels places the words: a base-list level where the base list has
 * the word, else the estimate; words not ranked within R1 and not in the
 * base list are left out. Each level lists its words by rank (base words
 * Jiten does not rank last, by sequence number); a levels.json entry that
 * two entries share is listed once, at the easier level.
 */
export function buildLevels({ words, kanji, thresholds, base = null, entries = null }) {
	const placed = [];
	const ranked = new Set();
	for (const { rank, entry } of words) {
		ranked.add(entry.seq);
		const fromBase = base?.levelOf.get(entry.seq);
		const level = fromBase ?? estimateLevel(kanjiLevel(entry, kanji), rankLevel(rank, thresholds));
		if (level !== null) placed.push({ rank, entry, level, fromBase: fromBase !== undefined });
	}
	if (base) {
		const unranked = [...base.levelOf.keys()].filter((seq) => !ranked.has(seq)).sort((a, b) => a - b);
		for (const seq of unranked) placed.push({ rank: Infinity, entry: entries.get(seq), level: base.levelOf.get(seq), fromBase: true });
	}
	placed.sort((a, b) => a.level - b.level || a.rank - b.rank || a.entry.seq - b.entry.seq);
	const levels = LEVEL_NAMES.map((name) => ({ name, entries: [] }));
	const keys = new Set();
	const kept = [];
	for (const p of placed) {
		const item = wordEntry(p.entry);
		if (keys.has(entryKey(item))) continue;
		keys.add(entryKey(item));
		levels[p.level].entries.push(item);
		kept.push(p);
	}
	return { levels, placed: kept, fromBase: kept.filter((p) => p.fromBase).length };
}

/**
 * fitThresholds picks each cut as the smallest Jiten rank at which the
 * cumulative size up to that level reaches its target: with the
 * harder-of-two rule that size is the number of words whose kanji level is
 * at most the level and whose rank is at most the cut. A target the data
 * cannot reach takes every word, and its level is named in `short`.
 */
export function fitThresholds({ words, kanji, targets = TARGET_CUMULATIVE }) {
	const thresholds = {};
	const cumulative = [];
	const short = [];
	const levels = words.map(({ rank, entry }) => ({ rank, k: kanjiLevel(entry, kanji) }));
	KEYS.forEach((key, i) => {
		const ranks = levels.filter((w) => w.k === null || w.k <= i).map((w) => w.rank).sort((a, b) => a - b);
		let cut;
		if (ranks.length < targets[i]) {
			cut = ranks.at(-1) ?? 0;
			short.push(LEVEL_NAMES[i]);
		} else {
			cut = ranks[targets[i] - 1];
		}
		const prev = i === 0 ? 0 : thresholds[KEYS[i - 1]];
		thresholds[key] = Math.max(cut, prev);
		cumulative.push(ranks.filter((rank) => rank <= thresholds[key]).length);
	});
	return { thresholds, cumulative, short };
}

/**
 * consistency are the checks that stand in for an evaluation (no ground
 * truth exists): single-kanji words whose estimate equals their kanji's own
 * JLPT level, each JLPT kanji's easiest word level against the kanji's own
 * level (the word level is never easier, by the rule), the cumulative sizes and whether they grow with no level
 * empty, the share of JMdict-prioritised words per level (expected to fall
 * from ≈ N5 to ≈ N1: JMdict's priority tags are independent of the ranks)
 * and `sample` evenly spaced words per level.
 */
export function consistency({ placed, kanji, sample = 20 }) {
	const perLevel = LEVEL_NAMES.map(() => []);
	for (const p of placed) perLevel[p.level].push(p);
	let words = 0;
	let agree = 0;
	for (const p of placed) {
		const form = headForm(p.entry);
		if (kanaWritten(p.entry) || form === undefined || [...form].length !== 1 || !kanji.has(form)) continue;
		words++;
		if (kanji.get(form) === p.level) agree++;
	}
	// The easiest word level each JLPT kanji appears in (as the importer
	// derives character levels) against the kanji's own level.
	const easiest = new Map();
	for (const p of placed) {
		if (kanaWritten(p.entry)) continue;
		for (const ch of new Set(headForm(p.entry))) {
			if (!kanji.has(ch)) continue;
			if (!easiest.has(ch) || p.level < easiest.get(ch)) easiest.set(ch, p.level);
		}
	}
	const kanjiEasiestWord = { kanji: easiest.size, same: 0, oneHarder: 0, harder: 0 };
	for (const [ch, level] of easiest) {
		const d = level - kanji.get(ch);
		if (d <= 0) kanjiEasiestWord.same++;
		else if (d === 1) kanjiEasiestWord.oneHarder++;
		else kanjiEasiestWord.harder++;
	}
	const cumulative = [];
	let total = 0;
	for (const list of perLevel) cumulative.push((total += list.length));
	const display = (p) => {
		const item = wordEntry(p.entry);
		if (typeof item === 'string') return item;
		return kanaWritten(p.entry) ? item.reading : item.form;
	};
	return {
		singleKanji: { words, agree },
		kanjiEasiestWord,
		cumulative,
		monotonic: perLevel.every((list) => list.length > 0),
		prioritised: perLevel.map((list) => (list.length === 0 ? 0 : list.filter((p) => p.entry.pri > 0).length / list.length)),
		samples: perLevel.map((list) => {
			const n = Math.min(sample, list.length);
			return Array.from({ length: n }, (_, i) => display(list[Math.floor((i * list.length) / n)]));
		})
	};
}

// ---- the optional base list

/**
 * baseLevels matches the base list (n5.csv … n1.csv, `expression` and
 * `reading` columns, parsed like the open-anki-jlpt-decks files with
 * vocabForms) to JMdict: a form with a reading by both, a form without one
 * as a kanji form with any reading or as a kana reading. One candidate (or
 * one that is clearly first: more priority tags) is a match; two equal
 * candidates are ambiguous and reported, never guessed; none is unmatched.
 * A word keeps the easiest level that lists it. levelOf maps a sequence
 * number to its level index; stats per level: words, matched, unmatched
 * (forms), ambiguous.
 */
export function baseLevels(texts, index) {
	const levelOf = new Map();
	const stats = [];
	LEVEL_NAMES.forEach((name, i) => {
		const file = `n${5 - i}.csv`;
		if (texts[file] === undefined) fail(`base list: ${file} is missing`);
		const rows = records(texts[file], file, ['expression', 'reading']);
		const s = { name, words: 0, matched: 0, unmatched: [], ambiguous: 0 };
		for (const row of rows) {
			for (const { form, reading } of vocabForms(row.expression, row.reading).forms) {
				s.words++;
				let found;
				if (reading) found = index.byKey.get(`${form}\t${reading}`) ?? [];
				else {
					const set = new Set(index.byKey.get(`\t${form}`) ?? []);
					for (const [key, list] of index.byKey) if (key.startsWith(`${form}\t`)) list.forEach((e) => set.add(e));
					found = [...set];
				}
				if (found.length === 0) {
					s.unmatched.push(reading ? `${form}/${reading}` : form);
					continue;
				}
				const sorted = [...found].sort((a, b) => b.pri - a.pri || a.seq - b.seq);
				if (sorted.length > 1 && sorted[1].pri === sorted[0].pri) {
					s.ambiguous++;
					continue;
				}
				s.matched++;
				if (!levelOf.has(sorted[0].seq)) levelOf.set(sorted[0].seq, i);
			}
		}
		stats.push(s);
	});
	return { levelOf, stats };
}

/** agreement counts, per level of the base list, the words the estimate places at the same level. */
function agreement(items, kanji, thresholds) {
	const perLevel = LEVEL_NAMES.map((name) => ({ name, words: 0, agree: 0 }));
	for (const { rank, entry, level } of items) {
		perLevel[level].words++;
		if (estimateLevel(kanjiLevel(entry, kanji), rankLevel(rank, thresholds)) === level) perLevel[level].agree++;
	}
	const words = perLevel.reduce((n, l) => n + l.words, 0);
	const agree = perLevel.reduce((n, l) => n + l.agree, 0);
	return { words, agree, perLevel };
}

/**
 * calibrateWithBase fits the thresholds on the base words Jiten ranks whose
 * sequence number is not a multiple of 5 (80 %), maximising exact agreement
 * by coordinate search over a rank grid from the cumulative fit, and reports
 * the agreement on the train and held-out (multiple of 5) words per level.
 */
export function calibrateWithBase({ words, kanji, base }) {
	const items = words
		.filter(({ entry }) => base.levelOf.has(entry.seq))
		.map(({ rank, entry }) => ({ rank, entry, level: base.levelOf.get(entry.seq) }));
	const train = items.filter(({ entry }) => entry.seq % 5 !== 0);
	const holdout = items.filter(({ entry }) => entry.seq % 5 === 0);
	const sortedRanks = [...new Set(words.map((w) => w.rank))].sort((a, b) => a - b);
	const grid = [...new Set(Array.from({ length: 401 }, (_, i) => sortedRanks[Math.floor((i * (sortedRanks.length - 1)) / 400)]))].filter(
		(x) => x !== undefined
	);
	let thresholds = { ...fitThresholds({ words, kanji }).thresholds };
	let best = agreement(train, kanji, thresholds).agree;
	for (let sweep = 0; sweep < 10; sweep++) {
		let improved = false;
		KEYS.forEach((key, i) => {
			const lo = i === 0 ? 0 : thresholds[KEYS[i - 1]];
			const hi = i === KEYS.length - 1 ? Infinity : thresholds[KEYS[i + 1]];
			for (const cut of grid) {
				if (cut < lo || cut > hi || cut === thresholds[key]) continue;
				const trial = { ...thresholds, [key]: cut };
				const score = agreement(train, kanji, trial).agree;
				if (score > best) {
					best = score;
					thresholds = trial;
					improved = true;
				}
			}
		});
		if (!improved) break;
	}
	return { thresholds, train: agreement(train, kanji, thresholds), holdout: agreement(holdout, kanji, thresholds) };
}

// ---- the CLI

function sha256(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

async function readInput(path, hint) {
	try {
		return await readFile(path);
	} catch (err) {
		fail(`read ${path} (${err.code ?? err.message}): ${hint}`);
	}
}

/** readInputs reads the three bundled packs; a missing file fails before anything is written. */
async function readInputs(packs) {
	const need = {
		jiten: ['jiten-frequency', 'freq.csv.gz', 'the Jiten frequency pack (plugins/data/jiten-frequency, scripts/fetch-jiten-frequency.sh)'],
		jmdict: ['jmdict', 'jmdict.xml.gz', 'the bundled JMdict (plugins/data/jmdict, scripts/fetch-seeds.sh)'],
		kanji: ['jlpt-kanji', 'levels.json', 'the JLPT kanji pack (plugins/data/jlpt-kanji, scripts/prepare-level-packs.mjs)']
	};
	const files = {};
	const versions = {};
	for (const [name, [dir, file, hint]] of Object.entries(need)) {
		files[name] = await readInput(join(packs, dir, file), `jlpt-words needs ${hint}`);
		files[`${name}License`] = await readInput(join(packs, dir, 'LICENSE'), `jlpt-words needs ${hint}`);
		const manifest = JSON.parse((await readInput(join(packs, dir, 'manifest.json'), `jlpt-words needs ${hint}`)).toString('utf8'));
		versions[name] = manifest.version;
	}
	let jitenText;
	let jmdictText;
	try {
		jitenText = gunzipSync(files.jiten).toString('utf8');
		jmdictText = gunzipSync(files.jmdict).toString('utf8');
	} catch (err) {
		fail(`a bundled .gz input is not gzip: ${err.message}`);
	}
	return { files, versions, jiten: parseJiten(jitenText), entries: parseJMdict(jmdictText), kanji: kanjiLevelMap(JSON.parse(files.kanji.toString('utf8'))) };
}

async function readBase(dir) {
	const texts = {};
	for (const n of ['n5', 'n4', 'n3', 'n2', 'n1']) {
		texts[`${n}.csv`] = (await readInput(join(dir, `${n}.csv`), 'the base list needs n5.csv … n1.csv')).toString('utf8').replace(/^﻿/, '');
	}
	const license = await readInput(join(dir, 'LICENSE'), 'the base list needs its licence text as LICENSE');
	return { texts, license };
}

function parseArgs(argv) {
	const opts = { calibrate: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--calibrate') opts.calibrate = true;
		else if (a === '--packs' || a === '--out' || a === '--base') {
			if (argv[i + 1] === undefined) fail(`${a} needs a directory`);
			opts[a.slice(2)] = resolve(argv[++i]);
		} else fail(`unknown argument ${a}; usage: node scripts/prepare-jlpt-words.mjs [--calibrate] [--packs <dir>] [--out <dir>] [--base <dir>]`);
	}
	const here = dirname(fileURLToPath(import.meta.url));
	opts.packs ??= resolve(join(here, '..', 'plugins', 'data'));
	opts.out ??= opts.packs;
	return opts;
}

const fmt = (n) => n.toLocaleString('en-US');
const pct = (a, b) => (b === 0 ? 'n/a' : `${((100 * a) / b).toFixed(1)}%`);
const countsLine = (levels) => levels.map((l) => `${l.name} ${fmt(l.entries.length)}`).join(', ');

function reportLines({ matched, built, checks, thresholds }) {
	const lines = [];
	lines.push(`thresholds: ${KEYS.map((k) => `${k} ${thresholds[k]}`).join(', ')}`);
	lines.push(`levels: ${countsLine(built.levels)}; cumulative ${checks.cumulative.join(' / ')} (targets ${TARGET_CUMULATIVE.join(' / ')})`);
	lines.push(`grammar expressions left out within R1: ${matched.expressions.filter((w) => w.rank <= thresholds.R1).length}`);
	lines.push(`matched ranks ${matched.words.length}, unmatched ${matched.unmatched.length} (within R1: ${matched.unmatched.filter((u) => u.rank <= thresholds.R1).length}), ambiguous ${matched.ambiguous}, repeated entries ${matched.repeats}`);
	lines.push(`single-kanji agreement: ${checks.singleKanji.agree} of ${checks.singleKanji.words} (${pct(checks.singleKanji.agree, checks.singleKanji.words)})`);
	const ew = checks.kanjiEasiestWord;
	lines.push(`JLPT kanji by their easiest word: ${ew.kanji} kanji, ${ew.same} same level (${pct(ew.same, ew.kanji)}), ${ew.oneHarder} one harder, ${ew.harder} harder`);
	lines.push(`monotonic, no level empty: ${checks.monotonic}`);
	lines.push(`JMdict-prioritised share per level: ${checks.prioritised.map((s, i) => `${LEVEL_NAMES[i]} ${(100 * s).toFixed(1)}%`).join(', ')}`);
	checks.samples.forEach((s, i) => lines.push(`sample ${LEVEL_NAMES[i]}: ${s.join(' ')}`));
	return lines;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const input = await readInputs(opts.packs);
	const index = jmdictIndex(input.entries);
	const matched = matchWords(input.jiten, index);
	const base = opts.base ? await readBase(opts.base) : null;
	const baseMatch = base ? baseLevels(base.texts, index) : null;

	if (opts.calibrate) {
		const fit = fitThresholds({ words: matched.words, kanji: input.kanji });
		console.log(`cumulative fit: ${KEYS.map((k) => `${k} ${fit.thresholds[k]}`).join(', ')}; cumulative ${fit.cumulative.join(' / ')}${fit.short.length ? `; short: ${fit.short.join(', ')}` : ''}`);
		const built = buildLevels({ words: matched.words, kanji: input.kanji, thresholds: fit.thresholds });
		for (const line of reportLines({ matched, built, checks: consistency({ placed: built.placed, kanji: input.kanji }), thresholds: fit.thresholds })) console.log(line);
		if (baseMatch) {
			for (const s of baseMatch.stats) console.log(`base ${s.name}: ${s.words} words, ${s.matched} matched, ${s.unmatched.length} unmatched, ${s.ambiguous} ambiguous`);
			const cal = calibrateWithBase({ words: matched.words, kanji: input.kanji, base: baseMatch });
			console.log(`base-fitted: ${KEYS.map((k) => `${k} ${cal.thresholds[k]}`).join(', ')}`);
			for (const [name, a] of [['train', cal.train], ['holdout', cal.holdout]]) {
				console.log(`${name}: ${a.agree} of ${a.words} (${pct(a.agree, a.words)}); ${a.perLevel.map((l) => `${l.name} ${pct(l.agree, l.words)} of ${l.words}`).join(', ')}`);
			}
			const asShipped = agreement(
				matched.words.filter(({ entry }) => baseMatch.levelOf.has(entry.seq) && entry.seq % 5 === 0).map(({ rank, entry }) => ({ rank, entry, level: baseMatch.levelOf.get(entry.seq) })),
				input.kanji,
				THRESHOLDS
			);
			console.log(`holdout with the shipped thresholds: ${asShipped.agree} of ${asShipped.words} (${pct(asShipped.agree, asShipped.words)}); ${asShipped.perLevel.map((l) => `${l.name} ${pct(l.agree, l.words)} of ${l.words}`).join(', ')}`);
		}
		return;
	}

	const thresholds = THRESHOLDS;
	const built = buildLevels({ words: matched.words, kanji: input.kanji, thresholds, base: baseMatch, entries: index.bySeq });
	const checks = consistency({ placed: built.placed, kanji: input.kanji });
	const total = built.levels.reduce((n, l) => n + l.entries.length, 0);
	const unmatchedWithin = matched.unmatched.filter((u) => u.rank <= thresholds.R1);
	const unmatchedTSV = `rank\tterms\n${unmatchedWithin.map((u) => `${u.rank}\t${u.rows.map((r) => (r.reading ? `${r.term}/${r.reading}` : r.term)).join(' ')}`).join('\n')}${unmatchedWithin.length ? '\n' : ''}`;
	const v = input.versions;
	const version = `jiten@${v.jiten}+jmdict@${v.jmdict}+${v.kanji}${base ? `+base@${sha256(Buffer.from(Object.values(base.texts).join(''))).slice(0, 7)}` : ''}`;

	const baseText = baseMatch
		? `\n\nBase list: ${built.fromBase} words keep the level of the base list read from n5.csv … n1.csv (SHA-256 of the five files: ${sha256(Buffer.from(Object.values(base.texts).join('')))}); see LICENSE-base. Per level: ${baseMatch.stats.map((s) => `${s.name} ${s.words} words, ${s.matched} matched, ${s.unmatched.length} unmatched, ${s.ambiguous} ambiguous`).join('; ')}. The estimate fills the rest.`
		: '';
	const extraFiles = { 'LICENSE-kanjiapi.dev': await readInput(join(opts.packs, 'jlpt-kanji', 'LICENSE'), 'jlpt-kanji LICENSE'), 'UNMATCHED.tsv': unmatchedTSV };
	if (base) extraFiles['LICENSE-base'] = base.license;

	await writePack(join(opts.out, 'jlpt-words'), {
		manifest: {
			id: 'jlpt-words',
			name: 'JLPT words (approximate)',
			version,
			type: 'levels',
			language: 'ja',
			license: base ? 'CC BY-SA 4.0 (see LICENSE-base for the base list)' : 'CC BY-SA 4.0',
			attribution:
				'An estimate of JLPT N5–N1 vocabulary levels by qinqin (scripts/prepare-jlpt-words.mjs; no official JLPT vocabulary list since 2010), ' +
				'derived from the Jiten frequency list (CC BY-SA 4.0, © Jitensoft, https://jiten.moe), JMdict (CC BY-SA 4.0, © EDRDG, https://www.edrdg.org/) ' +
				'and the approximate JLPT kanji levels (kanjiapi.dev, MIT, © 2023 Iridium Szreter; KANJIDIC2, CC BY-SA 4.0, © EDRDG)' +
				(base ? '; base list levels from the files in LICENSE-base' : ''),
			notice: JLPT_WORDS_NOTICE,
			format: 'json'
		},
		unit: 'word',
		levels: built.levels,
		license: input.files.jmdictLicense,
		extraFiles,
		attribution: `# JLPT words (approximate), ≈ N5 to ≈ N1

Japanese words grouped by an estimated JLPT level, ≈ N5 (easiest) to ≈ N1.
This is an estimate, not an official list:
no official JLPT vocabulary list has been published since 2010 (the Japan
Foundation and JEES stopped publishing the test's lists with the 2010
revision). qinqin computes it with \`scripts/prepare-jlpt-words.mjs\` from
three packs it already bundles:

- the Jiten frequency list (\`jiten-frequency\`, version ${v.jiten}),
  © Jitensoft, https://jiten.moe/frequency-dictionaries, CC BY-SA 4.0;
- JMdict (\`jmdict\`, version ${v.jmdict}), © Electronic Dictionary Research
  and Development Group (EDRDG),
  https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project,
  CC BY-SA 4.0 (EDRDG licence statement: https://www.edrdg.org/edrdg/licence.html);
- the approximate JLPT kanji levels (\`jlpt-kanji\`, version ${v.kanji}):
  kanjiapi.dev's list (MIT, Copyright 2023 Iridium Szreter,
  https://github.com/onlyskin/kanjiapi.dev; its licence text is
  LICENSE-kanjiapi.dev here) with gap fill from KANJIDIC2 (CC BY-SA 4.0, EDRDG).

Licence: this pack is an adaptation of the Jiten ranks and JMdict and is
shared under CC BY-SA 4.0 (LICENSE is the legal code, copied from the
bundled jmdict pack). Whoever redistributes it keeps these credits and
shares changes under CC BY-SA 4.0; the MIT notice of kanjiapi.dev stays with
it.

Method (one Jiten rank is one word):

1. Each rank's rows (every form and reading Jiten lists for the word) are
   matched to the JMdict entry that has most of them as a written form
   with that reading, a kana row as a reading. Ties go to the kana-written
   entry, then the one with more priority tags, then the lower sequence
   number (${fmt(matched.ambiguous)} ranks were ties, most of them beyond the cut below).
   ${fmt(matched.unmatched.length)} ranks match no entry; the ${fmt(unmatchedWithin.length)} of them within the cut are
   listed in UNMATCHED.tsv (inflected forms and grammar patterns such as
   はずだ and でした), never guessed. Grammar expressions (JMdict entries
   that are only expressions and start with a particle or the copula, such
   as のだ, として and かもしれない: the JLPT tests them as grammar) are
   left out (${fmt(matched.expressions.filter((w) => w.rank <= thresholds.R1).length)} within the cut).
2. Kanji level: the hardest JLPT kanji level among the kanji of the word's
   written form; a kanji the kanji list has no level for counts as N1.
   Kana-only words and words JMdict marks "usually written using kana
   alone" have none (する is not N1 for 為).
3. Rank level: Jiten rank ≤ ${fmt(thresholds.R5)} → ≈ N5, ≤ ${fmt(thresholds.R4)} → ≈ N4, ≤ ${fmt(thresholds.R3)} → ≈ N3,
   ≤ ${fmt(thresholds.R2)} → ≈ N2, ≤ ${fmt(thresholds.R1)} → ≈ N1; a word ranked beyond ${fmt(thresholds.R1)} is not
   listed.
4. The word's level is the harder of the two.

The rank cuts are fitted so the cumulative size up to each level matches the
commonly cited sizes of the JLPT vocabulary (${TARGET_CUMULATIVE.map(fmt).join(', ')} words
up to N5 … N1): sizes, not a list. There is no ground truth to measure
accuracy against; the consistency checks are:

- of the ${fmt(checks.singleKanji.words)} one-kanji words, ${fmt(checks.singleKanji.agree)} (${pct(checks.singleKanji.agree, checks.singleKanji.words)}) sit at their kanji's own level;
- of the ${fmt(checks.kanjiEasiestWord.kanji)} JLPT kanji the words use, ${fmt(checks.kanjiEasiestWord.same)} (${pct(checks.kanjiEasiestWord.same, checks.kanjiEasiestWord.kanji)}) first appear in a word
  at the kanji's own level, ${fmt(checks.kanjiEasiestWord.oneHarder)} one level harder, ${fmt(checks.kanjiEasiestWord.harder)} more;
- ${checks.monotonic ? 'no level is empty' : 'SOME LEVEL IS EMPTY'};
- the share of words JMdict marks with a priority tag (its own commonness
  data, independent of Jiten) per level: ${checks.prioritised.map((s, i) => `${LEVEL_NAMES[i]} ${(100 * s).toFixed(0)}%`).join(', ')}.

A word can be a level off; treat a level as a rough guide.${baseText}

Each level lists its words by Jiten rank. Entries are {"form", "reading"}
for a word with a kanji form, its kana for a kana-only word. ${fmt(total)} words;
levels: ${countsLine(built.levels)}.
`
	});

	// One entry per line, like hsk-words: half the size, and a re-run diffs by word.
	await writeFile(join(opts.out, 'jlpt-words', 'levels.json'), levelsJSON(built.levels, 'word'));

	for (const line of reportLines({ matched, built, checks, thresholds })) console.log(line);
	if (baseMatch) for (const s of baseMatch.stats) console.log(`base ${s.name}: ${s.words} words, ${s.matched} matched, ${s.unmatched.length} unmatched (${s.unmatched.slice(0, 20).join(' ')}), ${s.ambiguous} ambiguous`);
	console.log(`jlpt-words: ${total} words written to ${join(opts.out, 'jlpt-words')}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		await main();
	} catch (err) {
		if (!(err instanceof PackError)) throw err;
		console.error(`prepare-jlpt-words: ${err.message}`);
		process.exit(1);
	}
}

