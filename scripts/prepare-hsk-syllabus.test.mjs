// Tests of the HSK syllabus converter, on small synthetic word boxes in the
// layout `pdftotext -tsv` gives the syllabus (no text of the real file):
//   node --test scripts/prepare-hsk-syllabus.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	PackError,
	edition,
	levelsFromRows,
	parseSyllabusTSV,
	readingOf,
	tsvWords
} from './prepare-hsk-syllabus.mjs';

const script = fileURLToPath(new URL('./prepare-hsk-syllabus.mjs', import.meta.url));
const HEAD = 'level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';

// box is one word box (TSV level 5) at page, left, top, with height h.
const box = (page, left, top, text, h = 11.87) => `5\t${page}\t0\t0\t0\t0\t${left}\t${top}\t10\t${h}\t100\t${text}`;
// Non-word TSV levels (page, flow, line markers) are ignored.
const marker = (page) => `1\t${page}\t0\t0\t0\t0\t0\t0\t595\t841\t-1\t###PAGE###`;

const title = [marker(1), box(1, 200, 100, '考试大纲', 20), box(1, 80, 300, '2025-11'), box(1, 120, 300, '发布'),
	box(1, 300, 300, '2026-07'), box(1, 340, 300, '实施'), box(1, 200, 360, '中外语言交流合作中心')];
const header = (p) => [box(p, 75.48, 74.8, '序号', 13.27), box(p, 150.85, 74.8, '等级', 13.27),
	box(p, 229.21, 74.8, '词语', 13.27), box(p, 318.5, 74.8, '拼音', 13.27), box(p, 442.19, 74.8, '词性', 13.27)];
// row lays out one table row at top y; the pinyin boxes sit 3 pt higher
// and are taller, as in the PDF.
const row = (p, y, serial, level, word, pinyin, pos, levelLeft = 161.17) => [
	box(p, 82.92, y, serial),
	box(p, levelLeft, y, level),
	box(p, 220, y, word),
	...pinyin.split(' ').map((s, i) => box(p, 310 + 40 * i, y - 3, s, 15.76)),
	...(pos ? [box(p, 440, y, pos)] : [])
];

function fixture({ extra = [], drop = 0 } = {}) {
	const page2 = [
		marker(2), ...header(2),
		...row(2, 92, '1', '1', '爱', 'ài', '动'),
		box(2, 379, 65, '考', 47.95), // watermark glyph
		...row(2, 109, '2', '1（4）', '半', 'bàn', '数、（副）'),
		...row(2, 126, '3', '1', '本1', 'běn', '量'),
		...row(2, 143, '4', '1', '打电话', 'dǎ diànhuà', ''), // a phrase: no part of speech
		box(2, 291.72, 809.48, '77', 10.8) // page number
	];
	const page3 = [
		marker(3), ...header(3),
		...row(3, 92, '5', '2', '谁', 'shéi/shuí', '代'),
		...row(3, 109, '6', '2（3）（7-9）', '本2', 'běn', '名', 120), // a wide level cell
		...row(3, 126, '7', '7-9', '女儿', 'nǚ’ér', '名'),
		...row(3, 143, '8', '3', '汉语', 'Hànyǔ', '名'),
		box(3, 290, 790, '78', 10.8)
	];
	// A page of the character syllabus (no vocabulary header) is skipped.
	const page4 = [marker(4), box(4, 233, 77, 'HSK（一级）认读字'), box(4, 90, 100, '1.爱')];
	const lines = [HEAD, ...title, ...page2, ...page3, ...page4, ...extra];
	return lines.slice(0, lines.length - drop).join('\n') + '\n';
}

test('parseSyllabusTSV reads every row with its level, word and pinyin', () => {
	const { rows, report } = parseSyllabusTSV(fixture());
	assert.deepEqual(
		rows.map((r) => [r.serial, r.level, r.word, r.homograph, r.pinyin, r.pos]),
		[
			[1, '1', '爱', '', 'ài', '动'],
			[2, '1', '半', '', 'bàn', '数、（副）'],
			[3, '1', '本', '1', 'běn', '量'],
			[4, '1', '打电话', '', 'dǎ diànhuà', ''],
			[5, '2', '谁', '', 'shéi/shuí', '代'],
			[6, '2', '本', '2', 'běn', '名'],
			[7, '7-9', '女儿', '', 'nǚ’ér', '名'],
			[8, '3', '汉语', '', 'Hànyǔ', '名']
		]
	);
	assert.deepEqual(rows[1].extra, ['4']);
	assert.deepEqual(rows[5].extra, ['3', '7-9']);
	assert.deepEqual(report, { watermark: 1, pageNumbers: 2, tablePages: [2, 3] });
});

test('edition reads the dates of the title page', () => {
	assert.deepEqual(edition(tsvWords(fixture())), { published: '2025-11', effective: '2026-07' });
	const other = [HEAD, box(1, 1, 1, 'Something else')].join('\n');
	assert.throws(() => edition(tsvWords(other)), PackError);
});

test('levelsFromRows orders levels easiest first and keeps a form with its reading once', () => {
	const { rows } = parseSyllabusTSV(fixture());
	const { levels, stats } = levelsFromRows(rows);
	assert.deepEqual(levels.map((l) => l.name), ['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6', 'HSK 7–9']);
	assert.deepEqual(levels[0].entries, [
		{ form: '爱', reading: 'ài' },
		{ form: '半', reading: 'bàn' },
		{ form: '本', reading: 'běn' },
		{ form: '打电话', reading: 'dǎ diànhuà' }
	]);
	// 本2 has 本1's reading: kept once, at HSK 1.
	assert.deepEqual(levels[1].entries, [{ form: '谁', reading: 'shéi' }]);
	assert.deepEqual(levels[2].entries, [{ form: '汉语', reading: 'Hànyǔ' }]);
	assert.deepEqual(levels[6].entries, [{ form: '女儿', reading: 'nǚ’ér' }]);
	assert.deepEqual(stats.repeated, ['6 本 běn']);
	assert.equal(stats.homographs, 2);
	assert.equal(stats.alternates, 1);
	assert.equal(readingOf('shú/shóu'), 'shú');
});

test('parseSyllabusTSV rejects gaps, duplicates and malformed rows', () => {
	const cases = [
		[{ extra: row(3, 160, '10', '3', '常见', 'cháng jiàn', '') }, /missing serial numbers: 9/],
		[{ extra: row(3, 160, '8', '3', '常见', 'cháng jiàn', '') }, /duplicate serial numbers: 8/],
		[{ extra: row(3, 160, '9', '10', '常见', 'cháng jiàn', '') }, /unexpected level "10"/],
		[{ extra: row(3, 160, '9', '3', '常见A', 'cháng jiàn', '') }, /unexpected word "常见A"/],
		[{ extra: [box(3, 82.92, 160, '9'), box(3, 161.17, 160, '3'), box(3, 220, 160, '常见')] }, /serial 9: no pinyin/],
		[{ extra: [box(3, 220, 400, '多余')] }, /text off the rows: "多余"/]
	];
	for (const [opts, re] of cases) {
		assert.throws(() => parseSyllabusTSV(fixture(opts)), (err) => err instanceof PackError && re.test(err.message), String(re));
	}
	assert.throws(() => parseSyllabusTSV('序号 等级 词语\n'), /not `pdftotext -tsv` output/);
	const noTable = [HEAD, ...title].join('\n');
	assert.throws(() => parseSyllabusTSV(noTable), /no vocabulary table/);
});

test('the CLI writes the pack, with no LICENSE, byte for byte on a re-run', () => {
	const dir = mkdtempSync(join(tmpdir(), 'hsk-syllabus-'));
	try {
		const tsv = join(dir, 'syllabus.tsv');
		const pdf = join(dir, 'syllabus.pdf');
		writeFileSync(tsv, fixture());
		writeFileSync(pdf, 'not a real pdf');
		const run = () => {
			const r = spawnSync(process.execPath, [script, tsv, join(dir, 'packs'), '--pdf', pdf], { encoding: 'utf8' });
			assert.equal(r.status, 0, r.stderr);
			return ['manifest.json', 'levels.json', 'ATTRIBUTION.md'].map((f) => readFileSync(join(dir, 'packs', 'hsk-words', f), 'utf8'));
		};
		const first = run();
		assert.deepEqual(run(), first);
		assert.equal(existsSync(join(dir, 'packs', 'hsk-words', 'LICENSE')), false);

		const manifest = JSON.parse(first[0]);
		assert.equal(manifest.id, 'hsk-words');
		assert.equal(manifest.name, 'HSK 3.0 (words)');
		assert.equal(manifest.language, 'zh');
		assert.equal(manifest.type, 'levels');
		assert.equal(manifest.license, 'No licence stated by the publisher');
		assert.match(manifest.attribution, /中外语言交流合作中心 \(CLEC\)/);
		assert.match(manifest.attribution, /copyright status of the list not verified/);
		assert.equal(manifest.version, '2025-11 (effective 2026-07)');

		const levels = JSON.parse(first[1]);
		assert.equal(levels.unit, 'word');
		assert.deepEqual(levels.levels.map((l) => l.entries.length), [4, 1, 1, 0, 0, 0, 1]);
		assert.match(first[2], /No licence stated by the publisher/);
		assert.match(first[2], /[0-9a-f]{64} {2}syllabus\.pdf/);

		const bad = spawnSync(process.execPath, [script], { encoding: 'utf8' });
		assert.notEqual(bad.status, 0);
		assert.match(bad.stderr, /usage:/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
