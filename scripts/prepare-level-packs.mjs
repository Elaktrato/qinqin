#!/usr/bin/env node
// Convert the upstream JLPT and HSK 3.0 lists into qinqin level packs.
//
// Three modes. The JLPT kanji pack is bundled in the repository; the HSK 3.0
// packs and the JLPT vocabulary pack are NOT (their licence status is unclear:
// the hsk30 data may be Ministry of Education copyright, and the JLPT
// vocabulary licence chain could not be verified): they are optional,
// local-only packs you generate yourself.
//
// Usage:
//   node scripts/prepare-level-packs.mjs <upstream-dir> [<packs-dir>]
//   node scripts/prepare-level-packs.mjs --calibrate <upstream-dir> [<packs-dir>]
//   node scripts/prepare-level-packs.mjs --hsk <hsk-dir> [<local-packs-dir>]
//   node scripts/prepare-level-packs.mjs --jlpt-vocab <jlpt-vocab-dir> [<local-packs-dir>]
//
// JLPT mode: <upstream-dir> must hold the two upstream files of the kanji
// list, downloaded unmodified from the pinned commit below (a maintainer
// step; nothing here touches the network):
//
//   curl -fsSLo jlpt.tsv              https://raw.githubusercontent.com/onlyskin/kanjiapi.dev/76aa080cdf56aa7587304d925e1435bb93469b79/jlpt.tsv
//   curl -fsSLo kanjiapi.dev-LICENSE  https://raw.githubusercontent.com/onlyskin/kanjiapi.dev/76aa080cdf56aa7587304d925e1435bb93469b79/LICENSE
//
// It also reads the bundled KANJIDIC2 (<packs-dir>/kanjidic2/kanjidic2.xml.gz
// and its LICENSE) and (re)writes the pack directory jlpt-kanji under
// <packs-dir> (default plugins/data): the approximate scheme "JLPT kanji
// (approximate)", kanjiapi.dev's levels plus a level derived from KANJIDIC2
// for the kanji it omits (see gapLevel and the calibration notes there).
// --calibrate prints the evaluation behind the gap-fill thresholds.
//
// JLPT vocabulary mode (optional, local use only, not bundled): <jlpt-vocab-dir>
// holds the JLPT vocabulary CSVs of open-anki-jlpt-decks and its licence, as
// published at the pinned commit:
//
//   base=https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0
//   for n in n5 n4 n3 n2 n1; do curl -fsSLo $n.csv $base/src/$n.csv; done
//   curl -fsSLo LICENSE $base/LICENSE
//
// It (re)writes jlpt-words under <local-packs-dir> (default plugins/data-local,
// gitignored; created if missing). Seed it with:
// qinqin seed --packs plugins/data,plugins/data-local
//
// HSK mode (optional, local use only, not bundled): <hsk-dir> must hold the
// three upstream files of ivankra/hsk30 at the pinned commit:
//
//   curl -fsSLo hsk30.csv             https://raw.githubusercontent.com/ivankra/hsk30/4ff9e3915ce87baaecd7ebe263085573a4ea3192/hsk30.csv
//   curl -fsSLo hsk30-chars.csv       https://raw.githubusercontent.com/ivankra/hsk30/4ff9e3915ce87baaecd7ebe263085573a4ea3192/hsk30-chars.csv
//   curl -fsSLo hsk30-LICENSE         https://raw.githubusercontent.com/ivankra/hsk30/4ff9e3915ce87baaecd7ebe263085573a4ea3192/LICENSE
//
// It (re)writes hsk30-chars and hsk30-words under <local-packs-dir>
// (default plugins/data-local, gitignored; created if missing). Seed them
// with: qinqin seed --packs plugins/data,plugins/data-local
//
// Each pack has manifest.json, levels.json, LICENSE (the upstream licence,
// verbatim) and ATTRIBUTION.md. The output depends only on the input files,
// so a re-run on the same inputs reproduces the packs byte for byte. Files
// that differ from the pinned SHA-256 sums are converted too, with a
// warning: ATTRIBUTION.md records the sums of the files actually used.
//
// Level order is easiest first, which is how the importer reads a pack (a
// character derived from words keeps the lowest level it appears in).
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const KANJIAPI_COMMIT = '76aa080cdf56aa7587304d925e1435bb93469b79';
const HSK30_COMMIT = '4ff9e3915ce87baaecd7ebe263085573a4ea3192';
const JLPT_DECKS_COMMIT = '1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0';

const PINNED_SHA256 = {
	'jlpt.tsv': '52ff4165bc3bac8d5784c8521c41a2255c0346a580d8f24ab0f259451564ccfe',
	'kanjiapi.dev-LICENSE': '8d46c4a0a18ed265ad8824e54c2f2ae672a6c1c8dd01177e3928fb03e45be2c9'
};

// The ivankra/hsk30 files (HSK mode), read from <hsk-dir>.
const PINNED_HSK_SHA256 = {
	'hsk30.csv': '8c2b73f74776240bcf154624730fc6fb2c42c254d5c5d0f88943878b8e575b9b',
	'hsk30-chars.csv': '8c5957108e6dafd120be10518a827a4d834ea3ce29acbfedeff1022cd7d05280',
	'hsk30-LICENSE': '9cd70c000ea23c899e71b2cbe7c28e18c60937f6e74d1b344d2923f6bddae44a'
};

// The open-anki-jlpt-decks files, read from <jlpt-vocab-dir>.
const PINNED_VOCAB_SHA256 = {
	'n5.csv': 'f89abc86b391c4f2b551bbf8910b0de6cd600973b3a9f8d98347513921929ebe',
	'n4.csv': '0e835f40a8d2a1f191d7aa499076002756fa099b95634758376f43c73793e9f6',
	'n3.csv': 'ba071571d344e60b0e1fd11cd2e98a6aaa04515361653ca45147129460531297',
	'n2.csv': '2d0f1ddd6222881cd9fc2ca701db74300af99b3f1f84d5ac3c18411c20f0c055',
	'n1.csv': '120911636c019899552aa6d7bd64b036ecef4bedfe272a744f75735c46aae5cd',
	LICENSE: 'dfb9747630305cda572f2ed4f77586593ead9f886dc784ee3cd4e35a19acd9eb'
};

// HSK 3.0 levels as the lists spell them, and the level names the packs use.
const HSK_LEVELS = ['1', '2', '3', '4', '5', '6', '7-9'];
const hskLevelName = (level) => (level === '7-9' ? 'HSK 7–9' : `HSK ${level}`);

// JLPT: the file numbers levels 5 (easiest) … 1.
const JLPT_LEVELS = ['5', '4', '3', '2', '1'];

const HSK30_CAVEAT = `the hsk30 README scopes its licence: "Code (\`*.ipynb\`)
is MIT licensed." Of the data it says: "Data (\`hsk30*.csv\`) is largely
derived from elkmovie/hsk30 and shawkynasr/HSK-official-Query-System repos,
both also under MIT license and claiming copyright -- of course, somewhat
questionably, as the original work they *copy* is PRC's government work
(notice on website: \`版权所有：中华人民共和国教育部\`). Depending on PRC law
specifics might be public domain." Per the same README, elkmovie/hsk30 is a
proof-read OCR of the Ministry of Education's scanned standard (hanzi only)
and shawkynasr/HSK-official-Query-System a copy of the HSK website's
(chinesetest.cn) database; these packs use only the hanzi and the levels.
The data is thus MIT-labelled upstream, the ministry's site claims copyright
in the original (版权所有, "all rights reserved"), and upstream suggests it
may be public domain: its copyright status is uncertain. qinqin
redistributes it under the MIT terms the upstream files state and claims
nothing beyond them.`;

const HAN = /^\p{Script=Han}$/u;

/** PackError is a malformed or missing input; main prints it and exits 1. */
export class PackError extends Error {}

function fail(message) {
	throw new PackError(message);
}

/** stripBOM drops a leading byte order mark. */
const stripBOM = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** parseCSV reads RFC 4180 CSV (quoted fields, "" escapes, LF or CRLF). */
export function parseCSV(text) {
	const rows = [];
	let row = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += c;
			}
		} else if (c === '"') {
			quoted = true;
		} else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += c;
		}
	}
	if (quoted) fail('unterminated quoted field');
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/**
 * records parses one CSV file into objects keyed by its header row; a
 * malformed or empty file fails with the file's name.
 */
export function records(text, file, required) {
	let rows;
	try {
		rows = parseCSV(stripBOM(text));
	} catch (err) {
		fail(`${file}: ${err.message}`);
	}
	if (rows.length === 0) fail(`${file}: empty file, want a header row`);
	const [header, ...body] = rows;
	for (const name of required) {
		if (!header.includes(name)) fail(`${file}: missing column ${name} (header: ${header.join(',')})`);
	}
	return body.map((cells, i) => {
		if (cells.length !== header.length) {
			fail(`${file}: row ${i + 2} has ${cells.length} fields, want ${header.length}`);
		}
		return Object.fromEntries(header.map((name, j) => [name, cells[j]]));
	});
}

function uniquePush(list, seen, value) {
	if (!seen.has(value)) {
		seen.add(value);
		list.push(value);
	}
}

/** jlptLevels reads kanjiapi.dev's jlpt.tsv: `<n>\t<kanji run>` per level. */
function jlptLevels(text) {
	const byLevel = new Map();
	for (const line of text.split('\n')) {
		if (line.trim() === '') continue;
		const [n, run, ...rest] = line.split('\t');
		if (rest.length > 0 || !JLPT_LEVELS.includes(n) || run === undefined) {
			fail(`jlpt.tsv: unexpected line ${JSON.stringify(line.slice(0, 40))}`);
		}
		if (byLevel.has(n)) fail(`jlpt.tsv: level ${n} appears twice`);
		byLevel.set(n, Array.from(run.trim()));
	}
	const seen = new Map();
	return JLPT_LEVELS.map((n) => {
		const chars = byLevel.get(n);
		if (chars === undefined) fail(`jlpt.tsv: level ${n} is missing`);
		const entries = [];
		const inLevel = new Set();
		for (const ch of chars) {
			if (!HAN.test(ch)) fail(`jlpt.tsv: N${n} holds non-Han ${JSON.stringify(ch)}`);
			if (seen.has(ch)) fail(`jlpt.tsv: ${ch} is in N${seen.get(ch)} and N${n}`);
			seen.set(ch, n);
			uniquePush(entries, inLevel, ch);
		}
		return { name: `N${n}`, entries };
	});
}

// The gap fill of the approximate JLPT kanji pack: kanji kanjiapi.dev's list
// leaves out get a level derived from three KANJIDIC2 fields, the old
// (pre-2010) four-level <jlpt>, the school <grade> (1–6 kyōiku, 8 the rest of
// the jōyō list, 9–10 jinmeiyō name kanji) and the newspaper <freq> rank
// (1 = most frequent of 2,500). The thresholds below were calibrated on
// 2026-11-14 against the reference set itself: the 2,211 kanji of
// kanjiapi.dev's jlpt.tsv (commit 76aa080), whose level is the target, and
// KANJIDIC2 2026-11-11. Split: a kanji whose code point is a multiple of 5
// is held out (449 kanji, 20.3%), the others train (1,762); each constant
// is the best fit on the training kanji alone, ties to the lowest value.
// `node scripts/prepare-level-packs.mjs --calibrate <upstream-dir>` prints
// these numbers again.
//
// Old level 2 (739 kanji in KANJIDIC2, 733 of them in the reference list:
// N4 1, N3 339, N2 349, N1 44) splits by frequency: rank <= the cut → N3,
// else (or no rank) → N2. Best cut on the 587 training kanji: 521, agreeing
// on 386 (65.8%; always-N2 would get 281, 47.9%); held out 87 of 146
// (59.6%). (On all 733 the best cut would be 648, 478 = 65.2%; the 6
// old-level-2 kanji the gap fill places, 可 身 的 無 畑 坊, land the same
// under either.) The whole old-level mapping (4→N5, 3→N4, 2→cut, 1→N1)
// agrees with the reference on train 1,509/1,762 (85.6%: N5 62/62,
// N4 100/115, N3 156/297, N2 230/298, N1 961/990), held out 373/449 (83.1%:
// N5 17/17, N4 43/51, N3 28/70, N2 59/69, N1 226/242).
export const OLD2_N3_MAX_FREQ = 521;
//
// Jōyō kanji with no old level: level by school grade, the easiest level
// whose maximum grade the kanji's grade does not exceed, else N1 (grade 6
// and the secondary-school grade 8). Fitted on the 1,560 training jōyō
// kanji (grades 1–8) of the reference list, exhaustively over monotone
// grade cuts: train 989/1,560 (63.4%: N5 40/62, N4 49/115, N3 125/297,
// N2 63/298, N1 712/788), held out 253/404 (62.6%: N5 9/17, N4 24/51,
// N3 44/70, N2 10/69, N1 166/197). Frequency was tried and rejected: the
// best four frequency-rank cuts (37/67/590/827) reach train 61.2% but held
// out only 54.2%, frequency within grades 1–6 with grade 8 → N1 held out
// 57.4%, and for grade 8 (151 of the 157 kanji this rule places) no
// frequency cut beats "all N1" (train 632/761, held out 158/191). The
// frequency rank only keeps its guard: a jōyō kanji with neither an old
// level nor a frequency rank goes to N1.
//
// What these numbers do NOT say: every reference kanji has an old level,
// so the rule was fitted and scored on kanji it never places. It only
// places jōyō kanji WITHOUT an old level: 151 of its 157 are grade 8,
// mostly the 2010 jōyō additions (誰 頃 俺 闇 謎 鍵 …), all put at N1. Its
// accuracy on them is unmeasured (the reference set cannot measure it) and
// probably lower for the common ones. KANJIDIC2's <freq> is newspaper data
// from before 2010 and under-ranks them: 74 of the 151 have no rank, and the
// ranked ones have a median rank of 2,156 against 1,466 for the reference
// list's grade-8 kanji. A modern-corpus rank (the bundled Jiten word list)
// was tried in review and scored lower on the reference set (jōyō held out
// 55.2%; on grade 8 below all-N1), though it would put 誰 and 頃 at N3: an
// owner judgment, not a calibration result, so it is not used.
//
// Grade 6 → N1 is the fitted cut (reference grade-6 kanji: N1 88, N2 57,
// N3 43); it places no kanji today (every grade-6 kanji has an old level or
// is in the base list) and would matter only after a KANJIDIC2 refresh.
export const GRADE_LEVEL_MAX = [
	['N5', 1],
	['N4', 2],
	['N3', 4],
	['N2', 5]
];

const OLD_LEVEL_MAP = { 4: 'N5', 3: 'N4', 1: 'N1' };

/**
 * gapLevel is the level the approximate pack gives a kanji kanjiapi.dev does
 * not list, from its KANJIDIC2 fields {grade, freq, old} (null when absent),
 * or null when it stays out of the scheme: rule a, an old <jlpt> level
 * (4→N5, 3→N4, 1→N1; 2 → N3 at or below OLD2_N3_MAX_FREQ, else N2); rule b,
 * a jōyō grade 1–8 (GRADE_LEVEL_MAX; N1 without a frequency rank); rule c,
 * anything else (jinmeiyō, grade-less) is not listed.
 */
export function gapLevel({ grade, freq, old }) {
	if (old !== null) {
		if (old === 2) return freq !== null && freq <= OLD2_N3_MAX_FREQ ? 'N3' : 'N2';
		return OLD_LEVEL_MAP[old] ?? fail(`KANJIDIC2: unknown old JLPT level ${old}`);
	}
	if (grade === null || grade > 8) return null;
	if (freq === null) return 'N1';
	for (const [level, maxGrade] of GRADE_LEVEL_MAX) {
		if (grade <= maxGrade) return level;
	}
	return 'N1';
}

const KANJIDIC2_CHARACTER = /<character>([\s\S]*?)<\/character>/g;

function xmlInt(block, tag, literal) {
	const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block);
	if (m === null) return null;
	if (!/^\d+$/.test(m[1])) fail(`KANJIDIC2: ${literal} has a non-numeric <${tag}> ${JSON.stringify(m[1])}`);
	return Number(m[1]);
}

/**
 * parseKanjidic2 reads the fields the gap fill uses from KANJIDIC2 XML: a
 * Map from each literal, in file order, to {grade, freq, old} (null when
 * the element is absent; old is the pre-2010 <jlpt> level).
 */
export function parseKanjidic2(xml) {
	const kanji = new Map();
	for (const [, block] of xml.matchAll(KANJIDIC2_CHARACTER)) {
		const m = /<literal>([^<]*)<\/literal>/.exec(block);
		if (m === null || !HAN.test(m[1])) fail(`KANJIDIC2: a <character> without one Han <literal> (${JSON.stringify(m?.[1])})`);
		const literal = m[1];
		if (kanji.has(literal)) fail(`KANJIDIC2: ${literal} appears twice`);
		kanji.set(literal, {
			grade: xmlInt(block, 'grade', literal),
			freq: xmlInt(block, 'freq', literal),
			old: xmlInt(block, 'jlpt', literal)
		});
	}
	if (kanji.size === 0) fail('KANJIDIC2: no <character> elements');
	return kanji;
}

/**
 * approxJlptLevels builds the approximate N5–N1 levels: every kanji of
 * kanjiapi.dev's jlpt.tsv at its listed level, in file order, then each
 * kanji it leaves out that gapLevel places, appended to its level by
 * frequency rank (none last), then code point. added counts the appended
 * kanji by rule: old (an old <jlpt> level) and grade (the grade rule).
 */
export function approxJlptLevels(tsv, kanjidic) {
	const levels = jlptLevels(tsv);
	const listed = new Set(levels.flatMap((level) => level.entries));
	const gap = new Map(levels.map((level) => [level.name, []]));
	const added = { old: 0, grade: 0 };
	for (const [ch, info] of kanjidic) {
		if (listed.has(ch)) continue;
		const level = gapLevel(info);
		if (level === null) continue;
		gap.get(level).push({ ch, freq: info.freq ?? Infinity });
		added[info.old !== null ? 'old' : 'grade']++;
	}
	for (const level of levels) {
		const extra = gap.get(level.name).sort((a, b) => a.freq - b.freq || a.ch.codePointAt(0) - b.ch.codePointAt(0));
		level.entries.push(...extra.map((e) => e.ch));
	}
	return { levels, added };
}

/** holdsOut is the calibration split: a code point that is a multiple of 5. */
const holdsOut = (ch) => ch.codePointAt(0) % 5 === 0;

/**
 * calibrate refits OLD2_N3_MAX_FREQ and GRADE_LEVEL_MAX on the training
 * part of the reference list (exhaustive search, ties to the lowest value)
 * and returns the report lines: the fitted values and the agreement per
 * level on the training and held-out kanji.
 */
export function calibrate(tsv, kanjidic) {
	const ref = [];
	for (const level of jlptLevels(tsv)) {
		for (const ch of level.entries) {
			const info = kanjidic.get(ch);
			if (info !== undefined) ref.push({ ch, level: level.name, ...info });
		}
	}
	const train = ref.filter((k) => !holdsOut(k.ch));
	const held = ref.filter((k) => holdsOut(k.ch));
	const score = (items, predict) => {
		const per = ['N5', 'N4', 'N3', 'N2', 'N1'].map((name) => {
			const of = items.filter((k) => k.level === name);
			return `${name} ${of.filter((k) => predict(k) === name).length}/${of.length}`;
		});
		const ok = items.filter((k) => predict(k) === k.level).length;
		const pct = items.length === 0 ? '–' : `${((100 * ok) / items.length).toFixed(1)}%`;
		return `${ok}/${items.length} (${pct}: ${per.join(', ')})`;
	};
	const best = (candidates, items, predictWith) => {
		let top;
		for (const c of candidates) {
			const ok = items.filter((k) => predictWith(c)(k) === k.level).length;
			if (top === undefined || ok > top.ok) top = { c, ok };
		}
		return top.c;
	};

	const old2 = (cut) => (k) => (k.freq !== null && k.freq <= cut ? 'N3' : 'N2');
	const cut = best(
		Array.from({ length: 2501 }, (_, i) => i),
		train.filter((k) => k.old === 2),
		old2
	);
	const oldRule = (k) => (k.old === 2 ? old2(cut)(k) : OLD_LEVEL_MAP[k.old] ?? null);

	const grades = [0, 1, 2, 3, 4, 5, 6, 8];
	const cuts = [];
	for (let a = 0; a < grades.length; a++)
		for (let b = a; b < grades.length; b++)
			for (let c = b; c < grades.length; c++)
				for (let d = c; d < grades.length; d++) cuts.push([grades[a], grades[b], grades[c], grades[d]]);
	const gradeRule = (max) => (k) => {
		if (k.freq === null) return 'N1';
		const i = max.findIndex((m) => k.grade <= m);
		return i === -1 ? 'N1' : ['N5', 'N4', 'N3', 'N2'][i];
	};
	const joyo = (k) => k.grade !== null && k.grade <= 8;
	const gradeMax = best(cuts, train.filter(joyo), gradeRule);

	return [
		`reference ${ref.length} kanji: train ${train.length}, held out ${held.length} (code point % 5 === 0)`,
		`old level 2 cut: ${cut} (constant ${OLD2_N3_MAX_FREQ})`,
		`  old 2 train   ${score(train.filter((k) => k.old === 2), old2(cut))}`,
		`  old 2 held    ${score(held.filter((k) => k.old === 2), old2(cut))}`,
		`  old map train ${score(train.filter((k) => k.old !== null), oldRule)}`,
		`  old map held  ${score(held.filter((k) => k.old !== null), oldRule)}`,
		`grade cuts N5..N2: ${gradeMax.join('/')} (constant ${GRADE_LEVEL_MAX.map(([, m]) => m).join('/')})`,
		`  jōyō train    ${score(train.filter(joyo), gradeRule(gradeMax))}`,
		`  jōyō held     ${score(held.filter(joyo), gradeRule(gradeMax))}`
	];
}

/** hskCharLevels reads hsk30-chars.csv, grouped by reading level. */
function hskCharLevels(text) {
	const rows = records(text, 'hsk30-chars.csv', ['Hanzi', 'Level']);
	const byLevel = new Map(HSK_LEVELS.map((level) => [level, []]));
	const seen = new Set();
	for (const row of rows) {
		const ch = row.Hanzi.trim();
		if (!HAN.test(ch)) fail(`hsk30-chars.csv: ${JSON.stringify(row.Hanzi)} is not one Han character`);
		if (!byLevel.has(row.Level)) fail(`hsk30-chars.csv: ${ch} has unknown level ${row.Level}`);
		if (seen.has(ch)) fail(`hsk30-chars.csv: ${ch} appears twice`);
		seen.add(ch);
		byLevel.get(row.Level).push(ch);
	}
	return {
		rows: rows.length,
		levels: HSK_LEVELS.map((level) => ({ name: hskLevelName(level), entries: byLevel.get(level) }))
	};
}

// A cleaned word form: Han characters, plus the Latin letters and digits
// of words such as 卡拉OK or T恤. The list's markup (｜ variants, （） examples,
// …, sense numbers 称1) never survives into a form.
const WORD_FORM = /^[\p{Script=Han}A-Za-z]+$/u;

/**
 * wordForms returns the simplified forms one hsk30.csv row lists: the
 * cleaned Variants (upstream's own list, without the entries it marks as
 * mere examples of a prefix or suffix) when present, else the Simplified
 * column as it is.
 */
function wordForms(row) {
	let forms;
	if (row.Variants.trim() !== '') {
		let variants;
		try {
			variants = JSON.parse(row.Variants);
		} catch (err) {
			fail(`hsk30.csv: ${row.ID}: Variants is not JSON: ${err.message}`);
		}
		forms = variants.filter((v) => !v.Example).map((v) => String(v.Simplified ?? '').trim());
	} else {
		forms = [row.Simplified.trim()];
	}
	for (const form of forms) {
		if (!WORD_FORM.test(form)) fail(`hsk30.csv: ${row.ID}: unexpected form ${JSON.stringify(form)}`);
	}
	if (forms.length === 0) fail(`hsk30.csv: ${row.ID}: no form`);
	return forms;
}

/**
 * hskWordLevels reads hsk30.csv, grouped by level, variants expanded. A
 * form keeps only the lowest level that lists it: the list repeats a word
 * for each sense or part of speech (好 at 1, 2 and 4), and an entry carries
 * one level of the scheme.
 */
export function hskWordLevels(text) {
	const rows = records(text, 'hsk30.csv', ['ID', 'Simplified', 'Level', 'Variants']);
	const byLevel = new Map(HSK_LEVELS.map((level) => [level, { entries: [], seen: new Set() }]));
	const ids = new Set();
	for (const row of rows) {
		if (ids.has(row.ID)) fail(`hsk30.csv: ${row.ID} appears twice`);
		ids.add(row.ID);
		const level = byLevel.get(row.Level);
		if (level === undefined) fail(`hsk30.csv: ${row.ID} has unknown level ${row.Level}`);
		for (const form of wordForms(row)) uniquePush(level.entries, level.seen, form);
	}
	const lower = new Set();
	let repeats = 0;
	const levels = HSK_LEVELS.map((level) => {
		const entries = byLevel.get(level).entries.filter((form) => {
			if (lower.has(form)) {
				repeats++;
				return false;
			}
			return true;
		});
		for (const form of entries) lower.add(form);
		return { name: hskLevelName(level), entries };
	});
	return { rows: rows.length, repeats, levels };
}

// A cleaned JLPT vocabulary form: kana, kanji, 々, ー and ヶ only.
const VOCAB_FORM = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々ヶ]+$/u;
const EDGE_TILDES = /^[～〜~]+|[～〜~]+$/gu;
const HAS_TILDE = /[～〜~]/u;

const KANA_READING = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

/** cleanPiece strips the list's notes, spaces and affix tildes from one piece. */
function cleanPiece(piece) {
	return piece
		.replace(/[（(][^)）]*[)）]/gu, '')
		.replace(/\s+/gu, '')
		.replace(EDGE_TILDES, '');
}

/**
 * stripSuru reduces a する verb to its noun when the noun has two or more
 * characters (勉強する → 勉強, コピーする → コピー), which is how JMdict
 * lists them. A one-character stem keeps する: 関する, 対する and 愛する
 * are JMdict words of their own, and 関 alone is an unrelated noun.
 */
export function stripSuru(form) {
	return form.length >= 4 && form.endsWith('する') ? form.slice(0, -2) : form;
}

/**
 * vocabForms returns the word forms of one row of open-anki-jlpt-decks,
 * each with its reading when the row gives one, and the number of pieces
 * it dropped. Variants separated by ";" each count (足; 脚); a
 * parenthesised note goes (しまった (かん) → しまった; (かさを～) さす →
 * さす); a tilde that marks a prefix or suffix at either end goes (～円 →
 * 円, お～ → お); a piece with a tilde inside (いくら～ても, a pattern) or
 * any other character left over is dropped; a する verb with a stem of
 * two or more characters becomes its noun (stripSuru). Readings pair with
 * the pieces by position when the counts match; a single reading applies
 * to every piece (足; 脚 read あし); otherwise, or when a reading is not
 * kana, the forms go without.
 */
export function vocabForms(expression, reading = '') {
	const forms = [];
	let dropped = 0;
	const pieces = expression.split(/[;；]/u);
	const readings = reading
		.split(/[;；]/u)
		.map(cleanPiece)
		.filter((r) => r !== '');
	for (const [i, piece] of pieces.entries()) {
		const form = cleanPiece(piece);
		if (form === '') continue;
		if (HAS_TILDE.test(form) || !VOCAB_FORM.test(form)) {
			dropped++;
			continue;
		}
		let r = readings.length === pieces.length ? readings[i] : readings.length === 1 ? readings[0] : '';
		if (!r || !KANA_READING.test(r)) r = '';
		const stem = stripSuru(form);
		if (stem !== form && r.endsWith('する')) r = r.slice(0, -2);
		else if (stem !== form) r = '';
		forms.push({ form: stem, reading: r === stem ? '' : r });
	}
	return { forms, dropped };
}

/** packEntry is a levels.json entry: the form, or {form, reading}. */
function packEntry({ form, reading }) {
	return reading ? { form, reading } : form;
}

/**
 * jlptVocabLevels reads n5.csv … n1.csv: each row's expression and
 * reading give its forms (vocabForms). A form with its reading joins only
 * the easiest level that lists it, once, in file order: one entry carries
 * one level of the scheme. The reading lets the importer pick the word
 * read so among the words written with the form (風 かぜ, not 振り ふり).
 */
function jlptVocabLevels(texts) {
	const seen = new Set();
	const stats = [];
	const levels = JLPT_LEVELS.map((n) => {
		const name = `n${n}.csv`;
		const rows = records(texts[name], name, ['expression', 'reading']);
		const entries = [];
		let dropped = 0;
		let repeats = 0;
		for (const row of rows) {
			const result = vocabForms(row.expression, row.reading);
			dropped += result.dropped;
			for (const item of result.forms) {
				const key = `${item.form}\t${item.reading}`;
				if (seen.has(key)) {
					repeats++;
					continue;
				}
				seen.add(key);
				entries.push(packEntry(item));
			}
		}
		stats.push({ name: `N${n}`, rows: rows.length, forms: entries.length, dropped, repeats });
		return { name: `N${n}`, entries };
	});
	return { levels, stats };
}

function sha256(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

function json(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function levelsJSON(unit, levels) {
	// One level per block, one entry per line: diffs of a refreshed list
	// stay readable.
	return json({ unit, levels });
}

function countsLine(levels) {
	return levels.map((level) => `${level.name} ${level.entries.length}`).join(', ');
}

async function writePack(dir, { manifest, unit, levels, license, attribution, extraFiles = {} }) {
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'manifest.json'), json(manifest));
	await writeFile(join(dir, 'levels.json'), levelsJSON(unit, levels));
	await writeFile(join(dir, 'LICENSE'), license);
	await writeFile(join(dir, 'ATTRIBUTION.md'), attribution);
	for (const [name, content] of Object.entries(extraFiles)) await writeFile(join(dir, name), content);
}

function sumsBlock(sums, files) {
	return files.map((name) => `    ${sums[name]}  ${name}`).join('\n');
}

/**
 * readJlptInputs reads kanjiapi.dev's two files from upstream (warning when
 * one differs from the pinned sum) and the bundled KANJIDIC2 from
 * <packs>/kanjidic2; a missing file fails before anything is written.
 */
async function readJlptInputs(upstream, packs) {
	const files = {};
	const sums = {};
	for (const name of Object.keys(PINNED_SHA256)) {
		try {
			files[name] = await readFile(join(upstream, name));
		} catch (err) {
			fail(`read ${name} from ${upstream}: ${err.message}`);
		}
		sums[name] = sha256(files[name]);
		if (sums[name] !== PINNED_SHA256[name]) {
			console.warn(`prepare-level-packs: warning: ${name} differs from the pinned upstream file (sha256 ${sums[name]})`);
		}
	}
	const kanjidicDir = join(packs, 'kanjidic2');
	for (const name of ['kanjidic2.xml.gz', 'LICENSE']) {
		try {
			files[`kanjidic2/${name}`] = await readFile(join(kanjidicDir, name));
		} catch (err) {
			fail(
				`read ${name} from ${kanjidicDir} (${err.code ?? err.message}): the JLPT kanji gap fill needs the bundled ` +
					'KANJIDIC2 pack (plugins/data/kanjidic2, refreshed by scripts/fetch-seeds.sh)'
			);
		}
		sums[`kanjidic2/${name}`] = sha256(files[`kanjidic2/${name}`]);
	}
	let xml;
	try {
		xml = gunzipSync(files['kanjidic2/kanjidic2.xml.gz']).toString('utf8');
	} catch (err) {
		fail(`KANJIDIC2: ${join(kanjidicDir, 'kanjidic2.xml.gz')} is not gzip: ${err.message}`);
	}
	const created = /<date_of_creation>([^<]*)<\/date_of_creation>/.exec(xml)?.[1] ?? 'unknown date';
	return {
		files,
		sums,
		tsv: stripBOM(files['jlpt.tsv'].toString('utf8')),
		kanjidic: parseKanjidic2(xml),
		kanjidicDate: created
	};
}

function jlptDirs(args, usage) {
	const [upstreamArg, packsArg] = args;
	if (upstreamArg === undefined) fail(usage);
	const here = dirname(fileURLToPath(import.meta.url));
	return { upstream: resolve(upstreamArg), packs: resolve(packsArg ?? join(here, '..', 'plugins', 'data')) };
}

/** mainCalibrate prints the evaluation behind the gap-fill constants. */
async function mainCalibrate(args) {
	const { upstream, packs } = jlptDirs(args, 'usage: node scripts/prepare-level-packs.mjs --calibrate <upstream-dir> [<packs-dir>]');
	const { tsv, kanjidic } = await readJlptInputs(upstream, packs);
	for (const line of calibrate(tsv, kanjidic)) console.log(line);
}

async function mainJlpt(args) {
	const { upstream, packs } = jlptDirs(args, 'usage: node scripts/prepare-level-packs.mjs <upstream-dir> [<packs-dir>]');
	const { files, sums, tsv, kanjidic, kanjidicDate } = await readJlptInputs(upstream, packs);

	const base = jlptLevels(tsv);
	const listed = new Set(base.flatMap((level) => level.entries));
	const { levels, added } = approxJlptLevels(tsv, kanjidic);
	const perLevel = levels.map((level, i) => `${level.name} ${base[i].entries.length} + ${level.entries.length - base[i].entries.length}`).join(', ');
	const joyo = [...kanjidic].filter(([, k]) => k.grade !== null && k.grade <= 8);
	const joyoMissing = joyo.filter(([ch]) => !listed.has(ch)).length;
	const joyoPlaced = new Set(levels.flatMap((level) => level.entries));
	const joyoLeft = joyo.filter(([ch]) => !joyoPlaced.has(ch)).length;
	const gradeEight = [...kanjidic].filter(([ch, k]) => !listed.has(ch) && k.old === null && k.grade === 8).length;
	const nameKanji = base[base.length - 1].entries.filter((ch) => (kanjidic.get(ch)?.grade ?? 0) >= 9).length;
	const total = levels.reduce((n, level) => n + level.entries.length, 0);

	const kanjiapiSource = `https://github.com/onlyskin/kanjiapi.dev (commit ${KANJIAPI_COMMIT})`;
	await writePack(join(packs, 'jlpt-kanji'), {
		manifest: {
			id: 'jlpt-kanji',
			name: 'JLPT kanji (approximate)',
			version: `kanjiapi.dev@${KANJIAPI_COMMIT.slice(0, 7)}+kanjidic2@${kanjidicDate}`,
			type: 'levels',
			language: 'ja',
			license: 'MIT AND CC BY-SA 4.0',
			attribution:
				'An approximation of the JLPT N5–N1 kanji levels (the JLPT publishes no official kanji list since 2010): ' +
				'base list kanjiapi.dev jlpt.tsv (MIT, © 2023 Iridium Szreter, provenance not stated upstream), ' +
				'https://github.com/onlyskin/kanjiapi.dev; kanji it omits placed by qinqin (scripts/prepare-level-packs.mjs) ' +
				'from KANJIDIC2 (CC BY-SA 4.0, © EDRDG) old JLPT level, school grade and frequency rank',
			format: 'json'
		},
		unit: 'character',
		levels,
		license: files['kanjiapi.dev-LICENSE'],
		extraFiles: { 'LICENSE-KANJIDIC2': files['kanjidic2/LICENSE'] },
		attribution: `# JLPT kanji levels (N5–N1), approximate

Kanji grouped by the current JLPT levels N5 (easiest) to N1. This is an
approximation: the Japan Foundation and JEES have published no official
kanji list since the 2010 revision of the test, so every N5–N1 kanji list is
an unofficial reconstruction, and this pack is one more, built by qinqin
from two sources.

Base list: \`jlpt.tsv\` of kanjiapi.dev, ${kanjiapiSource}.
Licence: MIT, Copyright 2023 Iridium Szreter. See LICENSE in this directory
for the full text, copied verbatim from the upstream repository.
kanjiapi.dev does not say where \`jlpt.tsv\` comes from. Every kanji it lists
keeps its level here.

Gap fill: KANJIDIC2 (dated ${kanjidicDate}), © Electronic Dictionary Research
and Development Group (EDRDG), https://www.edrdg.org/wiki/index.php/KANJIDIC_Project,
licensed under CC BY-SA 4.0 (EDRDG licence statement:
https://www.edrdg.org/edrdg/licence.html; see LICENSE-KANJIDIC2 in this
directory, copied from the bundled kanjidic2 pack). The levels of the kanji the base list
omits are adapted from KANJIDIC2 data and are licensed under CC BY-SA 4.0;
the base list's levels stay under its MIT licence. Whoever redistributes
this pack follows both: keep both notices and licence texts, and share
changes to the derived levels under CC BY-SA 4.0.

Compared with KANJIDIC2, the base list leaves ${joyoMissing} of the
${joyo.length} jōyō kanji in no level, among them the common 分, 可, 無 and 的,
and its N1 holds ${nameKanji} jinmeiyō (name) kanji such as 伊, 智, 弘 and 彦.
\`scripts/prepare-level-packs.mjs\` places each kanji the base list omits,
in this order:

a. A kanji with a pre-2010 four-level JLPT level in KANJIDIC2 (\`<jlpt>\`):
   4 → N5, 3 → N4, 1 → N1; 2 → N3 when its newspaper frequency rank
   (\`<freq>\`) is ${OLD2_N3_MAX_FREQ} or better, else (or with no rank) N2.
   ${added.old} kanji.
b. Else a jōyō kanji (\`<grade>\` 1–8), by school grade:
   ${GRADE_LEVEL_MAX.map(([level, max]) => `grade ≤ ${max} → ${level}`).join(', ')},
   higher grades (6, and 8 for the secondary-school jōyō kanji) → N1;
   with no frequency rank → N1. ${added.grade} kanji.
c. Anything else (jinmeiyō name kanji, kanji with no grade) is not listed.

The thresholds were calibrated against the base list itself (its
${listed.size} kanji are the reference; 20% held out by code point); the evaluation is recorded
next to the constants in the script and reproduced by
\`node scripts/prepare-level-packs.mjs --calibrate <upstream-dir>\`. Every
reference kanji also has an old KANJIDIC2 level, so these are measurements
on kanji like the ones rule a places, not like the ones rule b places. On
the held-out kanji the old-level mapping agrees with the base list on about
four in five. The grade rule agrees on about three in five, but that was
measured on kanji that have an old level; rule b places only kanji without
one, ${added.grade - gradeEight === 0 ? 'all' : `${gradeEight} of ${added.grade}`} of them grade 8, mostly the 2010 jōyō additions
(such as 誰, 頃, 俺 and 闇), all at N1. How well it does on them is
unmeasured, and probably worse for the common ones: KANJIDIC2's frequency
rank is newspaper data from before 2010 and under-ranks them. Treat a
derived level as a rough guide. ${joyoLeft === 0 ? 'Every jōyō kanji now has a level.' : `${joyoLeft} jōyō kanji still have no level.`}

Order: each level lists the base kanji in file order, then the added kanji
by frequency rank (none last), then code point. ${total} kanji; levels
(base + added): ${perLevel}.

Input files (SHA-256):

${sumsBlock(sums, ['jlpt.tsv', 'kanjiapi.dev-LICENSE', 'kanjidic2/kanjidic2.xml.gz', 'kanjidic2/LICENSE'])}
`
	});

	console.log(`jlpt-kanji: ${total} kanji; ${countsLine(levels)}`);
	console.log(`  base ${listed.size}; added ${added.old} by old JLPT level, ${added.grade} by grade; per level (base + added): ${perLevel}`);
}

/**
 * mainJlptVocab converts the optional, local-only JLPT vocabulary pack. It is
 * not bundled in the repository (its upstream licence chain could not be verified).
 */
async function mainJlptVocab(args) {
	const [vocabArg, localArg] = args;
	if (vocabArg === undefined) {
		fail('usage: node scripts/prepare-level-packs.mjs --jlpt-vocab <jlpt-vocab-dir> [<local-packs-dir>]');
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const vocabDir = resolve(vocabArg);
	const packs = resolve(localArg ?? join(here, '..', 'plugins', 'data-local'));

	const vocabFiles = {};
	const vocabSums = {};
	for (const name of Object.keys(PINNED_VOCAB_SHA256)) {
		try {
			vocabFiles[name] = await readFile(join(vocabDir, name));
		} catch (err) {
			fail(
				`${name} is missing in ${vocabDir} (${err.code ?? err.message}). JLPT vocabulary is not bundled; download n5.csv … n1.csv ` +
					'and LICENSE from https://github.com/jamsinclair/open-anki-jlpt-decks first (commands in this ' +
					"script's header)"
			);
		}
		vocabSums[name] = sha256(vocabFiles[name]);
		if (vocabSums[name] !== PINNED_VOCAB_SHA256[name]) {
			console.warn(`prepare-level-packs: warning: ${name} differs from the pinned upstream file (sha256 ${vocabSums[name]})`);
		}
	}
	const vocabTexts = Object.fromEntries(
		Object.entries(vocabFiles).map(([name, buffer]) => [name, stripBOM(buffer.toString('utf8'))])
	);

	const vocab = jlptVocabLevels(vocabTexts);

	const vocabSource = `https://github.com/jamsinclair/open-anki-jlpt-decks (commit ${JLPT_DECKS_COMMIT})`;
	const vocabFormCount = vocab.levels.reduce((sum, level) => sum + level.entries.length, 0);
	const vocabStats = vocab.stats
		.map((s) => `${s.name}: ${s.rows} rows, ${s.forms} forms, ${s.dropped} pieces dropped, ${s.repeats} repeats`)
		.join('\n- ');
	await writePack(join(packs, 'jlpt-words'), {
		manifest: {
			id: 'jlpt-words',
			name: 'JLPT (vocabulary)',
			version: `open-anki-jlpt-decks@${JLPT_DECKS_COMMIT.slice(0, 7)}`,
			type: 'levels',
			language: 'ja',
			license: 'MIT',
			attribution:
				'NOT BUNDLED, local use only. ' +
				'open-anki-jlpt-decks (MIT, © 2020 Jamie Sinclair), https://github.com/jamsinclair/open-anki-jlpt-decks — ' +
				'unofficial N5–N1 vocabulary lists; per its README taken from chyyran/jlpt-anki-decks, based on the tanos.co.uk ' +
				'lists (Jonathan Waller, described as CC BY; unverified, the licence chain of this pack could not be confirmed)',
			format: 'json'
		},
		unit: 'word',
		levels: vocab.levels,
		license: vocabFiles.LICENSE,
		attribution: `# JLPT vocabulary levels (N5–N1)

Japanese words grouped by JLPT level, N5 (easiest) to N1, from \`src/n5.csv\`
… \`src/n1.csv\` of open-anki-jlpt-decks, ${vocabSource}.

Licence: MIT, Copyright (c) 2020 Jamie Sinclair. See LICENSE in this
directory for the full text, copied verbatim from the upstream repository.

Status: NOT BUNDLED with qinqin, local use only. This pack was generated
locally by the user and must not be committed or redistributed. Its upstream
licence chain could not be verified (see Provenance).

Provenance: the open-anki-jlpt-decks README says "Original deck data was
taken from https://github.com/chyyran/jlpt-anki-decks, which were based on
decks from tanos.co.uk". The tanos.co.uk lists are Jonathan Waller's
unofficial JLPT lists, described as published under a Creative Commons
Attribution (CC BY) licence; that page could not be reached when this pack
was made, so the description is not verified here, and the MIT label of
open-anki-jlpt-decks may not cover data derived from it. The JLPT has published
no official vocabulary list since the 2010 revision of the test; these
lists are reconstructions and not an official release.

Conversion (\`scripts/prepare-level-packs.mjs\`): the \`expression\` column of
each level file gives the forms. Variants separated by ";" each count;
parenthesised notes are removed (しまった (かん) → しまった); a tilde marking a
prefix or suffix at either end is removed (～円 → 円); a piece with a tilde
inside (a grammar pattern such as いくら～ても) or other leftover characters is
dropped; a する verb whose stem has two or more characters becomes its noun,
as JMdict lists it (勉強する → 勉強), while 関する or 愛する stay whole. The
\`reading\` column goes with each kanji form ({"form": "風", "reading": "かぜ"})
so the importer picks the word read so (風 かぜ, not the usually-kana 振り
ふり); readings pair with the variants by position, or one reading applies to
all. A form with its reading keeps only the easiest level that lists it, once.
The \`meaning\` column is not used. ${vocabFormCount} forms; levels:
${countsLine(vocab.levels)}.

- ${vocabStats}

Input files (SHA-256):

${sumsBlock(vocabSums, Object.keys(PINNED_VOCAB_SHA256))}
`
	});

	console.log(`jlpt-words: ${vocabFormCount} forms; ${countsLine(vocab.levels)}`);
	for (const s of vocab.stats) {
		console.log(`  ${s.name}: ${s.rows} rows, ${s.dropped} pieces dropped, ${s.repeats} forms already listed (same or easier level)`);
	}
	console.log(`written to ${packs} (not bundled, local use only)`);
}

/**
 * mainHsk converts the optional, local-only HSK 3.0 packs. They are not
 * bundled in the repository (unclear licence, see HSK30_CAVEAT).
 */
async function mainHsk(args) {
	const [hskArg, localArg] = args;
	if (hskArg === undefined) {
		fail('usage: node scripts/prepare-level-packs.mjs --hsk <hsk-dir> [<local-packs-dir>]');
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const upstream = resolve(hskArg);
	const packs = resolve(localArg ?? join(here, '..', 'plugins', 'data-local'));

	const files = {};
	const sums = {};
	const hskFiles = Object.keys(PINNED_HSK_SHA256);
	for (const name of hskFiles) {
		try {
			files[name] = await readFile(join(upstream, name));
		} catch {
			fail(
				`${name} is missing in ${upstream}. HSK 3.0 is not bundled; download hsk30.csv, hsk30-chars.csv ` +
					'and LICENSE (saved as hsk30-LICENSE) from https://github.com/ivankra/hsk30 first (commands in this ' +
					"script's header)"
			);
		}
		sums[name] = sha256(files[name]);
		if (sums[name] !== PINNED_HSK_SHA256[name]) {
			console.warn(`prepare-level-packs: warning: ${name} differs from the pinned upstream file (sha256 ${sums[name]})`);
		}
	}
	const text = (name) => stripBOM(files[name].toString('utf8'));
	const chars = hskCharLevels(text('hsk30-chars.csv'));
	const words = hskWordLevels(text('hsk30.csv'));

	const hsk30Source = `https://github.com/ivankra/hsk30 (commit ${HSK30_COMMIT})`;
	const hsk30Version = `hsk30@${HSK30_COMMIT.slice(0, 7)}`;
	const hskAttribution =
		'NOT BUNDLED, local use only. ' +
		'ivankra/hsk30 (LICENSE: MIT, © 2023 Ivan Krasilnikov, © 2021 Shawky, © 2021 Pleco Inc.), ' +
		'derived from elkmovie/hsk30 and shawkynasr/HSK-official-Query-System (MIT-labelled), ' +
		'copies of the PRC Ministry of Education HSK 3.0 standard (2021) and the HSK website; ' +
		'the ministry claims copyright in the original, so the status is uncertain (see ATTRIBUTION.md)';

		const hskCommon = `Source: ${hsk30Source}.

Licence: the hsk30 LICENSE file is the MIT licence (Copyright (c) 2023 Ivan
Krasilnikov, (c) 2021 Shawky, (c) 2021 Pleco Inc.); see LICENSE in this
directory for the full text, copied verbatim from the upstream repository.

Status: NOT BUNDLED with qinqin, local use only. This pack was generated
locally by the user and must not be committed or redistributed.

Provenance and caveat: ${HSK30_CAVEAT}

The underlying list is the HSK 3.0 standard in the PRC Ministry of
Education document the hsk30 README links (moe.gov.cn, March 2021). qinqin
is not affiliated with the HSK or its publishers, and these packs are not
an official release.`;

	await writePack(join(packs, 'hsk30-chars'), {
		manifest: {
			id: 'hsk30-chars',
			name: 'HSK 3.0 (characters)',
			version: hsk30Version,
			type: 'levels',
			language: 'zh',
			license: 'MIT',
			attribution: hskAttribution,
			format: 'json'
		},
		unit: 'character',
		levels: chars.levels,
		license: files['hsk30-LICENSE'],
		attribution: `# HSK 3.0 characters

The 3,000 characters of the HSK 3.0 standard, grouped by reading level
(HSK 1–6 and the combined 7–9 band), from \`hsk30-chars.csv\`.

${hskCommon}

Conversion (\`scripts/prepare-level-packs.mjs\`): the \`Level\` column (the
reading level: the level a character first appears at in the word list)
picks the level; \`WritingLevel\` and the other columns are not used. One
entry per character in file order. ${chars.rows} characters; levels:
${countsLine(chars.levels)}.

Input files (SHA-256):

${sumsBlock(sums, hskFiles)}
`
	});

	const formCount = words.levels.reduce((sum, level) => sum + level.entries.length, 0);
	await writePack(join(packs, 'hsk30-words'), {
		manifest: {
			id: 'hsk30-words',
			name: 'HSK 3.0 (words)',
			version: hsk30Version,
			type: 'levels',
			language: 'zh',
			license: 'MIT',
			attribution: hskAttribution,
			format: 'json'
		},
		unit: 'word',
		levels: words.levels,
		license: files['hsk30-LICENSE'],
		attribution: `# HSK 3.0 words

The 11,092 words of the HSK 3.0 standard, levels HSK 1–6 and the combined
7–9 band, in simplified characters, from \`hsk30.csv\`.

${hskCommon}

Conversion (\`scripts/prepare-level-packs.mjs\`): the \`Level\` column picks
the level. A row with a \`Variants\` list contributes each listed simplified
variant (爸爸 and 爸; 有点儿 and 有一点儿; 称 for 称1) except the ones upstream
marks as mere examples of a prefix or suffix (第二 for 第); any other row
contributes its \`Simplified\` form. A form keeps only the lowest level that
lists it, once: the list repeats a word per sense or part of speech (好 at
HSK 1, 2 and 4), and an entry carries one level of the scheme (${words.repeats}
repeats dropped). ${words.rows} rows give ${formCount} forms; levels:
${countsLine(words.levels)}.

Input files (SHA-256):

${sumsBlock(sums, hskFiles)}
`
	});

	console.log(`hsk30-chars: ${chars.rows} characters; ${countsLine(chars.levels)}`);
	console.log(`hsk30-words: ${words.rows} rows, ${formCount} forms; ${countsLine(words.levels)}`);
	console.log(`written to ${packs} (not bundled, local use only)`);
}

async function main() {
	const args = process.argv.slice(2);
	if (args[0] === '--hsk') return mainHsk(args.slice(1));
	if (args[0] === '--jlpt-vocab') return mainJlptVocab(args.slice(1));
	if (args[0] === '--calibrate') return mainCalibrate(args.slice(1));
	return mainJlpt(args);
}

// Run only as a script: the tests import the parsing helpers.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		await main();
	} catch (err) {
		if (!(err instanceof PackError)) throw err;
		console.error(`prepare-level-packs: ${err.message}`);
		process.exit(1);
	}
}
