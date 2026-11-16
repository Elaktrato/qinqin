// Tests of the KanjiVG component index generator:
//   node --test scripts/prepare-kanjivg-components.test.mjs
// The SVGs under scripts/testdata/kanjivg/ are unmodified KanjiVG files
// (CC BY-SA 3.0, credited in that directory's README).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { noticeProblems } from './check-sources.mjs';
import { buildIndex, svgElements } from './prepare-kanjivg-components.mjs';

const script = fileURLToPath(new URL('./prepare-kanjivg-components.mjs', import.meta.url));
const fixtures = fileURLToPath(new URL('./testdata/kanjivg/', import.meta.url));

function checkout() {
	const dir = mkdtempSync(join(tmpdir(), 'kvg-'));
	mkdirSync(join(dir, 'kanji'));
	for (const f of readdirSync(fixtures).filter((n) => n.endsWith('.svg'))) cpSync(join(fixtures, f), join(dir, 'kanji', f));
	return dir;
}

test('svgElements lists the nested elements in document order with their path counts', () => {
	const svg = readFileSync(join(fixtures, '08a9e.svg'), 'utf8');
	const groups = svgElements(svg);
	assert.equal(groups[0].element, '語');
	assert.equal(groups[0].paths, 14);
	assert.deepEqual(
		groups.map((g) => g.element),
		['語', '言', '口', '吾', '五', '二', '二', '口']
	);
	assert.equal(groups.find((g) => g.element === '言').paths, 7);
	assert.equal(groups.filter((g) => g.element === '二').every((g) => g.split), true);
});

test('buildIndex: parts deduplicated in document order, self excluded; variants and non-ideographs skipped', () => {
	const dir = checkout();
	try {
		const { chars, strokes } = buildIndex(join(dir, 'kanji'));
		assert.deepEqual(chars.get('語'), ['言', '口', '吾', '五', '二']);
		assert.deepEqual(chars.get('言'), ['口']);
		assert.deepEqual(chars.get('五'), ['二', '一']);
		assert.equal(chars.has('且'), false, 'variant files are skipped');
		assert.equal(chars.has('あ'), false, 'kana are skipped');
		assert.equal(chars.has('口'), false, 'a kanji without nested elements has no line');
		// From the part's own file; else the most common count of its unsplit groups.
		assert.equal(strokes.get('言'), 7);
		assert.equal(strokes.get('口'), 3);
		assert.equal(strokes.get('五'), 4);
		assert.equal(strokes.get('吾'), 7, 'no file of its own: its unsplit group in 語');
		assert.equal(strokes.get('一'), 1);
		assert.equal(strokes.has('二'), false, 'only split groups and no file: no stroke count');
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test('the CLI writes a components-tsv pack that follows the import rules', () => {
	const dir = checkout();
	const out = join(dir, 'out');
	try {
		const run = spawnSync(process.execPath, [script, dir, out, '--version', 'r20260714', '--commit', 'd95a976'], { encoding: 'utf8' });
		assert.equal(run.status, 0, run.stderr);
		const lines = readFileSync(join(out, 'components.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
		assert.deepEqual(lines, ['五\t二 一', '言\t口', '語\t言 口 吾 五 二']);
		for (const line of lines) {
			const [char, parts, extra] = line.split('\t');
			assert.equal(extra, undefined);
			assert.equal([...char].length, 1);
			const list = parts.split(' ');
			assert.ok(list.length >= 1 && list.length <= 32);
			assert.equal(new Set(list).size, list.length);
			assert.ok(!list.includes(char));
			for (const p of list) assert.equal([...p].length, 1);
		}
		const parts = readFileSync(join(out, 'parts.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
		assert.deepEqual(parts, ['一\t1', '五\t4', '口\t3', '吾\t7', '言\t7']);
		const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
		assert.equal(m.id, 'kanjivg-components');
		assert.equal(m.type, 'components');
		assert.equal(m.format, 'components-tsv');
		assert.equal(m.language, 'ja');
		assert.equal(m.license, 'CC BY-SA 3.0');
		assert.equal(m.version, 'r20260714');
		assert.match(m.attribution, /Ulrich Apel/);
		assert.match(m.attribution, /kanjivg\.tagaini\.net/);
		assert.match(m.notice, /d95a976/);
		assert.deepEqual(noticeProblems(m.notice), []);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test('the CLI refuses missing arguments', () => {
	const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
	assert.notEqual(run.status, 0);
	assert.match(run.stderr, /usage/i);
});
