// Tests of the local-only IDS components pack generator:
//   node --test scripts/prepare-ids-components.test.mjs
// The IDS and Unihan lines are invented for this test in the CHISE / cjkvi
// layout (U+XXXX<TAB>char<TAB>IDS); no IDS data is committed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanIDS, expandAll } from './prepare-ids-components.mjs';

const script = fileURLToPath(new URL('./prepare-ids-components.mjs', import.meta.url));

// Every decomposition below is invented for this test (the glyphs are
// placeholders, not their real structure), so no IDS database text is here.
const IDS = [
	'# a comment',
	'U+597D\t好\t⿰甲乙',
	'U+5988\t妈\t⿰甲丙',
	'U+7532\t甲\t甲',
	'U+4E19\t丙\t丙',
	'U+5B57\t字\t⿱丁乙',
	'U+4E01\t丁\t⿱一丂',
	'U+4E02\t丂\t⿱丁一',
	'U+4E03\t七\t⿻&X-0001;乚',
	'U+4E04\t丄\t？',
	'U+4E05\t丅\t^⿱一乙$(G)\t⿱一亅',
	'U+3042\tあ\t⿻一乙',
	''
].join('\n');

const UNIHAN = [
	'# a Unihan_IRGSources.txt-shaped sample',
	'U+4E00\tkTotalStrokes\t1',
	'U+4E59\tkTotalStrokes\t1 2',
	'U+7532\tkTotalStrokes\t5',
	'U+7532\tkRSUnicode\t102.0',
	''
].join('\n');

test('cleanIDS drops IDCs, entities, ？ and region tags', () => {
	assert.deepEqual(cleanIDS('⿰甲乙'), ['甲', '乙']);
	assert.deepEqual(cleanIDS('⿻&X-0001;乚'), ['乚']);
	assert.deepEqual(cleanIDS('？'), []);
	assert.deepEqual(cleanIDS('^⿱一乙$(G)'), ['一', '乙']);
	assert.deepEqual(cleanIDS('⿱一[GJ]乙'), ['一', '乙']);
	assert.deepEqual(cleanIDS('㇯一'), ['一']);
});

test('expandAll expands parts recursively, with a cycle guard and no self part', () => {
	const direct = new Map([
		['好', ['甲', '乙']],
		['甲', []],
		['丁', ['一', '丂']],
		['丂', ['丁', '一']],
		['孖', ['乙', '乙']],
		['嫂', ['甲', '丙']],
		['丙', ['丁', '乙']]
	]);
	const out = expandAll(direct);
	assert.deepEqual(out.get('好'), ['甲', '乙']);
	assert.deepEqual(out.get('丁'), ['一', '丂']);
	assert.deepEqual(out.get('丂'), ['丁', '一']);
	assert.deepEqual(out.get('孖'), ['乙']);
	assert.deepEqual(out.get('嫂'), ['甲', '丙', '丁', '一', '丂', '乙']);
	assert.equal(out.has('甲'), false);
});

function setup() {
	const dir = mkdtempSync(join(tmpdir(), 'ids-'));
	writeFileSync(join(dir, 'ids.txt'), IDS);
	writeFileSync(join(dir, 'Unihan_IRGSources.txt'), UNIHAN);
	return dir;
}

const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('the CLI writes a components-tsv pack with strokes from Unihan, only under the out dir', () => {
	const dir = setup();
	const out = join(dir, 'zh-components');
	try {
		const r = run([join(dir, 'ids.txt'), out, '--id', 'zh-components', '--license', 'GPL-2.0-or-later (as stated by CHISE)', '--attribution', 'CHISE IDS (https://www.chise.org)', '--unihan', join(dir, 'Unihan_IRGSources.txt')]);
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(readdirSync(dir).sort(), ['Unihan_IRGSources.txt', 'ids.txt', 'zh-components']);
		assert.deepEqual(readdirSync(out).sort(), ['components.tsv', 'manifest.json', 'parts.tsv']);
		const lines = readFileSync(join(out, 'components.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
		assert.deepEqual(lines, ['丁\t一 丂', '丂\t丁 一', '七\t乚', '丅\t一 乙', '好\t甲 乙', '妈\t甲 丙', '字\t丁 一 丂 乙']);
		const parts = readFileSync(join(out, 'parts.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
		assert.deepEqual(parts, ['一\t1', '乙\t1', '甲\t5']);
		const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
		assert.deepEqual(
			[m.id, m.type, m.format, m.language, m.license, m.attribution],
			['zh-components', 'components', 'components-tsv', 'zh', 'GPL-2.0-or-later (as stated by CHISE)', 'CHISE IDS (https://www.chise.org)']
		);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test('without --unihan there is no parts.tsv', () => {
	const dir = setup();
	const out = join(dir, 'p');
	try {
		const r = run([join(dir, 'ids.txt'), out, '--id', 'zh-components', '--license', 'x', '--attribution', 'y']);
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(readdirSync(out).sort(), ['components.tsv', 'manifest.json']);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test('the CLI requires --id, --license and --attribution and never writes into plugins/data', () => {
	const dir = setup();
	try {
		for (const missing of ['--id', '--license', '--attribution']) {
			const args = { '--id': 'zh-components', '--license': 'x', '--attribution': 'y' };
			delete args[missing];
			const r = run([join(dir, 'ids.txt'), join(dir, 'o'), ...Object.entries(args).flat()]);
			assert.notEqual(r.status, 0, missing);
			assert.match(r.stderr, /usage/i);
		}
		const bundled = fileURLToPath(new URL('../plugins/data/zh-components-test', import.meta.url));
		const r = run([join(dir, 'ids.txt'), bundled, '--id', 'zh-components', '--license', 'x', '--attribution', 'y']);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /plugins\/data/);
		assert.equal(readdirSync(fileURLToPath(new URL('../plugins/data', import.meta.url))).includes('zh-components-test'), false);
	} finally {
		rmSync(dir, { recursive: true });
	}
});
