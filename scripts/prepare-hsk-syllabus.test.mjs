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
	charLevelsFromLists,
	edition,
	parseCharacterLists,
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

function fixture({ extra = [], drop = 0, charExtra = {} } = {}) {
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
	// The character syllabus (no vocabulary header: the word table skips it).
	const lines = [HEAD, ...title, ...page2, ...page3, ...charPages(charExtra), ...extra];
	return lines.slice(0, lines.length - drop).join('\n') + '\n';
}

// listPage lays out one page of the character syllabus: an optional list
// heading, then numbered items in a column; an item is [n, ch] (number
// and character in separate boxes, as most are) or [n, ch, 'inline']
// (one box "169.四").
const listPage = (p, heading, items) => [
	marker(p),
	...(heading ? [box(p, 233.64, 77.75, heading, 19.42)] : []),
	...items.flatMap(([n, ch, inline], i) => {
		const y = 102.78 + 15.6 * i;
		return inline ? [box(p, 90, y, `${n}.${ch}`, 16.14)] : [box(p, 90, y, `${n}.`, 16.14), box(p, 111.96, y + 2.28, ch, 11.99)];
	}),
	box(p, 288.65, 809.7, String(350 + p), 10.8) // page number
];

// charPages is the character syllabus: one 认读字 list per level (国, 汉,
// 考 and 际 are listed characters, the tall watermark glyphs are not), the
// 书写字 lists, and a grammar page after the section. extra.<page> adds
// boxes to that page.
function charPages(extra = {}) {
	const pages = [
		listPage(4, 'HSK（一级）认读字', [[1, '爱'], [2, '八', 'inline'], [3, '国']]),
		listPage(5, null, [[4, '汉']]), // a list continues on the next page
		listPage(6, 'HSK（二级）认读字', [[1, '本']]),
		listPage(7, 'HSK（三级）认读字', [[1, '考'], [2, '爱']]), // 爱 again: HSK 1 keeps it
		listPage(8, 'HSK（四级）认读字', [[1, '际']]),
		listPage(9, 'HSK（五级）认读字', [[1, '书']]),
		listPage(10, 'HSK（六级）认读字', [[1, '傲']]),
		listPage(11, 'HSK（七—九级）认读字', [[1, '骄'], [2, '慢']]),
		listPage(12, 'HSK（一级）~（二级）书写字', [[1, '爱'], [2, '本']]),
		listPage(13, 'HSK（七—九级）书写字', [[1, '傲']]),
		[marker(14), box(14, 233, 54, 'HSK（一级）语法', 20.4), box(14, 70, 78, '类别')]
	];
	pages[0].push(box(4, 379, 65, '国', 47.95), box(4, 300, 300, '汉', 47.95)); // watermark
	for (const [p, boxes] of Object.entries(extra)) pages[Number(p) - 4].push(...boxes);
	return pages.flat();
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
	assert.deepEqual(report, { watermark: 3, pageNumbers: 2, tablePages: [2, 3] }); // 1 glyph on the table, 2 on the lists
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

test('parseCharacterLists reads the numbered lists, keeping 汉考国际 as characters', () => {
	const { lists, report } = parseCharacterLists(fixture());
	assert.deepEqual(
		lists.map((l) => [l.kind, l.levels.join('-'), l.chars.join('')]),
		[
			['认读字', '1', '爱八国汉'],
			['认读字', '2', '本'],
			['认读字', '3', '考爱'],
			['认读字', '4', '际'],
			['认读字', '5', '书'],
			['认读字', '6', '傲'],
			['认读字', '7-9', '骄慢'],
			['书写字', '1-2', '爱本'],
			['书写字', '7-9', '傲']
		]
	);
	assert.deepEqual(report.pages, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
	assert.equal(report.pageNumbers, 10);
});

test('charLevelsFromLists keeps a character at its lowest 认读字 level', () => {
	const { levels, stats } = charLevelsFromLists(parseCharacterLists(fixture()).lists);
	assert.deepEqual(levels.map((l) => [l.name, l.entries.join('')]), [
		['HSK 1', '爱八国汉'],
		['HSK 2', '本'],
		['HSK 3', '考'],
		['HSK 4', '际'],
		['HSK 5', '书'],
		['HSK 6', '傲'],
		['HSK 7–9', '骄慢']
	]);
	assert.deepEqual(stats.repeated, ['爱 (HSK（三级）认读字)']);
	assert.deepEqual(stats.writing.map((w) => w.count), [2, 1]);
});

test('the character lists reject gaps, empty items, stray text and unrecognised 书写字', () => {
	const cases = [
		[{ 5: [box(5, 90, 300, '6.', 16.14), box(5, 111.96, 302, '水', 11.99)] }, /HSK（一级）认读字: missing numbers 5/],
		[{ 6: [box(6, 90, 300, '1.', 16.14), box(6, 111.96, 302, '水', 11.99)] }, /HSK（二级）认读字: duplicate numbers 1/],
		[{ 6: [box(6, 90, 300, '2.', 16.14)] }, /page 6: item 2 has no character/],
		[{ 7: [box(7, 400, 400, '说明')] }, /page 7: text off the lists: "说明"/],
		[{ 12: [box(12, 90, 300, '3.', 16.14), box(12, 111.96, 302, '骄', 11.99)] }, /书写字: 骄 not recognised/]
	];
	for (const [charExtra, re] of cases) {
		assert.throws(
			() => charLevelsFromLists(parseCharacterLists(fixture({ charExtra })).lists),
			(err) => err instanceof PackError && re.test(err.message),
			String(re)
		);
	}
	assert.throws(() => parseCharacterLists([HEAD, ...title].join('\n')), /no character list/);
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
			return ['hsk-words', 'hsk-chars'].flatMap((pack) =>
				['manifest.json', 'levels.json', 'ATTRIBUTION.md'].map((f) => readFileSync(join(dir, 'packs', pack, f), 'utf8'))
			);
		};
		const first = run();
		assert.deepEqual(run(), first);
		assert.equal(existsSync(join(dir, 'packs', 'hsk-words', 'LICENSE')), false);
		assert.equal(existsSync(join(dir, 'packs', 'hsk-chars', 'LICENSE')), false);

		const chars = JSON.parse(first[3]);
		assert.equal(chars.id, 'hsk-chars');
		assert.equal(chars.name, 'HSK 3.0 (characters)');
		assert.equal(chars.license, 'See CTI Legal Notice; no reuse licence granted');
		assert.match(chars.attribution, /^Source: www\.chinesetest\.cn — reproduced from the Chinese Test Service Website \(CTI\); syllabus published by CLEC/);
		assert.match(chars.attribution, /汉字大纲, 认读字/);
		const charLevels = JSON.parse(first[4]);
		assert.equal(charLevels.unit, 'character');
		assert.deepEqual(charLevels.levels.map((l) => l.entries.length), [4, 1, 1, 1, 1, 1, 2]);
		assert.match(first[5], /HSK（一级）~（二级）书写字 \| 2 \|/);

		const manifest = JSON.parse(first[0]);
		assert.equal(manifest.id, 'hsk-words');
		assert.equal(manifest.name, 'HSK 3.0 (words)');
		assert.equal(manifest.language, 'zh');
		assert.equal(manifest.type, 'levels');
		assert.equal(manifest.license, 'See CTI Legal Notice; no reuse licence granted');
		assert.match(manifest.attribution, /^Source: www\.chinesetest\.cn — reproduced from the Chinese Test Service Website \(CTI\); syllabus published by CLEC/);
		assert.match(manifest.attribution, /CLEC \(中外语言交流合作中心\)/);
		assert.match(manifest.attribution, /legal status not verified/);
		assert.equal(manifest.version, '2025-11 (effective 2026-07)');

		const levels = JSON.parse(first[1]);
		assert.equal(levels.unit, 'word');
		assert.deepEqual(levels.levels.map((l) => l.entries.length), [4, 1, 1, 0, 0, 0, 1]);
		for (const attr of [first[2], first[5]]) {
			assert.match(attr, /No reuse licence is granted/);
			assert.match(attr, /https:\/\/www\.chinesetest\.cn\/legal-notice/);
			assert.match(attr, /copy-protection flag/);
			assert.match(attr, /no licence or public-domain\nstatus is claimed/);
			assert.match(attr, /includes only two lists from the syllabus/);
			assert.match(attr, /It does not include the syllabus's other content/);
			assert.match(attr, /legal status of including these lists has not been\nverified/);
			assert.doesNotMatch(attr, /states no terms/);
		}
		assert.match(first[2], /[0-9a-f]{64} {2}syllabus\.pdf/);

		const bad = spawnSync(process.execPath, [script], { encoding: 'utf8' });
		assert.notEqual(bad.status, 0);
		assert.match(bad.stderr, /usage:/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
