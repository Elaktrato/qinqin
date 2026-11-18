// Tests of the HSK grammar outline extractor, on small synthetic word boxes
// in the layout `pdftotext -tsv` gives the syllabus (no text of the real
// file): node --test scripts/prepare-hsk-grammar.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGrammarTsv, tsvWords } from './prepare-hsk-grammar.mjs';

const HEAD = 'level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
// box is one word box (TSV level 5) at page, left, top, with height h.
const box = (page, left, top, text, h = 11.87) =>
	`5\t${page}\t0\t0\t0\t0\t${left}\t${top}\t10\t${h}\t100\t${text}`;

test('parseGrammarTsv extracts one level and one item row, dropping the furniture', () => {
	const tsv = [
		HEAD,
		box(386, 233, 54, 'HSK（一级）语法', 20.4),
		box(386, 220, 137, '方位名词'),
		box(386, 350, 137, '上、下、里、外、前、后'),
		box(386, 460, 40, '汉', 48), // the watermark glyph
		box(386, 289, 810, '1', 10.8) // the page number
	].join('\n') + '\n';
	assert.deepEqual(parseGrammarTsv(tsv).levels, [
		{
			name: 'HSK 1',
			rows: [{ row: 1, category: '', subcategory: '', item: '方位名词', content: ['上、下、里、外、前、后'] }]
		}
	]);
});

test('parseGrammarTsv carries category and subcategory forward and numbers rows', () => {
	const tsv = [
		HEAD,
		box(386, 233, 54, 'HSK（一级）语法', 20.4),
		box(386, 70, 78, '语素'), // category
		box(386, 134, 98, '前缀'), // subcategory with content, no item
		box(386, 387, 98, '小—、第—'),
		box(386, 134, 137, '名词'), // subcategory
		box(386, 213, 137, '方位名词'), // item
		box(386, 351, 137, '上、下、里、外、前、后')
	].join('\n') + '\n';
	assert.deepEqual(parseGrammarTsv(tsv).levels, [
		{
			name: 'HSK 1',
			rows: [
				{ row: 1, category: '语素', subcategory: '前缀', item: '', content: ['小—、第—'] },
				{ row: 2, category: '语素', subcategory: '名词', item: '方位名词', content: ['上、下、里、外、前、后'] }
			]
		}
	]);
});

test('parseGrammarTsv maps every level heading to its pack name', () => {
	const tsv = [
		HEAD,
		...['一级', '二级', '三级', '四级', '五级', '六级', '七—九级'].flatMap((cn, i) => [
			box(386 + i, 233, 54, `HSK（${cn}）语法`, 20.4),
			box(386 + i, 213, 137, '方位名词'),
			box(386 + i, 351, 137, '上、下')
		])
	].join('\n') + '\n';
	assert.deepEqual(
		parseGrammarTsv(tsv).levels.map((lv) => lv.name),
		['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6', 'HSK 7–9']
	);
	assert.equal(parseGrammarTsv(tsv).levels[6].rows[0].item, '方位名词');
});

test('parseGrammarTsv rejects input that is not `pdftotext -tsv` output', () => {
	assert.throws(() => tsvWords('序号 等级 词语\n'), /not `pdftotext -tsv` output/);
});
