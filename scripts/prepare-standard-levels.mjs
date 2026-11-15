#!/usr/bin/env node
// Generate the two bundled "standard" level packs from data already in the
// repository (no network):
//
//   joyo-grades  Jōyō kanji by school grade, from KANJIDIC2 <grade>
//   tgh-chars    通用规范汉字表 (2013) levels, from Unihan kTGH
//
// Usage: node scripts/prepare-standard-levels.mjs [<packs-dir>]
// (default plugins/data). Reads <packs-dir>/kanjidic2/{kanjidic2.xml.gz,LICENSE}
// and <packs-dir>/unihan/{Unihan.zip,LICENSE}; (re)writes joyo-grades and
// tgh-chars there. Deterministic: the same inputs give the same bytes.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { PackError, assertWritable, parseKanjidic2, writePack } from './prepare-level-packs.mjs';

function fail(message) {
	throw new PackError(message);
}

export const JOYO_NOTICE =
	'The school grade of each jōyō kanji (Grade 1 to Grade 6, then Secondary for the rest of the 2,136 jōyō kanji) ' +
	'is the one recorded in [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) (CC BY-SA 4.0, EDRDG), ' +
	'which follows the 2020 学年別漢字配当表 and the 2010 常用漢字表. Jinmeiyō kanji are not included. ' +
	'Within a level, kanji are ordered by newspaper frequency, then by code point.';

export const TGH_NOTICE =
	'The 通用规范汉字表 (State Council, 2013, 国发〔2013〕23号) is a state document. qinqin takes only the serial ' +
	'number of each character from the kTGH field of the [Unicode Unihan database](https://www.unicode.org/reports/tr38/) ' +
	'(Unicode License v3) and splits it at 3,500 and 6,500: Level 1 (一级) is serial 1 to 3,500, Level 2 (二级) ' +
	'3,501 to 6,500, Level 3 (三级) 6,501 to 8,105.';

const JOYO_LEVELS = [1, 2, 3, 4, 5, 6, 8];

/**
 * joyoLevels groups the jōyō kanji of a parseKanjidic2 map by KANJIDIC2
 * grade (1–6, then 8 = "Secondary"); grades 9 and 10 (jinmeiyō) and kanji
 * without a grade are left out. Within a level: frequency rank (none last),
 * then code point. Empty levels are omitted.
 */
export function joyoLevels(kanjidic) {
	const levels = [];
	for (const grade of JOYO_LEVELS) {
		const entries = [...kanjidic]
			.filter(([, k]) => k.grade === grade)
			.sort(([a, ka], [b, kb]) => {
				const fa = ka.freq ?? Infinity;
				const fb = kb.freq ?? Infinity;
				if (fa !== fb) return fa < fb ? -1 : 1;
				return a.codePointAt(0) - b.codePointAt(0);
			})
			.map(([ch]) => ch);
		if (entries.length > 0) levels.push({ name: grade === 8 ? 'Secondary' : `Grade ${grade}`, entries });
	}
	return levels;
}

const UNIHAN_LINE = /^U\+([0-9A-F]{4,6})\t(k\w+)\t(.*)$/;

function unihanRows(text, field) {
	const rows = [];
	for (const raw of text.split('\n')) {
		const line = raw.replace(/\r$/, '');
		if (line === '' || line.startsWith('#')) continue;
		const m = UNIHAN_LINE.exec(line);
		if (m === null) fail(`Unihan: malformed line ${JSON.stringify(line)}`);
		if (m[2] !== field) continue;
		rows.push({ char: String.fromCodePoint(parseInt(m[1], 16)), value: m[3], line });
	}
	return rows;
}

/** parseTgh reads kTGH rows into a Map from character to serial (2013:<n>). */
export function parseTgh(text) {
	const serials = new Map();
	const used = new Set();
	for (const { char, value, line } of unihanRows(text, 'kTGH')) {
		const m = /^2013:([1-9]\d{0,3})$/.exec(value);
		if (m === null) fail(`Unihan kTGH: unexpected value in ${JSON.stringify(line)}`);
		const serial = Number(m[1]);
		if (serials.has(char)) fail(`Unihan kTGH: ${char} appears twice`);
		if (used.has(serial)) fail(`Unihan kTGH: serial ${serial} appears twice`);
		serials.set(char, serial);
		used.add(serial);
	}
	if (serials.size === 0) fail('Unihan: no kTGH rows');
	return serials;
}

/** tghLevels splits the serials into Level 1 (≤3,500), 2 (≤6,500) and 3, in serial order. */
export function tghLevels(serials) {
	const sorted = [...serials].sort(([, a], [, b]) => a - b);
	const bounds = [3500, 6500, Infinity];
	const levels = [];
	let lower = 0;
	bounds.forEach((upper, i) => {
		const entries = sorted.filter(([, n]) => n > lower && n <= upper).map(([ch]) => ch);
		if (entries.length > 0) levels.push({ name: `Level ${i + 1}`, entries });
		lower = upper;
	});
	return levels;
}

/**
 * parseJoyoSet returns the characters whose kJoyoKanji value is 2010 (the
 * jōyō table of that year); the four U+XXXX variant rows are skipped.
 */
export function parseJoyoSet(text) {
	const set = new Set();
	for (const { char, value, line } of unihanRows(text, 'kJoyoKanji')) {
		if (/^U\+[0-9A-F]{4,6}$/.test(value)) continue;
		if (value !== '2010') fail(`Unihan kJoyoKanji: unexpected value in ${JSON.stringify(line)}`);
		set.add(char);
	}
	return set;
}

async function read(path, what) {
	try {
		return await readFile(path);
	} catch (err) {
		fail(`read ${what} (${path}): ${err.code ?? err.message}; this generator needs the bundled kanjidic2 and unihan packs`);
	}
}

async function main() {
	const here = dirname(fileURLToPath(import.meta.url));
	const packs = resolve(process.argv[2] ?? join(here, '..', 'plugins', 'data'));

	const kdDir = join(packs, 'kanjidic2');
	const kdGz = await read(join(kdDir, 'kanjidic2.xml.gz'), 'KANJIDIC2');
	const kdLicense = await read(join(kdDir, 'LICENSE'), 'KANJIDIC2 LICENSE');
	const uniDir = join(packs, 'unihan');
	await read(join(uniDir, 'Unihan.zip'), 'Unihan.zip');
	const uniLicense = await read(join(uniDir, 'LICENSE'), 'Unihan LICENSE');

	let xml;
	try {
		xml = gunzipSync(kdGz).toString('utf8');
	} catch (err) {
		fail(`KANJIDIC2 is not gzip: ${err.message}`);
	}
	const dbVersion = /<database_version>([^<]+)<\/database_version>/.exec(xml)?.[1];
	if (dbVersion === undefined) fail('KANJIDIC2: no <database_version>');
	const kanjidic = parseKanjidic2(xml);
	const joyo = joyoLevels(kanjidic);

	let other;
	try {
		other = execFileSync('unzip', ['-p', join(uniDir, 'Unihan.zip'), 'Unihan_OtherMappings.txt'], {
			encoding: 'utf8',
			maxBuffer: 1 << 28
		});
	} catch (err) {
		fail(`read Unihan_OtherMappings.txt from ${join(uniDir, 'Unihan.zip')}: ${err.message}`);
	}
	const unicodeVersion = /^# Unicode Version (\d+\.\d+\.\d+)$/m.exec(other)?.[1];
	if (unicodeVersion === undefined) fail('Unihan_OtherMappings.txt: no "Unicode Version" header');
	const tgh = tghLevels(parseTgh(other));

	for (const id of ['joyo-grades', 'tgh-chars']) assertWritable(join(packs, id), { allowLicense: true });

	await writePack(join(packs, 'joyo-grades'), {
		manifest: {
			id: 'joyo-grades',
			name: 'Jōyō kanji by school grade',
			version: `kanjidic2@${dbVersion}`,
			type: 'levels',
			language: 'ja',
			license: 'CC BY-SA 4.0',
			attribution:
				'School grades (学年別漢字配当表 2020 and the jōyō table) as recorded in KANJIDIC2 (CC BY-SA 4.0, © EDRDG), ' +
				'https://www.edrdg.org/wiki/index.php/KANJIDIC_Project; converted by qinqin',
			notice: JOYO_NOTICE,
			format: 'json'
		},
		unit: 'character',
		marker: true,
		levels: joyo,
		license: kdLicense,
		attribution: `# Jōyō kanji by school grade

The 2,136 jōyō kanji grouped by the school grade in which they are taught:
Grade 1 to Grade 6, then Secondary (the rest of the jōyō table).

Source: KANJIDIC2 (database version ${dbVersion}), © Electronic Dictionary
Research and Development Group (EDRDG), licensed CC BY-SA 4.0,
https://www.edrdg.org/wiki/index.php/KANJIDIC_Project (licence:
https://www.edrdg.org/edrdg/licence.html). The grade and
frequency rank of each kanji are taken from its \`<grade>\` and \`<freq>\`
elements; jinmeiyō kanji (grades 9 and 10) are left out. See LICENSE in this
directory (a copy of the KANJIDIC2 licence). This pack is a derived work and
is shared under the same licence, CC BY-SA 4.0.

Generated by scripts/prepare-standard-levels.mjs from the bundled KANJIDIC2.
`
	});

	await writePack(join(packs, 'tgh-chars'), {
		manifest: {
			id: 'tgh-chars',
			name: '通用规范汉字表 (2013) levels',
			version: `unihan@${unicodeVersion}`,
			type: 'levels',
			language: 'zh',
			license: 'Unicode License v3',
			attribution:
				'Levels of the 通用规范汉字表 (State Council, 2013) from the kTGH field of the Unicode Unihan database ' +
				'(Unicode License v3), https://www.unicode.org/reports/tr38/; converted by qinqin',
			notice: TGH_NOTICE,
			format: 'json'
		},
		unit: 'character',
		marker: true,
		levels: tgh,
		license: uniLicense,
		attribution: `# 通用规范汉字表 (2013) levels

The 8,105 characters of the 通用规范汉字表 (State Council, 国发〔2013〕23号)
in three levels: Level 1 (一级, serial 1–3,500), Level 2 (二级, 3,501–6,500)
and Level 3 (三级, 6,501–8,105), each in table order.

Source: the \`kTGH\` field of Unihan_OtherMappings.txt in the Unicode Unihan
database (Unicode Version ${unicodeVersion}), © Unicode, Inc., Unicode License v3,
https://www.unicode.org/reports/tr38/. Only the serial number of each
character is used. See LICENSE in this directory (a copy of the Unihan licence).

Generated by scripts/prepare-standard-levels.mjs from the bundled Unihan.
`
	});

	const counts = (levels) => levels.map((l) => `${l.name} ${l.entries.length}`).join(', ');
	console.log(`joyo-grades: ${counts(joyo)}`);
	console.log(`tgh-chars: ${counts(tgh)}`);
}

// Run only as a script: the tests import the helpers.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		await main();
	} catch (err) {
		if (!(err instanceof PackError)) throw err;
		console.error(`prepare-standard-levels: ${err.message}`);
		process.exit(1);
	}
}
