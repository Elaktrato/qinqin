// Tests of the local-only level pack converter:
//   node --test scripts/prepare-local-levels.test.mjs
// Fixtures are hand-written, own words; nothing is copied from TBCL or a
// curriculum list.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PackError } from './prepare-level-packs.mjs';
import { GENERATED_MARKER } from './prepare-level-packs.mjs';
import { parseLevelTsv } from './prepare-local-levels.mjs';

const script = fileURLToPath(new URL('./prepare-local-levels.mjs', import.meta.url));

test('header must have level and form columns', () => {
	assert.throws(() => parseLevelTsv('level\treading\nA\tx\n', 'word'), (e) => e instanceof PackError && /header/.test(e.message) && /form/.test(e.message));
	assert.throws(() => parseLevelTsv('', 'word'), PackError);
	assert.throws(() => parseLevelTsv('level\tform\nA\n', 'word'), (e) => /line 2/.test(e.message));
});

test('BOM, CRLF and trailing blank lines convert like a clean file', () => {
	const clean = 'level\tform\nA\t山\nB\t川\n';
	const dirty = '﻿level\tform\r\nA\t山\r\nB\t川\r\n\r\n\n';
	assert.deepEqual(parseLevelTsv(dirty, 'character'), parseLevelTsv(clean, 'character'));
	assert.deepEqual(parseLevelTsv(clean, 'character').levels, [
		{ name: 'A', entries: ['山'] },
		{ name: 'B', entries: ['川'] }
	]);
});

test('levels keep first-appearance order; a repeated form keeps its first level', () => {
	const { levels } = parseLevelTsv('level\tform\nZ\t水\nA\t火\nZ\t木\nA\t水\n', 'character');
	assert.deepEqual(levels, [
		{ name: 'Z', entries: ['水', '木'] },
		{ name: 'A', entries: ['火'] }
	]);
});

test('a reading is kept; the same form with another reading is a separate entry', () => {
	const { levels } = parseLevelTsv('level\tform\treading\nA\t行\txíng\nB\t行\thána\nB\t行\txíng\n', 'word');
	assert.deepEqual(levels, [
		{ name: 'A', entries: [{ form: '行', reading: 'xíng' }] },
		{ name: 'B', entries: [{ form: '行', reading: 'hána' }] }
	]);
});

test('a zhuyin reading is dropped and counted', () => {
	const r = parseLevelTsv('level\tform\treading\nA\t行\tㄒㄧㄥˊ\nA\t好\thǎo\nA\t大\tㄉㄚˋ\n', 'word');
	assert.equal(r.droppedZhuyin, 2);
	assert.deepEqual(r.levels[0].entries, ['行', { form: '好', reading: 'hǎo' }, '大']);
});

test('an empty level names the line', () => {
	assert.throws(() => parseLevelTsv('level\tform\nA\t山\n\t川\n', 'character'), (e) => e instanceof PackError && /line 3/.test(e.message));
	assert.throws(() => parseLevelTsv('level\tform\nA\t山\nB\t\n', 'character'), (e) => /line 3/.test(e.message));
});

test('unit character rejects a multi-character form', () => {
	assert.throws(() => parseLevelTsv('level\tform\nA\t山川\n', 'character'), (e) => e instanceof PackError && /line 2/.test(e.message));
	assert.deepEqual(parseLevelTsv('level\tform\nA\t山川\n', 'word').levels[0].entries, ['山川']);
	assert.deepEqual(parseLevelTsv('level\tform\nA\t𠀀\n', 'character').levels[0].entries, ['𠀀']);
});

function run(args, cwd) {
	return spawnSync('node', [script, ...args], { encoding: 'utf8', cwd });
}

const FLAGS = (extra = []) => [
	'--id', 'my-list', '--name', 'My list', '--language', 'zh', '--unit', 'word',
	'--license', 'private, all rights reserved', '--attribution', 'my own notes', ...extra
];

test('CLI writes a pack under data-local without a LICENSE', () => {
	const dir = mkdtempSync(join(tmpdir(), 'qq-loc-'));
	try {
		const tsv = join(dir, 'mini.tsv');
		const input = 'level\tform\treading\nL1\t你好\tnǐ hǎo\nL2\t谢谢\txièxie\n';
		writeFileSync(tsv, input);
		const out = join(dir, 'data-local');
		const r = run([...FLAGS(), tsv, out]);
		assert.equal(r.status, 0, r.stderr);
		const pack = join(out, 'my-list');
		assert.equal(existsSync(join(pack, 'LICENSE')), false);
		const manifest = JSON.parse(readFileSync(join(pack, 'manifest.json'), 'utf8'));
		assert.equal(manifest.type, 'levels');
		assert.equal(manifest.id, 'my-list');
		assert.equal(manifest.language, 'zh');
		assert.equal(manifest.license, 'private, all rights reserved');
		assert.equal(manifest.attribution, 'my own notes');
		const levels = JSON.parse(readFileSync(join(pack, 'levels.json'), 'utf8'));
		assert.equal(levels.unit, 'word');
		assert.equal(levels.levels.length, 2);
		const attribution = readFileSync(join(pack, 'ATTRIBUTION.md'), 'utf8');
		assert.match(attribution, /not bundled, local use only/);
		assert.ok(attribution.includes(createHash('sha256').update(input).digest('hex')));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('CLI refuses a directory not named data-local unless --force-dir', () => {
	const dir = mkdtempSync(join(tmpdir(), 'qq-loc-'));
	try {
		const tsv = join(dir, 'mini.tsv');
		writeFileSync(tsv, 'level\tform\nL1\t你好\n');
		const out = join(dir, 'data');
		const refused = run([...FLAGS(), tsv, out]);
		assert.notEqual(refused.status, 0);
		assert.match(refused.stderr, /data-local/);
		assert.equal(existsSync(out), false);
		const forced = run([...FLAGS(['--force-dir']), tsv, out]);
		assert.equal(forced.status, 0, forced.stderr);
		assert.equal(existsSync(join(out, 'my-list', 'levels.json')), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('CLI default output is plugins/data-local and a bad TSV writes nothing', () => {
	const dir = mkdtempSync(join(tmpdir(), 'qq-loc-'));
	try {
		const tsv = join(dir, 'bad.tsv');
		writeFileSync(tsv, 'level\tform\nL1\t你好\n\t谢谢\n');
		const out = join(dir, 'data-local');
		const r = run([...FLAGS(), tsv, out]);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /line 3/);
		assert.equal(existsSync(out), false);
		const missing = run([...FLAGS(), join(dir, 'nope.tsv'), out]);
		assert.notEqual(missing.status, 0);
		const noId = run(['--name', 'x', tsv, out]);
		assert.notEqual(noId.status, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('CLI rejects an id that could escape the output directory', () => {
	const dir = mkdtempSync(join(tmpdir(), 'qq-loc-'));
	try {
		const tsv = join(dir, 'mini.tsv');
		writeFileSync(tsv, 'level\tform\nL1\t你好\n');
		const out = join(dir, 'data-local');
		const args = FLAGS().map((a) => (a === 'my-list' ? '../evil' : a));
		const r = run([...args, tsv, out]);
		assert.notEqual(r.status, 0);
		assert.equal(existsSync(join(dir, 'evil')), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('trailing empty cells are ignored', () => {
	assert.deepEqual(parseLevelTsv('level\tform\treading\t\nA\t山\t\t\n', 'character').levels, [{ name: 'A', entries: ['山'] }]);
});

test('a quoted cell is rejected with a clear message', () => {
	assert.throws(() => parseLevelTsv('level\tform\nA\t"詞"\n', 'word'), (e) => e instanceof PackError && /line 2/.test(e.message) && /quot/.test(e.message));
	assert.throws(() => parseLevelTsv('level\tform\n"A"\t詞\n', 'word'), (e) => /quot/.test(e.message));
});

test('a cell with several readings becomes one entry per reading', () => {
	const { levels } = parseLevelTsv('level\tform\treading\nA\t好\thǎo/hào\nA\t行\txíng、háng\n', 'word');
	assert.deepEqual(levels[0].entries, [
		{ form: '好', reading: 'hǎo' },
		{ form: '好', reading: 'hào' },
		{ form: '行', reading: 'xíng' },
		{ form: '行', reading: 'háng' }
	]);
});

function localSetup() {
	const dir = mkdtempSync(join(tmpdir(), 'qq-loc-'));
	const tsv = join(dir, 'mini.tsv');
	writeFileSync(tsv, 'level\tform\nL1\t你好\n');
	return { dir, tsv, out: join(dir, 'data-local') };
}

test('CLI marks its pack and overwrites only packs it wrote', () => {
	const { dir, tsv, out } = localSetup();
	try {
		assert.equal(run([...FLAGS(), tsv, out]).status, 0);
		assert.equal(existsSync(join(out, 'my-list', GENERATED_MARKER)), true);
		assert.equal(run([...FLAGS(), tsv, out]).status, 0, 'rewrites its own pack');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('CLI refuses to wipe a directory it did not write, or one holding a LICENSE', () => {
	const { dir, tsv, out } = localSetup();
	try {
		mkdirSync(join(out, 'my-list'), { recursive: true });
		writeFileSync(join(out, 'my-list', 'precious.txt'), 'x');
		const r = run([...FLAGS(), tsv, out]);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /not written by/);
		assert.equal(existsSync(join(out, 'my-list', 'precious.txt')), true);
		writeFileSync(join(out, 'my-list', GENERATED_MARKER), 'x');
		writeFileSync(join(out, 'my-list', 'LICENSE'), 'MIT');
		const r2 = run([...FLAGS(), tsv, out]);
		assert.notEqual(r2.status, 0);
		assert.match(r2.stderr, /LICENSE/);
		assert.equal(readFileSync(join(out, 'my-list', 'LICENSE'), 'utf8'), 'MIT');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('--force-dir cannot target the repository plugins/data', () => {
	const { dir, tsv } = localSetup();
	const bundled = fileURLToPath(new URL('../plugins/data', import.meta.url));
	try {
		const r = run([...FLAGS(['--force-dir']), tsv, bundled]);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /plugins\/data/);
		assert.equal(existsSync(join(bundled, 'my-list')), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
