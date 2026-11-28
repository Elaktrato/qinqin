#!/usr/bin/env node
// Build the estimated JLPT word list, the bundled levels pack jlpt-words
// (≈ N5 … ≈ N1), from data already in the repository (#219).
//
// Usage:
//   node scripts/prepare-jlpt-words.mjs [--packs <dir>] [--lists <dir>] [--out <dir>] [--base <dir>]
//   node scripts/prepare-jlpt-words.mjs --calibrate [--packs <dir>] [--lists <dir>] [--base <dir>]
//
// Inputs, all bundled under <packs> (default plugins/data); nothing here
// touches the network:
//   jiten-frequency/freq.csv.gz  Jiten word frequency ranks (CC BY-SA 4.0)
//   jmdict/jmdict.xml.gz         JMdict (CC BY-SA 4.0, EDRDG)
//   jlpt-kanji/levels.json       the approximate JLPT kanji levels
//                                (kanjiapi.dev MIT + KANJIDIC2 CC BY-SA 4.0)
//   joyo-grades/levels.json      the jōyō kanji (KANJIDIC2, CC BY-SA 4.0)
// with their LICENSE files and manifest versions, and the project lists in
// <lists> (default scripts/jlpt-words: core.tsv, grammar.tsv, anchors.tsv,
// CC BY 4.0). It (re)writes <out>/jlpt-words (default <out> = <packs>).
//
// No official JLPT vocabulary list has been published since 2010. The
// estimate (levelFor; the #219 teacher review set its rules):
//   - one Jiten rank is one word, matched to the JMdict entry that has most
//     of its rows as a written form with that reading (matchRank); ranks no
//     entry matches go to UNMATCHED.tsv, never guessed;
//   - the core list scripts/jlpt-words/core.tsv (N5/N4 textbook words,
//     written for qinqin, CC BY 4.0) sets its words' level directly;
//   - grammar pieces, set phrases, written numbers, noise and one-kana
//     fragments are left out (dropReason, scripts/jlpt-words/grammar.tsv);
//   - the Jiten rank level is the primary signal (thresholds R5 < … < R1;
//     beyond R1 a word is out unless JMdict counts it among its 6,000 most
//     frequent newspaper words);
//   - harder kanji (jlpt-kanji) raise a word by one level at most, and not
//     at all when JMdict gives it a priority tag; kana, usually-kana, ateji
//     and non-jōyō spellings count as kana words;
//   - JMdict priority tags lift a word (priorityLift); slang, colloquial
//     words and interjections go no easier than ≈ N3.
// scripts/jlpt-words/anchors.tsv lists words with the hardest level they may
// get: a regression check, reported by the CLI and asserted by the tests.
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
 * THRESHOLDS are the Jiten rank cuts (rank ≤ R5 → ≈ N5, … ≤ R1 → ≈ N1),
 * fitted so the cumulative size up to each level reaches its target
 * (fitThresholds; `--calibrate` prints the fit and the checks again).
 *
 * Fitted 2026-11-28 on jiten-frequency 2026-11-12, JMdict 2026-11-11,
 * jlpt-kanji kanjiapi.dev@76aa080+kanjidic2@2026-11-11 and the project lists
 * (core 538 words after the agent review). By rank: 800 / 1,500 / 3,700 /
 * 6,000 / 8,067 words; placed (after the core, the lifts and the other
 * rules): ≈ N5 544, ≈ N4 1,437, ≈ N3 3,798, ≈ N2 2,628, ≈ N1 1,592
 * (cumulative 544 / 1,981 / 5,779 / 8,407 / 9,999). Checks (no ground truth
 * exists; see the #219 plan, "Evaluation"):
 *   - anchors (scripts/jlpt-words/anchors.tsv): 81 of 81 at or under their
 *     level (the first estimate failed most of the review's examples);
 *   - core words placed by the rules alone (the core switched off): 70 of
 *     538 exact, 391 (72.7 %) within one level, 12 not listed;
 *   - blind teacher spot checks: see the plan;
 *   - left out within R1: 92 grammar expressions, 25 on the grammar list, 37
 *     noise, 33 written numbers, 12 one-kana fragments, 6 set phrases.
 * No base list was available (its licence is unconfirmed): accuracy against
 * a list is unmeasured. With one, run --calibrate --base <dir>.
 */
export const THRESHOLDS = { R5: 1226, R4: 2095, R3: 4719, R2: 7381, R1: 9844 };

/** The credit of the lists the project writes. */
const PROJECT_CREDIT = 'qinqin contributors, CC BY 4.0';

export const JLPT_WORDS_NOTICE =
	'The JLPT word levels are an estimate, not an official list: no official JLPT vocabulary list has been ' +
	'published since 2010. qinqin computes them from data it already bundles. A word\'s level comes mainly from ' +
	'how often it is used ([Jiten](https://jiten.moe/frequency-dictionaries) frequency ranks, CC BY-SA 4.0). A word ' +
	'JMdict marks as basic and common goes one or two levels easier, to ≈ N3 at most. Hard kanji (from ' +
	'the approximate JLPT kanji list, itself from [kanjiapi.dev](https://github.com/onlyskin/kanjiapi.dev), MIT, ' +
	'and KANJIDIC2) make a word one level harder at most, and only when JMdict does not mark it as common. About ' +
	'540 basic textbook words have their ≈ N5 or ≈ N4 level set directly, from a list written for qinqin (CC BY ' +
	'4.0) and reviewed by agents; other words are ≈ N4 or harder, except particles and other function words. ' +
	'The words and readings are ' +
	'[JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project) entries (CC BY-SA 4.0, ' +
	'EDRDG). About 10,000 words in all, ' +
	'as commonly cited for N1; a word can be a level off. The list is CC BY-SA 4.0.';

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
 * written using kana alone"), pri (the number of priority tags, used to
 * break ties), tags (the priority tags: news1, ichi1, nf07 …), misc and pos
 * (the sense tags and parts of speech of all senses), firstMisc and firstPos
 * (those of the first sense, the word's main use) and expOnly (every sense
 * is an expression, `exp`).
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
		const misc = new Set(senses.flatMap((sense) => entities(sense, 'misc')));
		const posSet = new Set();
		let last = [];
		for (const sense of senses) {
			const own = entities(sense, 'pos');
			if (own.length > 0) last = own;
			last.forEach((p) => posSet.add(p));
		}
		const priTags = new Set([...body.matchAll(/<(?:ke|re)_pri>([^<]+)<\/(?:ke|re)_pri>/g)].map((m) => m[1]));
		const firstMisc = new Set(entities(senses[0] ?? '', 'misc'));
		const firstPos = new Set(entities(senses[0] ?? '', 'pos'));
		out.push({ seq, kebs, rebs, uk, pri, expOnly, tags: priTags, misc, pos: posSet, firstMisc, firstPos });
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
 * matchWords matches every Jiten rank: words [{rank, entry}] (an entry
 * matched by several ranks keeps its best rank), unmatched [{rank, rows}]
 * and the counts of ambiguous matches and repeated entries.
 */
export function matchWords(jiten, index) {
	const words = [];
	const unmatched = [];
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
		words.push({ rank, entry: m.entry });
	}
	return { words, unmatched, ambiguous, repeats };
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
 * kanjiLevel is the hardest jlpt-kanji level among the kanji of the word's
 * written form (a jōyō kanji without a JLPT level counts as N1, index 4; 々 is
 * ignored), or null for a word read as a kana word: kana-only or usually
 * kana (為る, する), an ateji spelling (綺麗), or one with a kanji outside
 * the jōyō set `joyo` (when given): its kanji say nothing about how hard the
 * word is to learn.
 */
export function kanjiLevel(e, kanji, joyo = null) {
	if (kanaWritten(e)) return null;
	const head = e.kebs.find((k) => k.text === headForm(e));
	if (head?.inf.includes('ateji')) return null;
	let level = null;
	for (const ch of headForm(e)) {
		if (ch === ITERATION_MARK || !HAN.test(ch)) continue;
		if (joyo && !joyo.has(ch)) return null;
		level = Math.max(level ?? 0, kanji.get(ch) ?? LEVEL_NAMES.length - 1);
	}
	return level;
}

/** rankLevel is the level of a Jiten rank, or null beyond R1. */
export function rankLevel(rank, thresholds) {
	const i = KEYS.findIndex((key) => rank <= thresholds[key]);
	return i < 0 ? null : i;
}

/** nfOf is the entry's best newspaper frequency band (nf01 = the 500 most frequent words), Infinity without one. */
const nfOf = (e) => Math.min(Infinity, ...[...e.tags].filter((t) => /^nf\d\d$/.test(t)).map((t) => Number(t.slice(2))));

/**
 * LIFT_NF is the newspaper band (nf01 = the 500 most frequent newspaper
 * words) up to which a word on JMdict's basic list (ichi1) is placed one
 * level easier than its Jiten rank says (priorityLift); spec1 and gai1
 * (common loanwords: タクシー, レストラン) words are too.
 *
 * The #219 review asked for hard caps instead: nf01–nf06 → at most ≈ N4, and
 * news1 / ichi1 / spec1 / nf01–nf12 → at most ≈ N3. Measured on the bundled
 * data (2026-11-28) they cannot meet the commonly cited sizes: they cap about
 * 1,600 of the list's words at ≈ N4 and 6,300 at ≈ N3, against 1,500 and
 * 3,700 words up to those levels, and they fill ≈ N4 and ≈ N3 with newspaper
 * terms (首相, 知事, 民間, 癒着) while the rank cuts collapse (R3 = R4 = 739,
 * so 風呂 fell to ≈ N2). Tighter caps (ichi1 with nf01–nf03 → ≈ N4, ichi1
 * with nf04–nf12 → ≈ N3) still collapsed the cuts. A lift keeps the review's
 * intent (common daily-life words are easier than media frequency says)
 * and leaves the frequent words where the rank puts them; the core list sets
 * the basic N5/N4 words outright. Measured variants (core words placed by the
 * rules alone, within one level of their core level): this lift 87.8 %; one
 * level only 85.5 %; lifting into ≈ N5 too 87.8 % with ≈ N5 at 1,974 words;
 * no lift 58 %. The blind teacher spot check then showed lifted newspaper
 * words far too easy (急性, 麻薬 and 名目 at ≈ N3, both teachers N1): the lift
 * stops at ≈ N3 (LIFT_FROM) and needs the word to rank at ≈ N2 or harder.
 */
export const LIFT_NF = 12;
/** LIFT2_NF: up to this band a basic (ichi1) word is lifted two levels (今月, 図書館, 銀行). */
export const LIFT2_NF = 6;
/** LIFT_FROM: only a word the rank puts at ≈ N2 or harder is lifted, and no easier than ≈ N3. */
export const LIFT_FROM = 3;
/**
 * NONCORE_FLOOR: a word outside the core list goes no easier than ≈ N4, except
 * a kana function word (particle, pronoun, conjunction, auxiliary: は, これ,
 * でも). The blind teacher spot check of 2026-11-28 put the non-core words the
 * rank alone made ≈ N5 (先輩, 平気, 程度, 更に, 意外, 母親) mostly at N3: the
 * N5 vocabulary is the textbook core, and frequency in media does not make a
 * word N5.
 */
export const NONCORE_FLOOR = 1;
const FUNCTION_POS = ['prt', 'pn', 'conj', 'aux', 'aux-v', 'aux-adj', 'cop'];
const functionWord = (e) => kanaWritten(e) && FUNCTION_POS.some((p) => e.firstPos.has(p));

/**
 * priorityLift is how many levels easier JMdict's priority tags place a
 * word: 2 for a word on JMdict's basic list (ichi1) within nf01–LIFT2_NF;
 * 1 within nf01–LIFT_NF, or tagged spec1 or gai1; else 0. It counters the
 * media skew of the Jiten ranks (銀行, 郵便局 and 切符 rank low there, slang
 * ranks high).
 */
export function priorityLift(e) {
	const basic = e.tags.has('ichi1') || e.tags.has('spec1') || e.tags.has('gai1');
	if (!basic) return 0;
	const nf = nfOf(e);
	if (e.tags.has('ichi1') && nf <= LIFT2_NF) return 2;
	return nf <= LIFT_NF || e.tags.has('spec1') || e.tags.has('gai1') ? 1 : 0;
}

/**
 * GRAMMAR_HEAD is the first kana of a grammar expression: an `exp`-only
 * entry read with a particle or the copula first (のだ, ですか, として,
 * にとって, だろう) is a grammar pattern, which the JLPT tests as grammar,
 * not vocabulary, unless JMdict writes it with a kanji first (初めまして,
 * 申し訳ありません, 何も, 構わない): then it is a word or a set phrase.
 */
const GRAMMAR_HEAD = /^[のにとでかがはもをへだなや]/u;
/** SET_PHRASE: an `exp`-only phrase of a word, a particle and a verb (言葉を失う, 口を出す, 役に立てる). */
const SET_PHRASE = /\p{Script=Han}[\p{Script=Hiragana}]*?(?:を|が|に(?=\p{Script=Han}))./u;
const DIGIT = /[0-9０-９]/u;
const NOISE = /(.)\1\1/u;
/** CLIPPED: a kana word that starts with a small kana or ends in a small っ (っつ, ゲッ, あっ): a sound, not a word. */
const CLIPPED = /^[っッゃゅょぁぃぅぇぉャュョァィゥェォ]|[っッ]$/u;
const SMALL_KANA = /[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/gu;
const KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

/** kanaText is the text a kana-written word is read as: its first reading. */
const kanaText = (e) => e.rebs[0].text;

/**
 * dropReason says why an entry is left out of the list, or null (#219
 * review): a grammar piece on the project's list (`grammar list`, the
 * curated scripts/jlpt-words/grammar.tsv), a grammar expression
 * (GRAMMAR_HEAD), a set phrase (SET_PHRASE), a written number (５分:
 * `number`), noise (repeated letters, あああ; a clipped sound, っつ, ゲッ) or a one-kana fragment
 * that is not a particle (げ, ちょ: `fragment`).
 */
export function dropReason(e, ctx) {
	if (ctx.grammar?.has(e.seq)) return 'grammar list';
	const kanjiFirst = e.kebs.some((k) => !k.inf.includes('sK') && HAN.test(k.text[0]));
	if (e.expOnly && GRAMMAR_HEAD.test(kanaText(e)) && !kanjiFirst) return 'grammar';
	const form = headForm(e) ?? kanaText(e);
	if (e.expOnly && SET_PHRASE.test(form)) return 'phrase';
	if (DIGIT.test(form)) return 'number';
	if (NOISE.test(kanaText(e)) || NOISE.test(form)) return 'noise';
	if (kanaWritten(e) && CLIPPED.test(kanaText(e))) return 'noise';
	const kana = kanaText(e);
	if (kanaWritten(e) && KANA.test(kana) && kana.replace(SMALL_KANA, '').length === 1 && !e.pos.has('prt')) return 'fragment';
	return null;
}

/**
 * REGISTER_MISC: a word whose main (first) sense is slang, vulgar or
 * colloquial goes no easier than ≈ N3 (#219 review); so does an interjection
 * that is not on JMdict's basic lists (はい and ええ are ichi1, あっ and うわ are
 * not). Only the first sense counts: 行く and 手 have a colloquial sense too.
 */
const REGISTER_MISC = ['vulg', 'sl', 'col', 'm-sl', 'net-sl'];
const registerFloor = (e) =>
	REGISTER_MISC.some((m) => e.firstMisc.has(m)) || (e.firstPos.has('int') && !e.tags.has('ichi1') && !e.tags.has('spec1'));

/**
 * prepareWord reads off an entry everything levelFor needs, once: its rank,
 * kanji level, priority lift, whether it has any priority tag (pri), is on
 * JMdict's basic list among its 6,000 most frequent newspaper words (news:
 * such a word gets in even beyond R1), takes the register floor, why it is
 * dropped, and its core level.
 */
export function prepareWord({ rank, entry }, ctx) {
	return {
		rank,
		entry,
		k: kanjiLevel(entry, ctx.kanji, ctx.joyo),
		lift: priorityLift(entry),
		pri: entry.tags.size > 0,
		news: nfOf(entry) <= LIFT_NF && entry.tags.has('ichi1'),
		floor: registerFloor(entry),
		fn: functionWord(entry),
		drop: dropReason(entry, ctx),
		core: ctx.core?.get(entry.seq) ?? null
	};
}

/**
 * levelFor places a prepared word (#219 review rules), or null when it is
 * not listed:
 *   1. a core word takes its core level, always (useCore: false switches the
 *      core off, to measure the estimate on it);
 *   2. a dropped word is out;
 *   3. the Jiten rank level is the primary signal; beyond R1 a word is out
 *      unless it is a `news` word (then it starts at ≈ N1);
 *   4. kanji harder than that raise it by ONE level at most, and not at all
 *      when JMdict gives the word any priority tag;
 *   5. JMdict's priority tags lift a word the rank puts at ≈ N2 or harder
 *      one or two levels easier, to ≈ N3 at most (priorityLift);
 *   6. outside the core, no easier than ≈ N4 except kana function words
 *      (NONCORE_FLOOR);
 *   7. slang, colloquial words and interjections go no easier than ≈ N3.
 */
export function levelFor(p, thresholds, { useCore = true } = {}) {
	if (useCore && p.core !== null) return p.core;
	if (p.drop) return null;
	let level = rankLevel(p.rank, thresholds);
	if (level === null) {
		if (!p.news) return null;
		level = LEVEL_NAMES.length - 1;
	}
	if (p.k !== null && p.k > level && !p.pri) level += 1;
	if (level >= LIFT_FROM) level = Math.max(LIFT_FROM - 1, level - p.lift);
	if (!p.fn) level = Math.max(level, NONCORE_FLOOR);
	if (p.floor) level = Math.max(level, 2);
	return level;
}

const entryKey = (entry) => (typeof entry === 'string' ? entry : `${entry.form}\t${entry.reading}`);

/**
 * universe is every word the list may hold, prepared: the matched Jiten
 * ranks, then the core words and JMdict's top newspaper words Jiten does not
 * rank (rank Infinity), by sequence number.
 */
function universe(words, ctx, entries) {
	const ranked = new Set(words.map((w) => w.entry.seq));
	const out = words.map((w) => prepareWord(w, ctx));
	if (entries) {
		const extra = [];
		for (const e of entries.values()) {
			if (ranked.has(e.seq)) continue;
			if (ctx.core?.has(e.seq) || ctx.base?.levelOf.has(e.seq) || (nfOf(e) <= LIFT_NF && e.tags.has('ichi1'))) extra.push(e);
		}
		extra.sort((a, b) => a.seq - b.seq);
		for (const e of extra) out.push(prepareWord({ rank: Infinity, entry: e }, ctx));
	}
	return out;
}

/**
 * buildLevels places the words (levelFor; a base-list level, when a base list
 * is given, between the core and the estimate). Each level lists its words by
 * rank (unranked words last, by sequence number); a levels.json entry two
 * entries share is listed once, at the easier level.
 */
export function buildLevels({ words, ctx, base = null, entries = null, prepared = null }) {
	const all = prepared ?? universe(words, { ...ctx, base }, entries);
	const placed = [];
	for (const p of all) {
		const fromBase = p.core === null ? base?.levelOf.get(p.entry.seq) : undefined;
		const level = fromBase ?? levelFor(p, ctx.thresholds);
		if (level !== null) placed.push({ rank: p.rank, entry: p.entry, level, fromBase: fromBase !== undefined, core: p.core !== null });
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
	return { levels, placed: kept, fromBase: kept.filter((p) => p.fromBase).length, prepared: all };
}

/** cumulativeCounts counts the listed words at each level or easier. */
function cumulativeCounts(prepared, thresholds) {
	const per = [0, 0, 0, 0, 0];
	for (const p of prepared) {
		const level = levelFor(p, thresholds);
		if (level !== null) per[level]++;
	}
	let total = 0;
	return per.map((n) => (total += n));
}

/**
 * fitThresholds fits the rank cuts on the rank alone: each cut is the rank of
 * the target-th listable word (not dropped, not a core word, ranked by Jiten),
 * so ≈ N5 by frequency is the 800 most frequent listable words, and so on.
 * The review's rules then move words (the core, the lifts, the kanji raise,
 * the register floor), so the final sizes differ from the targets and are
 * reported (`cumulative`). Fitting the final sizes instead collapses the rank
 * bands (measured 2026-11-28: R5 = R4 = 646, and the core words placed by the
 * rules alone fall from 87.8 % to 64.5 % within one level). A target the data
 * cannot reach takes every word, and its level is named in `short`.
 */
export function fitThresholds({ words, ctx, targets = TARGET_CUMULATIVE, entries = null, prepared = null }) {
	const all = prepared ?? universe(words, ctx, entries);
	const ranks = all.filter((p) => !p.drop && p.core === null && p.rank !== Infinity).map((p) => p.rank).sort((a, b) => a - b);
	const thresholds = {};
	const short = [];
	KEYS.forEach((key, i) => {
		if (ranks.length < targets[i]) short.push(LEVEL_NAMES[i]);
		thresholds[key] = ranks[Math.min(targets[i], ranks.length) - 1] ?? 0;
	});
	// R1 alone is then fitted on the placed total: it decides only what is in,
	// and the core and newspaper words beyond it add to the list.
	if (!short.includes(LEVEL_NAMES[4])) {
		const lo = ranks.findIndex((r) => r >= thresholds.R2);
		let a = Math.max(lo, 0);
		let b = Math.min(targets[4], ranks.length) - 1;
		const total = (cut) => cumulativeCounts(all, { ...thresholds, R1: cut })[4];
		if (total(ranks[a]) >= targets[4]) b = a;
		while (a < b) {
			const mid = (a + b) >> 1;
			if (total(ranks[mid]) >= targets[4]) b = mid;
			else a = mid + 1;
		}
		thresholds.R1 = ranks[b];
	}
	const rankCumulative = KEYS.map((key) => ranks.filter((r) => r <= thresholds[key]).length);
	return { thresholds, rankCumulative, cumulative: cumulativeCounts(all, thresholds), short };
}

/**
 * consistency are the checks that stand in for an evaluation (no ground
 * truth exists): single-kanji words whose level equals their kanji's own JLPT
 * level, the core words as the estimate alone would place them (the core
 * switched off: exact, within one level, not listed), each JLPT kanji's
 * easiest word level against the kanji's own level, the cumulative sizes and
 * whether no level is empty, the share of JMdict-prioritised words per level
 * and `sample` evenly spaced words per level.
 */
export function consistency({ built, ctx, sample = 20 }) {
	const { placed, prepared } = built;
	const perLevel = LEVEL_NAMES.map(() => []);
	for (const p of placed) perLevel[p.level].push(p);
	let words = 0;
	let agree = 0;
	for (const p of placed) {
		const form = headForm(p.entry);
		if (kanaWritten(p.entry) || form === undefined || [...form].length !== 1 || !ctx.kanji.has(form)) continue;
		words++;
		if (ctx.kanji.get(form) === p.level) agree++;
	}
	const coreEstimate = { words: 0, exact: 0, withinOne: 0, unlisted: 0 };
	for (const p of prepared) {
		if (p.core === null) continue;
		coreEstimate.words++;
		const level = levelFor(p, ctx.thresholds, { useCore: false });
		if (level === null) coreEstimate.unlisted++;
		else if (level === p.core) coreEstimate.exact++;
		else if (Math.abs(level - p.core) === 1) coreEstimate.withinOne++;
	}
	const easiest = new Map();
	for (const p of placed) {
		if (kanaWritten(p.entry)) continue;
		for (const ch of new Set(headForm(p.entry))) {
			if (!ctx.kanji.has(ch)) continue;
			if (!easiest.has(ch) || p.level < easiest.get(ch)) easiest.set(ch, p.level);
		}
	}
	const kanjiEasiestWord = { kanji: easiest.size, same: 0, easier: 0, harder: 0 };
	for (const [ch, level] of easiest) {
		const d = level - ctx.kanji.get(ch);
		if (d === 0) kanjiEasiestWord.same++;
		else if (d < 0) kanjiEasiestWord.easier++;
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
		coreEstimate,
		kanjiEasiestWord,
		cumulative,
		monotonic: perLevel.every((list) => list.length > 0),
		prioritised: perLevel.map((list) => (list.length === 0 ? 0 : list.filter((p) => p.entry.tags.size > 0).length / list.length)),
		samples: perLevel.map((list) => {
			const n = Math.min(sample, list.length);
			return Array.from({ length: n }, (_, i) => display(list[Math.floor((i * list.length) / n)]));
		})
	};
}

// ---- the project lists (scripts/jlpt-words)

const LEVEL_OF = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };

/** listRows reads a project TSV: lines without "#", split on tabs. */
const listRows = (text) =>
	text
		.split('\n')
		.map((l) => l.replace(/\r$/, ''))
		.filter((l) => l.trim() !== '' && !l.startsWith('#'))
		.map((l) => l.split('\t').map((c) => c.trim()));

/**
 * findEntry matches a form (and reading, when given) to one JMdict entry: a
 * form with a reading by both; a kana form as a reading, kana-written words
 * first. Several candidates resolve to the one clearly first (kana-written,
 * then more priority tags, then more tags in all), else ambiguous.
 */
function findEntry(form, reading, index) {
	const found = index.byKey.get(reading ? `${form}\t${reading}` : `\t${form}`) ?? [];
	if (found.length === 0) return { entry: null };
	// A kana row names a kana-written word first (はい the reply, not 肺 the lung).
	const kanaRow = !reading;
	const rankOf = (e) => [kanaRow ? Number(kanaWritten(e)) : 0, e.tags.size, e.pri];
	const cmp = (a, b) => {
		const [x, y] = [rankOf(a), rankOf(b)];
		return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || a.seq - b.seq;
	};
	const sorted = [...found].sort(cmp);
	if (sorted.length > 1 && cmp(sorted[0], sorted[1]) === sorted[0].seq - sorted[1].seq) return { entry: null, ambiguous: true };
	return { entry: sorted[0] };
}

/**
 * parseCore reads core.tsv (level, form, reading; N5 or N4 only): levelOf
 * maps a JMdict sequence number to its level; unmatched and ambiguous name
 * the rows JMdict lacks or cannot tell apart (never guessed).
 */
export function parseCore(text, index) {
	const levelOf = new Map();
	const unmatched = [];
	const ambiguous = [];
	for (const [lv, form, reading = ''] of listRows(text)) {
		if (lv !== 'N5' && lv !== 'N4') fail(`core.tsv: level ${lv} of ${form}: the core holds N5 or N4 words`);
		const m = findEntry(form, reading, index);
		const name = reading ? `${form}/${reading}` : form;
		if (m.ambiguous) ambiguous.push(name);
		else if (!m.entry) unmatched.push(name);
		else if (!levelOf.has(m.entry.seq)) levelOf.set(m.entry.seq, LEVEL_OF[lv]);
	}
	return { levelOf, unmatched, ambiguous };
}

/** parseGrammar reads grammar.tsv (a form, optionally its reading): seqs are the JMdict entries to leave out. */
export function parseGrammar(text, index) {
	const seqs = new Set();
	const unmatched = [];
	for (const [form, reading = ''] of listRows(text)) {
		const found = index.byKey.get(reading ? `${form}\t${reading}` : `\t${form}`) ?? [];
		const exact = found.filter((e) => (reading ? true : kanaWritten(e)));
		if (exact.length === 0) unmatched.push(form);
		exact.forEach((e) => seqs.add(e.seq));
	}
	return { seqs, unmatched };
}

/** parseAnchors reads anchors.tsv (form, reading, the hardest level allowed). */
export function parseAnchors(text) {
	return listRows(text).map(([form, reading, max]) => {
		if (LEVEL_OF[max] === undefined) fail(`anchors.tsv: level ${max} of ${form}`);
		return { form, reading, max: LEVEL_OF[max] };
	});
}

/** checkAnchors looks up each anchor's level in the built list: misses are anchors missing or harder than allowed. */
function checkAnchors(anchors, built, index) {
	const levelOfSeq = new Map(built.placed.map((p) => [p.entry.seq, p.level]));
	const misses = [];
	for (const a of anchors) {
		const m = findEntry(a.form, a.reading, index);
		const level = m.entry ? levelOfSeq.get(m.entry.seq) : undefined;
		if (level === undefined || level > a.max) misses.push(`${a.form}/${a.reading}: ${level === undefined ? 'not listed' : LEVEL_NAMES[level]}, want ${LEVEL_NAMES[a.max]} or easier`);
	}
	return { anchors: anchors.length, held: anchors.length - misses.length, misses };
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

/** agreement counts, per level of the base list, the words the estimate (the core switched off) places at the same level. */
function agreement(items, thresholds) {
	const perLevel = LEVEL_NAMES.map((name) => ({ name, words: 0, agree: 0 }));
	for (const p of items) {
		perLevel[p.level].words++;
		if (levelFor(p, thresholds, { useCore: false }) === p.level) perLevel[p.level].agree++;
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
export function calibrateWithBase({ words, ctx, base }) {
	const prepared = words.map((w) => prepareWord(w, ctx));
	const items = prepared.filter((p) => base.levelOf.has(p.entry.seq)).map((p) => ({ ...p, level: base.levelOf.get(p.entry.seq) }));
	const train = items.filter((p) => p.entry.seq % 5 !== 0);
	const holdout = items.filter((p) => p.entry.seq % 5 === 0);
	const sortedRanks = [...new Set(words.map((w) => w.rank))].sort((a, b) => a - b);
	const grid = [...new Set(Array.from({ length: 401 }, (_, i) => sortedRanks[Math.floor((i * (sortedRanks.length - 1)) / 400)]))].filter((x) => x !== undefined);
	let thresholds = { ...fitThresholds({ words, ctx, prepared }).thresholds };
	let best = agreement(train, thresholds).agree;
	for (let sweep = 0; sweep < 10; sweep++) {
		let improved = false;
		KEYS.forEach((key, i) => {
			const lo = i === 0 ? 0 : thresholds[KEYS[i - 1]];
			const hi = i === KEYS.length - 1 ? Infinity : thresholds[KEYS[i + 1]];
			for (const cut of grid) {
				if (cut < lo || cut > hi || cut === thresholds[key]) continue;
				const trial = { ...thresholds, [key]: cut };
				const score = agreement(train, trial).agree;
				if (score > best) {
					best = score;
					thresholds = trial;
					improved = true;
				}
			}
		});
		if (!improved) break;
	}
	return { thresholds, train: agreement(train, thresholds), holdout: agreement(holdout, thresholds) };
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

/** readInputs reads the bundled packs and the project lists; a missing file fails before anything is written. */
async function readInputs(packs, lists) {
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
	const joyoHint = 'jlpt-words needs the jōyō kanji pack (plugins/data/joyo-grades, scripts/prepare-standard-levels.mjs)';
	const joyoLevels = JSON.parse((await readInput(join(packs, 'joyo-grades', 'levels.json'), joyoHint)).toString('utf8'));
	versions.joyo = JSON.parse((await readInput(join(packs, 'joyo-grades', 'manifest.json'), joyoHint)).toString('utf8')).version;
	const listText = {};
	for (const name of ['core.tsv', 'grammar.tsv', 'anchors.tsv']) {
		listText[name] = (await readInput(join(lists, name), `jlpt-words needs the project list ${name} (scripts/jlpt-words)`)).toString('utf8');
	}
	let jitenText;
	let jmdictText;
	try {
		jitenText = gunzipSync(files.jiten).toString('utf8');
		jmdictText = gunzipSync(files.jmdict).toString('utf8');
	} catch (err) {
		fail(`a bundled .gz input is not gzip: ${err.message}`);
	}
	return {
		files,
		versions,
		listText,
		jiten: parseJiten(jitenText),
		entries: parseJMdict(jmdictText),
		kanji: kanjiLevelMap(JSON.parse(files.kanji.toString('utf8'))),
		joyo: new Set(joyoLevels.levels.flatMap((l) => l.entries))
	};
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
		else if (a === '--packs' || a === '--out' || a === '--base' || a === '--lists') {
			if (argv[i + 1] === undefined) fail(`${a} needs a directory`);
			opts[a.slice(2)] = resolve(argv[++i]);
		} else fail(`unknown argument ${a}; usage: node scripts/prepare-jlpt-words.mjs [--calibrate] [--packs <dir>] [--lists <dir>] [--out <dir>] [--base <dir>]`);
	}
	const here = dirname(fileURLToPath(import.meta.url));
	opts.packs ??= resolve(join(here, '..', 'plugins', 'data'));
	opts.lists ??= resolve(join(here, 'jlpt-words'));
	opts.out ??= opts.packs;
	return opts;
}

const fmt = (n) => n.toLocaleString('en-US');
const pct = (a, b) => (b === 0 ? 'n/a' : `${((100 * a) / b).toFixed(1)}%`);
const countsLine = (levels) => levels.map((l) => `${l.name} ${fmt(l.entries.length)}`).join(', ');

/** dropCounts counts, per reason, the words within R1 the rules leave out. */
function dropCounts(prepared, thresholds) {
	const counts = {};
	for (const p of prepared) if (p.drop && p.core === null && p.rank <= thresholds.R1) counts[p.drop] = (counts[p.drop] ?? 0) + 1;
	return counts;
}

function reportLines({ matched, built, checks, thresholds, core, grammar, anchors }) {
	const lines = [];
	const drops = dropCounts(built.prepared, thresholds);
	lines.push(`thresholds: ${KEYS.map((k) => `${k} ${thresholds[k]}`).join(', ')}`);
	lines.push(`levels: ${countsLine(built.levels)}; cumulative ${checks.cumulative.join(' / ')} (targets ${TARGET_CUMULATIVE.join(' / ')})`);
	lines.push(`left out within R1: ${Object.entries(drops).sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
	lines.push(`matched ranks ${matched.words.length}, unmatched ${matched.unmatched.length} (within R1: ${matched.unmatched.filter((u) => u.rank <= thresholds.R1).length}), ambiguous ${matched.ambiguous}, repeated entries ${matched.repeats}`);
	lines.push(`core: ${core.levelOf.size} words, ${core.unmatched.length} unmatched, ${core.ambiguous.length} ambiguous`);
	if (core.unmatched.length || core.ambiguous.length) lines.push(`core misses: ${[...core.unmatched, ...core.ambiguous.map((a) => `${a} (ambiguous)`)].join(' ')}`);
	lines.push(`grammar list: ${grammar.seqs.size} entries${grammar.unmatched.length ? `; not in JMdict: ${grammar.unmatched.join(' ')}` : ''}`);
	const ce = checks.coreEstimate;
	lines.push(`core estimate: ${ce.words} words, ${ce.exact} exact, ${ce.exact + ce.withinOne} within one level (${pct(ce.exact + ce.withinOne, ce.words)}), ${ce.unlisted} not listed`);
	lines.push(`anchors: ${anchors.held} of ${anchors.anchors} at or under their level`);
	for (const m of anchors.misses) lines.push(`anchor miss ${m}`);
	lines.push(`single-kanji agreement: ${checks.singleKanji.agree} of ${checks.singleKanji.words} (${pct(checks.singleKanji.agree, checks.singleKanji.words)})`);
	const ew = checks.kanjiEasiestWord;
	lines.push(`JLPT kanji by their easiest word: ${ew.kanji} kanji, ${ew.same} same level (${pct(ew.same, ew.kanji)}), ${ew.easier} easier, ${ew.harder} harder`);
	lines.push(`monotonic, no level empty: ${checks.monotonic}`);
	lines.push(`JMdict-prioritised share per level: ${checks.prioritised.map((s, i) => `${LEVEL_NAMES[i]} ${(100 * s).toFixed(1)}%`).join(', ')}`);
	checks.samples.forEach((s, i) => lines.push(`sample ${LEVEL_NAMES[i]}: ${s.join(' ')}`));
	return lines;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const input = await readInputs(opts.packs, opts.lists);
	const index = jmdictIndex(input.entries);
	const matched = matchWords(input.jiten, index);
	const core = parseCore(input.listText['core.tsv'], index);
	const grammar = parseGrammar(input.listText['grammar.tsv'], index);
	const anchorList = parseAnchors(input.listText['anchors.tsv']);
	const base = opts.base ? await readBase(opts.base) : null;
	const baseMatch = base ? baseLevels(base.texts, index) : null;
	const ctx = { kanji: input.kanji, joyo: input.joyo, core: core.levelOf, grammar: grammar.seqs };
	const prepared = universe(matched.words, { ...ctx, base: baseMatch }, index.bySeq);

	if (opts.calibrate) {
		const fit = fitThresholds({ words: matched.words, ctx, prepared });
		console.log(`cumulative fit: ${KEYS.map((k) => `${k} ${fit.thresholds[k]}`).join(', ')}; by rank ${fit.rankCumulative.join(' / ')}; placed ${fit.cumulative.join(' / ')}${fit.short.length ? `; short: ${fit.short.join(', ')}` : ''}`);
		const fitCtx = { ...ctx, thresholds: fit.thresholds };
		const built = buildLevels({ words: matched.words, ctx: fitCtx, prepared });
		const checks = consistency({ built, ctx: fitCtx });
		for (const line of reportLines({ matched, built, checks, thresholds: fit.thresholds, core, grammar, anchors: checkAnchors(anchorList, built, index) })) console.log(line);
		if (baseMatch) {
			for (const s of baseMatch.stats) console.log(`base ${s.name}: ${s.words} words, ${s.matched} matched, ${s.unmatched.length} unmatched, ${s.ambiguous} ambiguous`);
			const cal = calibrateWithBase({ words: matched.words, ctx, base: baseMatch });
			console.log(`base-fitted: ${KEYS.map((k) => `${k} ${cal.thresholds[k]}`).join(', ')}`);
			for (const [name, a] of [['train', cal.train], ['holdout', cal.holdout]]) {
				console.log(`${name}: ${a.agree} of ${a.words} (${pct(a.agree, a.words)}); ${a.perLevel.map((l) => `${l.name} ${pct(l.agree, l.words)} of ${l.words}`).join(', ')}`);
			}
			const held = prepared.filter((p) => baseMatch.levelOf.has(p.entry.seq) && p.entry.seq % 5 === 0).map((p) => ({ ...p, level: baseMatch.levelOf.get(p.entry.seq) }));
			const asShipped = agreement(held, THRESHOLDS);
			console.log(`holdout with the shipped thresholds: ${asShipped.agree} of ${asShipped.words} (${pct(asShipped.agree, asShipped.words)}); ${asShipped.perLevel.map((l) => `${l.name} ${pct(l.agree, l.words)} of ${l.words}`).join(', ')}`);
		}
		return;
	}

	const thresholds = THRESHOLDS;
	const runCtx = { ...ctx, thresholds };
	const built = buildLevels({ words: matched.words, ctx: runCtx, base: baseMatch, prepared });
	const checks = consistency({ built, ctx: runCtx });
	const anchors = checkAnchors(anchorList, built, index);
	const drops = dropCounts(built.prepared, thresholds);
	const total = built.levels.reduce((n, l) => n + l.entries.length, 0);
	const fromCore = built.placed.filter((p) => p.core).length;
	const unmatchedWithin = matched.unmatched.filter((u) => u.rank <= thresholds.R1);
	const unmatchedTSV = `rank\tterms\n${unmatchedWithin.map((u) => `${u.rank}\t${u.rows.map((r) => (r.reading ? `${r.term}/${r.reading}` : r.term)).join(' ')}`).join('\n')}${unmatchedWithin.length ? '\n' : ''}`;
	const v = input.versions;
	const listsSum = sha256(Buffer.from(['core.tsv', 'grammar.tsv'].map((n) => input.listText[n]).join(''))).slice(0, 7);
	const version = `jiten@${v.jiten}+jmdict@${v.jmdict}+${v.kanji}+lists@${listsSum}${base ? `+base@${sha256(Buffer.from(Object.values(base.texts).join(''))).slice(0, 7)}` : ''}`;
	const ce = checks.coreEstimate;
	const ew = checks.kanjiEasiestWord;

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
				'derived from the Jiten frequency list (CC BY-SA 4.0, © Jitensoft, https://jiten.moe), JMdict (CC BY-SA 4.0, © EDRDG, https://www.edrdg.org/), ' +
				'the approximate JLPT kanji levels (kanjiapi.dev, MIT, © 2023 Iridium Szreter; KANJIDIC2, CC BY-SA 4.0, © EDRDG) ' +
				`and a core list of N5/N4 words written for qinqin (${PROJECT_CREDIT}, https://github.com/Elaktrato/qinqin)` +
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
four packs it already bundles and three short lists written for it:

- the Jiten frequency list (\`jiten-frequency\`, version ${v.jiten}),
  © Jitensoft, https://jiten.moe/frequency-dictionaries, CC BY-SA 4.0;
- JMdict (\`jmdict\`, version ${v.jmdict}), © Electronic Dictionary Research
  and Development Group (EDRDG),
  https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project,
  CC BY-SA 4.0 (EDRDG licence statement: https://www.edrdg.org/edrdg/licence.html);
- the approximate JLPT kanji levels (\`jlpt-kanji\`, version ${v.kanji}):
  kanjiapi.dev's list (MIT, Copyright 2023 Iridium Szreter,
  https://github.com/onlyskin/kanjiapi.dev; its licence text is
  LICENSE-kanjiapi.dev here) with gap fill from KANJIDIC2 (CC BY-SA 4.0, EDRDG);
- the jōyō kanji (\`joyo-grades\`, version ${v.joyo}, from KANJIDIC2, CC BY-SA 4.0, EDRDG);
- \`scripts/jlpt-words/core.tsv\` (${fmt(core.levelOf.size)} N5/N4 textbook words) and
  \`grammar.tsv\` (grammar pieces left out), written for qinqin:
  ${PROJECT_CREDIT}, https://github.com/Elaktrato/qinqin.

Licence: this pack is an adaptation of the Jiten ranks and JMdict and is
shared under CC BY-SA 4.0 (LICENSE is the legal code, copied from the
bundled jmdict pack). Whoever redistributes it keeps these credits and
shares changes under CC BY-SA 4.0; the MIT notice of kanjiapi.dev stays with
it.

Method:

1. Words: one Jiten rank is matched to the JMdict entry that has most of
   its rows (every form and reading Jiten lists under the rank) as a written
   form with that reading, a kana row as a reading. Ties go to the
   kana-written entry, then the one with more priority tags, then the lower
   sequence number. ${fmt(matched.unmatched.length)} ranks match no entry; the ${fmt(unmatchedWithin.length)} within the cut
   below are listed in UNMATCHED.tsv, never guessed. Words on JMdict's basic
   list (ichi1) among its 6,000 most frequent newspaper words (nf01–nf12) are
   in even when Jiten ranks them beyond the cut (郵便局, 切手).
2. The core list sets the level of its ${fmt(fromCore)} words directly.
3. Left out (within the cut): grammar pieces on the project's list and
   grammar expressions (JMdict entries that are only expressions, start
   with a particle or the copula and have no form starting with a kanji:
   のだ, として), set phrases of a word, a particle and a verb (言葉を失う),
   written numbers (５分), noise (repeated letters, あああ; clipped sounds,
   っつ, ゲッ) and one-kana fragments that are not particles (${Object.entries(drops).sort().map(([k, n]) => `${k} ${fmt(n)}`).join(', ')}).
4. Frequency first: Jiten rank ≤ ${fmt(thresholds.R5)} → ≈ N5, ≤ ${fmt(thresholds.R4)} → ≈ N4, ≤ ${fmt(thresholds.R3)} → ≈ N3,
   ≤ ${fmt(thresholds.R2)} → ≈ N2, ≤ ${fmt(thresholds.R1)} → ≈ N1; beyond that a word is not listed (but see 1).
5. Kanji: when the hardest JLPT kanji level of the word's written form is
   harder, the word goes ONE level harder, never more, and not at all when
   JMdict gives it any priority tag. Kana-only and usually-kana words,
   ateji spellings (綺麗) and spellings with a kanji outside the jōyō set
   count as kana words.
6. JMdict's priority tags lift a word that rank puts at ≈ N2 or harder,
   to ≈ N3 at most: two levels for a word on JMdict's basic list (ichi1)
   among its 3,000 most frequent newspaper words (nf01–nf06), one level for
   one among the 6,000 most frequent (nf07–nf12), or tagged spec1 or gai1.
7. Outside the core list a word goes no easier than ≈ N4, except a kana
   function word (a particle, pronoun, conjunction or auxiliary: は, これ,
   でも): ≈ N5 is the textbook core, and frequency in media does not make a
   word N5.
8. Slang, vulgar and colloquial words and interjections not on JMdict's
   basic lists go no easier than ≈ N3.

The rank cuts are fitted on the rank alone to the commonly cited cumulative
sizes of the JLPT vocabulary (${TARGET_CUMULATIVE.map(fmt).join(', ')} words up to N5 … N1;
sizes, not a list), the last one on the whole list; the rules above then move
words, so the level sizes differ from those (see the level counts below). There is no ground truth to measure accuracy against; the
checks are:

- the ${fmt(ce.words)} core words placed by the rules alone (the core switched off):
  ${fmt(ce.exact)} at their core level, ${fmt(ce.exact + ce.withinOne)} (${pct(ce.exact + ce.withinOne, ce.words)}) within one level, ${fmt(ce.unlisted)} not listed;
- ${fmt(anchors.held)} of ${fmt(anchors.anchors)} anchor words (scripts/jlpt-words/anchors.tsv) at or under
  their allowed level;
- of the ${fmt(checks.singleKanji.words)} one-kanji words, ${fmt(checks.singleKanji.agree)} (${pct(checks.singleKanji.agree, checks.singleKanji.words)}) sit at their kanji's own level;
- of the ${fmt(ew.kanji)} JLPT kanji the words use, ${fmt(ew.same)} (${pct(ew.same, ew.kanji)}) first appear in a word
  at the kanji's own level, ${fmt(ew.easier)} in an easier one, ${fmt(ew.harder)} in a harder one;
- ${checks.monotonic ? 'no level is empty' : 'SOME LEVEL IS EMPTY'}.

A word can be a level off; treat a level as a rough guide.${baseText}

Each level lists its words by Jiten rank (unranked words last). Entries are
{"form", "reading"} for a word with a kanji form, its kana for a kana-only
word. ${fmt(total)} words; levels: ${countsLine(built.levels)}.
`
	});
	// One entry per line, like hsk-words: half the size, and a re-run diffs by word.
	await writeFile(join(opts.out, 'jlpt-words', 'levels.json'), levelsJSON(built.levels, 'word'));

	for (const line of reportLines({ matched, built, checks, thresholds, core, grammar, anchors })) console.log(line);
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
