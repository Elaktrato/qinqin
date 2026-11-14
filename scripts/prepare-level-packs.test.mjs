// Tests of the level pack converter's parsing rules:
//   node --test scripts/prepare-level-packs.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
	GRADE_LEVEL_MAX,
	OLD2_N3_MAX_FREQ,
	PackError,
	approxJlptLevels,
	gapLevel,
	hskWordLevels,
	parseKanjidic2,
	records,
	stripSuru,
	vocabForms
} from './prepare-level-packs.mjs';

const script = fileURLToPath(new URL('./prepare-level-packs.mjs', import.meta.url));

/** kanjidic2XML builds a minimal KANJIDIC2 file: one <character> per spec. */
function kanjidic2XML(chars) {
	const body = chars
		.map(({ literal, grade, freq, jlpt }) => {
			const misc = [
				grade === undefined ? '' : `<grade>${grade}</grade>`,
				'<stroke_count>4</stroke_count>',
				freq === undefined ? '' : `<freq>${freq}</freq>`,
				jlpt === undefined ? '' : `<jlpt>${jlpt}</jlpt>`
			].join('\n');
			return `<character>\n<literal>${literal}</literal>\n<codepoint><cp_value cp_type="ucs">0</cp_value></codepoint>\n<misc>\n${misc}\n</misc>\n</character>`;
		})
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE kanjidic2 [\n<!ELEMENT literal (#PCDATA)>\n]>\n<kanjidic2>\n<header><file_version>4</file_version><database_version>2026-315</database_version><date_of_creation>2026-11-11</date_of_creation></header>\n${body}\n</kanjidic2>\n`;
}

// The synthetic fixture: one kanji per rule. 日 and 語 are in the base list,
// with KANJIDIC2 fields that would put them elsewhere: the base wins.
const FIXTURE_TSV = '5\t日\n4\t語\n3\t\n2\t\n1\t\n';
const FIXTURE_KANJI = [
	{ literal: '日', grade: 1, freq: 1, jlpt: 4 },
	{ literal: '語', grade: 8, freq: 2400, jlpt: 1 }, // base N4 kept
	{ literal: '分', grade: 2, freq: 24, jlpt: 4 }, // old 4 → N5
	{ literal: '畑', grade: 3, freq: 1176, jlpt: 3 }, // old 3 → N4
	{ literal: '的', grade: 4, freq: OLD2_N3_MAX_FREQ, jlpt: 2 }, // old 2, at the cut → N3
	{ literal: '坊', grade: 8, freq: OLD2_N3_MAX_FREQ + 1, jlpt: 2 }, // old 2, beyond the cut → N2
	{ literal: '璽', grade: 8, jlpt: 2 }, // old 2, no frequency → N2
	{ literal: '吾', grade: 9, freq: 1828, jlpt: 1 }, // old 1 → N1 (even a name kanji)
	{ literal: '岡', grade: 4, freq: 463 }, // grade 4 → N3
	{ literal: '誰', grade: 8, freq: 1933 }, // grade 8 → N1
	{ literal: '闇', grade: 8 }, // jōyō, no frequency → N1
	{ literal: '伊', grade: 9, freq: 1300 }, // jinmeiyō, no old level: not listed
	{ literal: '彦', grade: 10 }, // jinmeiyō: not listed
	{ literal: '乂' } // no grade, no old level: not listed
];

test('parseKanjidic2 reads literal, grade, frequency and the old JLPT level', () => {
	const kd = parseKanjidic2(kanjidic2XML(FIXTURE_KANJI));
	assert.equal(kd.size, FIXTURE_KANJI.length);
	assert.deepEqual(kd.get('分'), { grade: 2, freq: 24, old: 4 });
	assert.deepEqual(kd.get('闇'), { grade: 8, freq: null, old: null });
	assert.deepEqual(kd.get('乂'), { grade: null, freq: null, old: null });
	assert.throws(() => parseKanjidic2('<kanjidic2></kanjidic2>'), (err) => err instanceof PackError && /no <character>/.test(err.message));
});

test('gapLevel maps the old four-level scale, splitting old level 2 by frequency', () => {
	assert.equal(gapLevel({ grade: 2, freq: 24, old: 4 }), 'N5');
	assert.equal(gapLevel({ grade: 3, freq: 1176, old: 3 }), 'N4');
	assert.equal(gapLevel({ grade: 4, freq: OLD2_N3_MAX_FREQ, old: 2 }), 'N3');
	assert.equal(gapLevel({ grade: 4, freq: OLD2_N3_MAX_FREQ + 1, old: 2 }), 'N2');
	assert.equal(gapLevel({ grade: 8, freq: null, old: 2 }), 'N2');
	assert.equal(gapLevel({ grade: 9, freq: 1828, old: 1 }), 'N1');
	assert.equal(gapLevel({ grade: null, freq: null, old: 1 }), 'N1');
});

test('gapLevel derives a level from the school grade for jōyō kanji without an old level', () => {
	for (const [level, maxGrade] of GRADE_LEVEL_MAX) {
		assert.equal(gapLevel({ grade: maxGrade, freq: 100, old: null }), level, `grade ${maxGrade}`);
	}
	const lastMax = GRADE_LEVEL_MAX[GRADE_LEVEL_MAX.length - 1][1];
	for (let grade = lastMax + 1; grade <= 8; grade++) {
		if (grade === 7) continue; // KANJIDIC2 has no grade 7
		assert.equal(gapLevel({ grade, freq: 100, old: null }), 'N1', `grade ${grade}`);
	}
	// A jōyō kanji with neither a frequency nor an old level goes to N1.
	assert.equal(gapLevel({ grade: 1, freq: null, old: null }), 'N1');
	assert.equal(gapLevel({ grade: 8, freq: null, old: null }), 'N1');
});

test('gapLevel lists no jinmeiyō or grade-less kanji without an old level', () => {
	assert.equal(gapLevel({ grade: 9, freq: 1300, old: null }), null);
	assert.equal(gapLevel({ grade: 10, freq: null, old: null }), null);
	assert.equal(gapLevel({ grade: null, freq: 2000, old: null }), null);
	assert.equal(gapLevel({ grade: null, freq: null, old: null }), null);
});

test('approxJlptLevels keeps the base list and appends the gap fill', () => {
	const kd = parseKanjidic2(kanjidic2XML(FIXTURE_KANJI));
	const { levels, added } = approxJlptLevels(FIXTURE_TSV, kd);
	assert.deepEqual(
		levels.map((l) => [l.name, l.entries]),
		[
			['N5', ['日', '分']],
			['N4', ['語', '畑']],
			['N3', ['岡', '的']], // by frequency rank: 463, then the cut
			['N2', ['坊', '璽']],
			['N1', ['吾', '誰', '闇']]
		]
	);
	assert.deepEqual(added, { old: 6, grade: 3 });
});

test('approxJlptLevels orders the added kanji by frequency, then code point', () => {
	const kd = parseKanjidic2(
		kanjidic2XML([
			{ literal: '闇', grade: 8 },
			{ literal: '誰', grade: 8, freq: 1933 },
			{ literal: '俺', grade: 8, freq: 1946 },
			{ literal: '宛', grade: 8 }
		])
	);
	const { levels } = approxJlptLevels('5\t\n4\t\n3\t\n2\t\n1\t\n', kd);
	assert.deepEqual(levels[4].entries, ['誰', '俺', '宛', '闇']);
});

/** jlptFixture writes the upstream dir and a packs dir with a KANJIDIC2 fixture. */
function jlptFixture(dir, { withKanjidic = true } = {}) {
	const upstream = join(dir, 'upstream');
	mkdirSync(upstream);
	writeFileSync(join(upstream, 'jlpt.tsv'), FIXTURE_TSV);
	writeFileSync(join(upstream, 'kanjiapi.dev-LICENSE'), 'MIT licence text\n');
	const packs = join(dir, 'packs');
	mkdirSync(packs);
	if (withKanjidic) {
		mkdirSync(join(packs, 'kanjidic2'));
		writeFileSync(join(packs, 'kanjidic2', 'kanjidic2.xml.gz'), gzipSync(Buffer.from(kanjidic2XML(FIXTURE_KANJI))));
		writeFileSync(join(packs, 'kanjidic2', 'LICENSE'), 'CC BY-SA 4.0 licence text\n');
	}
	return { upstream, packs };
}

test('JLPT mode fails clearly when the bundled KANJIDIC2 is missing', () => {
	const dir = mkdtempSync(join(tmpdir(), 'jlpt-kanji-missing-'));
	try {
		const { upstream, packs } = jlptFixture(dir, { withKanjidic: false });
		const r = spawnSync(process.execPath, [script, upstream, packs], { encoding: 'utf8' });
		assert.equal(r.status, 1);
		assert.match(r.stderr, /kanjidic2\.xml\.gz/);
		assert.match(r.stderr, /KANJIDIC2/);
		assert.equal(existsSync(join(packs, 'jlpt-kanji')), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('JLPT mode writes the approximate pack deterministically', () => {
	const dir = mkdtempSync(join(tmpdir(), 'jlpt-kanji-'));
	try {
		const { upstream, packs } = jlptFixture(dir);
		const files = ['manifest.json', 'levels.json', 'LICENSE', 'LICENSE-KANJIDIC2', 'ATTRIBUTION.md'];
		const run = () => {
			const r = spawnSync(process.execPath, [script, upstream, packs], { encoding: 'utf8' });
			assert.equal(r.status, 0, r.stderr);
			return files.map((f) => readFileSync(join(packs, 'jlpt-kanji', f), 'utf8'));
		};
		const a = run();
		const b = run();
		assert.deepEqual(a, b);
		const manifest = JSON.parse(a[0]);
		assert.equal(manifest.id, 'jlpt-kanji');
		assert.equal(manifest.name, 'JLPT kanji (approximate)');
		assert.match(manifest.license, /MIT/);
		assert.match(manifest.license, /CC BY-SA 4\.0/);
		assert.match(manifest.attribution, /kanjiapi\.dev/);
		assert.match(manifest.attribution, /KANJIDIC2/);
		assert.match(manifest.attribution, /approximat/i);
		assert.equal(JSON.parse(a[1]).levels.reduce((n, l) => n + l.entries.length, 0), 11);
		assert.equal(a[2], 'MIT licence text\n');
		assert.equal(a[3], 'CC BY-SA 4.0 licence text\n');
		assert.match(a[4], /approximation/);
		assert.match(a[4], /EDRDG/);
		assert.match(a[4], /2010/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('stripSuru keeps する after a one-character stem', () => {
	for (const verb of ['関する', '対する', '値する', '摩する', '愛する']) {
		assert.equal(stripSuru(verb), verb);
	}
	assert.equal(stripSuru('勉強する'), '勉強');
	assert.equal(stripSuru('コピーする'), 'コピー');
	assert.equal(stripSuru('する'), 'する');
});

test('vocabForms pairs readings with the pieces', () => {
	assert.deepEqual(vocabForms('風', 'かぜ').forms, [{ form: '風', reading: 'かぜ' }]);
	assert.deepEqual(vocabForms('足; 脚', 'あし').forms, [
		{ form: '足', reading: 'あし' },
		{ form: '脚', reading: 'あし' }
	]);
	assert.deepEqual(vocabForms('いい; よい', 'いい; よい').forms, [
		{ form: 'いい', reading: '' },
		{ form: 'よい', reading: '' }
	]);
	assert.deepEqual(vocabForms('伯父; 叔父さん', 'おじ').forms, [
		{ form: '伯父', reading: 'おじ' },
		{ form: '叔父さん', reading: 'おじ' }
	]);
	assert.deepEqual(vocabForms('～円', '～えん').forms, [{ form: '円', reading: 'えん' }]);
	assert.deepEqual(vocabForms('勉強する', 'べんきょうする').forms, [{ form: '勉強', reading: 'べんきょう' }]);
	assert.deepEqual(vocabForms('関する', 'かんする').forms, [{ form: '関する', reading: 'かんする' }]);
	assert.deepEqual(vocabForms('風', 'kaze').forms, [{ form: '風', reading: '' }]);
	const pattern = vocabForms('いくら～ても', 'いくら～ても');
	assert.deepEqual(pattern.forms, []);
	assert.equal(pattern.dropped, 1);
});

test('hskWordLevels keeps a repeated word at its lowest level only', () => {
	const csv = [
		'ID,Simplified,Level,Variants',
		'L1-0001,好,1,',
		'L1-0002,你好,1,',
		'L2-0001,好,2,',
		'L4-0001,好,4,',
		'L4-0002,好看,4,',
		'L7-0001,你好,7-9,'
	].join('\n');
	const { levels, repeats } = hskWordLevels(csv);
	assert.deepEqual(
		levels.filter((l) => l.entries.length > 0).map((l) => [l.name, l.entries]),
		[
			['HSK 1', ['好', '你好']],
			['HSK 4', ['好看']]
		]
	);
	assert.equal(repeats, 3);
});

test('records fails with the file name on an empty or malformed CSV', () => {
	assert.throws(() => records('', 'n5.csv', ['expression']), (err) => err instanceof PackError && /n5\.csv: empty/.test(err.message));
	assert.throws(() => records('a,b\n"x,1\n', 'n4.csv', ['a']), (err) => err instanceof PackError && /n4\.csv: unterminated/.test(err.message));
	assert.throws(() => records('a,b\n1,2\n', 'n3.csv', ['expression']), (err) => err instanceof PackError && /missing column expression/.test(err.message));
	assert.deepEqual(records('﻿expression,reading\n風,かぜ\n', 'n2.csv', ['expression']), [{ expression: '風', reading: 'かぜ' }]);
});

test('--hsk fails clearly when the upstream files are missing', () => {
	const dir = mkdtempSync(join(tmpdir(), 'hsk-missing-'));
	try {
		const r = spawnSync(process.execPath, [script, '--hsk', dir, join(dir, 'out')], { encoding: 'utf8' });
		assert.equal(r.status, 1);
		assert.match(r.stderr, /hsk30\.csv is missing/);
		assert.match(r.stderr, /not bundled/);
		assert.equal(existsSync(join(dir, 'out')), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('--hsk writes the local-only packs deterministically', () => {
	const dir = mkdtempSync(join(tmpdir(), 'hsk-local-'));
	try {
		writeFileSync(join(dir, 'hsk30.csv'), 'ID,Simplified,Level,Variants\nL1-0001,你好,1,\nL7-0001,爱情,7-9,\n');
		writeFileSync(join(dir, 'hsk30-chars.csv'), 'Hanzi,Level\n你,1\n爱,7-9\n');
		writeFileSync(join(dir, 'hsk30-LICENSE'), 'MIT licence text\n');
		const run = (out) => {
			const r = spawnSync(process.execPath, [script, '--hsk', dir, out], { encoding: 'utf8' });
			assert.equal(r.status, 0, r.stderr);
			return ['hsk30-chars', 'hsk30-words'].flatMap((id) =>
				['manifest.json', 'levels.json', 'LICENSE', 'ATTRIBUTION.md'].map((f) => readFileSync(join(out, id, f), 'utf8'))
			);
		};
		const a = run(join(dir, 'a'));
		const b = run(join(dir, 'b'));
		assert.deepEqual(a, b);
		assert.match(a[3], /not bundled/i);
		assert.match(a[3], /版权所有：中华人民共和国教育部/);
		assert.match(a[0], /"HSK 3\.0 \(characters\)"/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('--jlpt-vocab fails clearly when the upstream files are missing', () => {
	const dir = mkdtempSync(join(tmpdir(), 'jlpt-missing-'));
	try {
		const r = spawnSync(process.execPath, [script, '--jlpt-vocab', dir, join(dir, 'out')], { encoding: 'utf8' });
		assert.equal(r.status, 1);
		assert.match(r.stderr, /n5\.csv is missing/);
		assert.match(r.stderr, /not bundled/);
		assert.equal(existsSync(join(dir, 'out')), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('--jlpt-vocab writes the local-only pack deterministically', () => {
	const dir = mkdtempSync(join(tmpdir(), 'jlpt-local-'));
	try {
		const rows = {
			'n5.csv': 'expression,reading,meaning\n風,かぜ,wind\n',
			'n4.csv': 'expression,reading,meaning\n勉強する,べんきょうする,study\n',
			'n3.csv': 'expression,reading,meaning\n学校,がっこう,school\n',
			'n2.csv': 'expression,reading,meaning\n猫,ねこ,cat\n',
			'n1.csv': 'expression,reading,meaning\n鳥,とり,bird\n'
		};
		for (const [name, text] of Object.entries(rows)) writeFileSync(join(dir, name), text);
		writeFileSync(join(dir, 'LICENSE'), 'MIT licence text\n');
		const run = (out) => {
			const r = spawnSync(process.execPath, [script, '--jlpt-vocab', dir, out], { encoding: 'utf8' });
			assert.equal(r.status, 0, r.stderr);
			return ['manifest.json', 'levels.json', 'LICENSE', 'ATTRIBUTION.md'].map((f) =>
				readFileSync(join(out, 'jlpt-words', f), 'utf8')
			);
		};
		const a = run(join(dir, 'a'));
		const b = run(join(dir, 'b'));
		assert.deepEqual(a, b);
		assert.match(a[0], /NOT BUNDLED, local use only/);
		assert.match(a[0], /"JLPT \(vocabulary\)"/);
		assert.match(a[3], /not bundled/i);
		assert.match(a[3], /tanos\.co\.uk/);
		assert.match(a[3], /could not be (reached|verified)/);
		assert.equal(existsSync(join(dir, 'a', 'jlpt-kanji')), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
