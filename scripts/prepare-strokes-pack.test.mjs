// Tests of the strokes pack builder:
//   node --test scripts/prepare-strokes-pack.test.mjs
// The fixture stands in for the hanzi-writer-data npm package: three
// invented stroke files (not the real data), its package.json and the real
// Arphic licence text copied from apps/web/static.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const script = fileURLToPath(new URL('./prepare-strokes-pack.mjs', import.meta.url));
const arphic = fileURLToPath(new URL('../apps/web/static/ARPHICPL.TXT', import.meta.url));

// Invented stroke data (shape of hanzi-writer-data files, not its content).
const FILES = {
	'好.json': '{"strokes":["M 1 2 Q 3 4"],"medians":[[[1,2],[3,4]]]}',
	'⺀.json': '{"strokes":["M 5 6"],"medians":[[[5,6]]],"radStrokes":[0]}',
	'一.json': '{"strokes":["M 7 8"],"medians":[[[7,8]]]}'
};

function setup() {
	const dir = mkdtempSync(join(tmpdir(), 'strokes-'));
	const src = join(dir, 'hanzi-writer-data');
	mkdirSync(src);
	for (const [name, body] of Object.entries(FILES)) writeFileSync(join(src, name), body);
	writeFileSync(join(src, 'package.json'), JSON.stringify({ name: 'hanzi-writer-data', version: '9.8.7' }));
	writeFileSync(join(src, 'index.js'), 'module.exports = {};\n');
	copyFileSync(arphic, join(src, 'ARPHICPL.TXT'));
	return { dir, src };
}

const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('writes a strokes pack: manifest, sorted jsonl.gz, LICENSE and ATTRIBUTION.md', () => {
	const { dir, src } = setup();
	const out = join(dir, 'out');
	try {
		const r = run(['--source', src, '--out', out]);
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(readdirSync(out).sort(), ['ATTRIBUTION.md', 'LICENSE', 'manifest.json', 'strokes.jsonl.gz']);

		const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
		assert.equal(m.id, 'hanzi-writer-strokes');
		assert.equal(m.type, 'strokes');
		assert.equal(m.format, 'hanzi-writer-jsonl-gz');
		assert.deepEqual(m.languages, ['zh', 'ja']);
		assert.equal(m.language, undefined);
		assert.equal(m.license, 'Arphic Public License');
		assert.match(m.attribution, /Make Me a Hanzi/);
		assert.match(m.attribution, /hanzi-writer-data/);
		assert.equal(m.version, '9.8.7');
		assert.ok(m.name);

		const lines = gunzipSync(readFileSync(join(out, 'strokes.jsonl.gz'))).toString('utf8').split('\n');
		assert.equal(lines.pop(), '');
		const rows = lines.map((l) => JSON.parse(l));
		// Sorted by code point: 一 U+4E00, 好 U+597D, then ⺀ U+2E80 first.
		assert.deepEqual(rows.map((x) => x.char), ['⺀', '一', '好']);
		for (const row of rows) {
			assert.deepEqual(row.data, JSON.parse(FILES[`${row.char}.json`]));
			// The file bytes are the data verbatim (served byte for byte later).
			assert.ok(lines[rows.indexOf(row)].includes(`"data":${FILES[`${row.char}.json`]}`));
		}

		assert.deepEqual(readFileSync(join(out, 'LICENSE')), readFileSync(arphic));
		const attribution = readFileSync(join(out, 'ATTRIBUTION.md'), 'utf8');
		assert.match(attribution, /Make Me a Hanzi/);
		assert.match(attribution, /Arphic Public License/);
		assert.match(attribution, /9\.8\.7/);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test('two runs write byte-identical files', () => {
	const { dir, src } = setup();
	try {
		assert.equal(run(['--source', src, '--out', join(dir, 'a')]).status, 0);
		assert.equal(run(['--source', src, '--out', join(dir, 'b')]).status, 0);
		for (const name of ['manifest.json', 'strokes.jsonl.gz', 'LICENSE', 'ATTRIBUTION.md']) {
			assert.deepEqual(readFileSync(join(dir, 'a', name)), readFileSync(join(dir, 'b', name)), name);
		}
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test('refuses a licence text that differs from apps/web/static/ARPHICPL.TXT', () => {
	const { dir, src } = setup();
	try {
		writeFileSync(join(src, 'ARPHICPL.TXT'), readFileSync(arphic, 'utf8') + 'changed\n');
		const r = run(['--source', src, '--out', join(dir, 'out')]);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /ARPHICPL\.TXT/);
		assert.equal(readdirSync(dir).includes('out'), false);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test('refuses a file name that is not one code point', () => {
	const { dir, src } = setup();
	try {
		writeFileSync(join(src, '好好.json'), '{"strokes":[],"medians":[]}');
		const r = run(['--source', src, '--out', join(dir, 'out')]);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /好好\.json/);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test('refuses a stroke file that is not a JSON object', () => {
	const { dir, src } = setup();
	try {
		writeFileSync(join(src, '二.json'), '[1, 2]');
		const r = run(['--source', src, '--out', join(dir, 'out')]);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /二\.json/);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test('--out is required', () => {
	const { dir, src } = setup();
	try {
		const r = run(['--source', src]);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /usage/i);
	} finally {
		rmSync(dir, { recursive: true });
	}
});
