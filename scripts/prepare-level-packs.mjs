#!/usr/bin/env node
// Convert the upstream JLPT and HSK 3.0 lists into qinqin level packs.
//
// Usage:
//   node scripts/prepare-level-packs.mjs <upstream-dir> <jlpt-vocab-dir> [<packs-dir>]
//
// <upstream-dir> must hold the five upstream files of the kanji and HSK
// lists, downloaded unmodified from the pinned commits below (a maintainer
// step; nothing here touches the network):
//
//   curl -fsSLo jlpt.tsv              https://raw.githubusercontent.com/onlyskin/kanjiapi.dev/76aa080cdf56aa7587304d925e1435bb93469b79/jlpt.tsv
//   curl -fsSLo kanjiapi.dev-LICENSE  https://raw.githubusercontent.com/onlyskin/kanjiapi.dev/76aa080cdf56aa7587304d925e1435bb93469b79/LICENSE
//   curl -fsSLo hsk30.csv             https://raw.githubusercontent.com/ivankra/hsk30/4ff9e3915ce87baaecd7ebe263085573a4ea3192/hsk30.csv
//   curl -fsSLo hsk30-chars.csv       https://raw.githubusercontent.com/ivankra/hsk30/4ff9e3915ce87baaecd7ebe263085573a4ea3192/hsk30-chars.csv
//   curl -fsSLo hsk30-LICENSE         https://raw.githubusercontent.com/ivankra/hsk30/4ff9e3915ce87baaecd7ebe263085573a4ea3192/LICENSE
//
// <jlpt-vocab-dir> holds the JLPT vocabulary CSVs of open-anki-jlpt-decks
// and its licence, as published at the pinned commit:
//
//   base=https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0
//   for n in n5 n4 n3 n2 n1; do curl -fsSLo $n.csv $base/src/$n.csv; done
//   curl -fsSLo LICENSE $base/LICENSE
//
// It (re)writes four pack directories under <packs-dir> (default
// plugins/data): jlpt-kanji, jlpt-words, hsk30-chars and hsk30-words, each with
// manifest.json, levels.json, LICENSE (the upstream licence, verbatim) and
// ATTRIBUTION.md. The output depends only on the input files, so a re-run
// on the same inputs reproduces the committed packs byte for byte. Files
// that differ from the pinned SHA-256 sums are converted too, with a
// warning: ATTRIBUTION.md records the sums of the files actually used.
//
// Level order is easiest first, which is how the importer reads a pack (a
// character derived from words keeps the lowest level it appears in).
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KANJIAPI_COMMIT = '76aa080cdf56aa7587304d925e1435bb93469b79';
const HSK30_COMMIT = '4ff9e3915ce87baaecd7ebe263085573a4ea3192';
const JLPT_DECKS_COMMIT = '1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0';

const PINNED_SHA256 = {
	'jlpt.tsv': '52ff4165bc3bac8d5784c8521c41a2255c0346a580d8f24ab0f259451564ccfe',
	'kanjiapi.dev-LICENSE': '8d46c4a0a18ed265ad8824e54c2f2ae672a6c1c8dd01177e3928fb03e45be2c9',
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

const HSK30_CAVEAT = `the hsk30 README says its data is "largely derived from"
elkmovie/hsk30 and shawkynasr/HSK-official-Query-System, "both also under
MIT license and claiming copyright -- of course, somewhat questionably, as
the original work they *copy* is PRC's government work", and that
"Depending on PRC law specifics might be public domain". qinqin
redistributes the data under the MIT terms stated upstream and claims
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

/** hskWordLevels reads hsk30.csv, grouped by level, variants expanded. */
function hskWordLevels(text) {
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
	return {
		rows: rows.length,
		levels: HSK_LEVELS.map((level) => ({ name: hskLevelName(level), entries: byLevel.get(level).entries }))
	};
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

async function writePack(dir, { manifest, unit, levels, license, attribution }) {
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'manifest.json'), json(manifest));
	await writeFile(join(dir, 'levels.json'), levelsJSON(unit, levels));
	await writeFile(join(dir, 'LICENSE'), license);
	await writeFile(join(dir, 'ATTRIBUTION.md'), attribution);
}

function sumsBlock(sums, files) {
	return files.map((name) => `    ${sums[name]}  ${name}`).join('\n');
}

async function main() {
	const [upstreamArg, vocabArg, packsArg] = process.argv.slice(2);
	if (upstreamArg === undefined || vocabArg === undefined) {
		fail('usage: node scripts/prepare-level-packs.mjs <upstream-dir> <jlpt-vocab-dir> [<packs-dir>]');
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const upstream = resolve(upstreamArg);
	const vocabDir = resolve(vocabArg);
	const packs = resolve(packsArg ?? join(here, '..', 'plugins', 'data'));

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
	const text = (name) => stripBOM(files[name].toString('utf8'));

	const vocabFiles = {};
	const vocabSums = {};
	for (const name of Object.keys(PINNED_VOCAB_SHA256)) {
		try {
			vocabFiles[name] = await readFile(join(vocabDir, name));
		} catch (err) {
			fail(`read ${name} from ${vocabDir}: ${err.message}`);
		}
		vocabSums[name] = sha256(vocabFiles[name]);
		if (vocabSums[name] !== PINNED_VOCAB_SHA256[name]) {
			console.warn(`prepare-level-packs: warning: ${name} differs from the pinned upstream file (sha256 ${vocabSums[name]})`);
		}
	}
	const vocabTexts = Object.fromEntries(
		Object.entries(vocabFiles).map(([name, buffer]) => [name, stripBOM(buffer.toString('utf8'))])
	);

	const jlpt = jlptLevels(text('jlpt.tsv'));
	const vocab = jlptVocabLevels(vocabTexts);
	const chars = hskCharLevels(text('hsk30-chars.csv'));
	const words = hskWordLevels(text('hsk30.csv'));

	const kanjiapiSource = `https://github.com/onlyskin/kanjiapi.dev (commit ${KANJIAPI_COMMIT})`;
	const hsk30Source = `https://github.com/ivankra/hsk30 (commit ${HSK30_COMMIT})`;
	const kanjiapiVersion = `kanjiapi.dev@${KANJIAPI_COMMIT.slice(0, 7)}`;
	const hsk30Version = `hsk30@${HSK30_COMMIT.slice(0, 7)}`;
	const hskAttribution =
		'ivankra/hsk30 (MIT, © 2023 Ivan Krasilnikov, © 2021 Shawky, © 2021 Pleco Inc.), ' +
		'derived from elkmovie/hsk30 and shawkynasr/HSK-official-Query-System (MIT), which ' +
		'transcribe the PRC Ministry of Education HSK 3.0 standard (2021); copyright status of ' +
		'the underlying list is uncertain (see ATTRIBUTION.md)';

	await writePack(join(packs, 'jlpt-kanji'), {
		manifest: {
			id: 'jlpt-kanji',
			name: 'JLPT (kanji)',
			version: kanjiapiVersion,
			type: 'levels',
			language: 'ja',
			license: 'MIT',
			attribution:
				'kanjiapi.dev jlpt.tsv (MIT, © 2023 Iridium Szreter), https://github.com/onlyskin/kanjiapi.dev — unofficial N5–N1 kanji lists; the JLPT publishes no official kanji list',
			format: 'json'
		},
		unit: 'character',
		levels: jlpt,
		license: files['kanjiapi.dev-LICENSE'],
		attribution: `# JLPT kanji levels (N5–N1)

Kanji grouped by the current JLPT levels N5 (easiest) to N1, from \`jlpt.tsv\`
of kanjiapi.dev, ${kanjiapiSource}.

Licence: MIT, Copyright 2023 Iridium Szreter. See LICENSE in this directory
for the full text, copied verbatim from the upstream repository.

The Japan Foundation and JEES have published no official kanji list since
the 2010 revision of the test; like every N5–N1 list, this one is an
unofficial reconstruction. It replaces the pre-2010 four-level scale that
KANJIDIC2 carries, which qinqin no longer imports.

Conversion (\`scripts/prepare-level-packs.mjs\`): each line \`<n>\\t<kanji>\`
becomes the level "N<n>", ordered N5, N4, N3, N2, N1, one entry per kanji in
file order. Nothing is added or removed. Levels: ${countsLine(jlpt)}.

Input file (SHA-256):

${sumsBlock(sums, ['jlpt.tsv', 'kanjiapi.dev-LICENSE'])}
`
	});

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
				'open-anki-jlpt-decks (MIT, © 2020 Jamie Sinclair), https://github.com/jamsinclair/open-anki-jlpt-decks — ' +
				'unofficial N5–N1 vocabulary lists; per its README taken from chyyran/jlpt-anki-decks, based on the tanos.co.uk ' +
				'lists (Jonathan Waller, described as CC BY)',
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

Provenance: the open-anki-jlpt-decks README says "Original deck data was
taken from https://github.com/chyyran/jlpt-anki-decks, which were based on
decks from tanos.co.uk". The tanos.co.uk lists are Jonathan Waller's
unofficial JLPT lists, described as published under a Creative Commons
Attribution (CC BY) licence; that page could not be reached when this pack
was made, so the description is not verified here. The JLPT has published
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

	const hskFiles = ['hsk30.csv', 'hsk30-chars.csv', 'hsk30-LICENSE'];
	const hskCommon = `Source: ${hsk30Source}.

Licence: the hsk30 repository is MIT licensed (Copyright (c) 2023 Ivan
Krasilnikov, (c) 2021 Shawky, (c) 2021 Pleco Inc.); see LICENSE in this
directory for the full text, copied verbatim from the upstream repository.

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
contributes its \`Simplified\` form. A form listed twice in one level is kept
once. ${words.rows} rows give ${formCount} forms; levels:
${countsLine(words.levels)}.

Input files (SHA-256):

${sumsBlock(sums, hskFiles)}
`
	});

	console.log(`jlpt-kanji: ${countsLine(jlpt)}`);
	console.log(`jlpt-words: ${vocabFormCount} forms; ${countsLine(vocab.levels)}`);
	for (const s of vocab.stats) {
		console.log(`  ${s.name}: ${s.rows} rows, ${s.dropped} pieces dropped, ${s.repeats} forms already listed (same or easier level)`);
	}
	console.log(`hsk30-chars: ${chars.rows} characters; ${countsLine(chars.levels)}`);
	console.log(`hsk30-words: ${words.rows} rows, ${formCount} forms; ${countsLine(words.levels)}`);
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
