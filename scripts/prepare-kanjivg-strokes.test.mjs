// Tests of the KanjiVG stroke-data pack builder:
//   node --test scripts/prepare-kanjivg-strokes.test.mjs
// The SVGs under scripts/testdata/kanjivg/ are unmodified KanjiVG files
// (CC BY-SA 3.0, credited in that directory's README).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { HALF_WIDTH, buildLine, flatten, includeCodePoint, parsePath, parseStrokes, strokeToData, toData } from './prepare-kanjivg-strokes.mjs';

const script = fileURLToPath(new URL('./prepare-kanjivg-strokes.mjs', import.meta.url));
const fixtures = fileURLToPath(new URL('./testdata/kanjivg/', import.meta.url));
const svgOf = (name) => readFileSync(join(fixtures, name), 'utf8');

function checkout() {
	const dir = mkdtempSync(join(tmpdir(), 'kvg-strokes-'));
	mkdirSync(join(dir, 'kanji'));
	for (const f of readdirSync(fixtures).filter((n) => n.endsWith('.svg'))) cpSync(join(fixtures, f), join(dir, 'kanji', f));
	return dir;
}

test('parsePath reads absolute and relative M, C and S with packed numbers', () => {
	const segs = parsePath('M10,10c10,0,10,10,0,10s-5,5-10,10');
	assert.deepEqual(segs[0], [
		[10, 10],
		[20, 10],
		[20, 20],
		[10, 20]
	]);
	// S reflects the previous second control point (20,20 about 10,20 = 0,20), relative to the point (10,20).
	assert.deepEqual(segs[1], [
		[10, 20],
		[0, 20],
		[5, 25],
		[0, 30]
	]);
	assert.deepEqual(parsePath('M1.5.5C2,2,3,3,4,4')[0][0], [1.5, 0.5]);
	assert.throws(() => parsePath('M0,0L5,5'), /unsupported path command L/);
	assert.throws(() => parsePath('c1,1,1,1,1,1'), /must start with M/);
});

test('parseStrokes lists the stroke paths in stroke order', () => {
	const strokes = parseStrokes(svgOf('03042.svg'));
	assert.equal(strokes.length, 3);
	assert.ok(strokes[0].startsWith('M31.01,33c'));
	assert.equal(parseStrokes(svgOf('08a9e.svg')).length, 14);
	// a file with the strokes out of document order is sorted by the -sN suffix
	const swapped = '<path id="kvg:0abcd-s2" d="M2,2c1,1,1,1,2,2"/><path id="kvg:0abcd-s1" d="M1,1c1,1,1,1,2,2"/>';
	assert.deepEqual(parseStrokes(swapped), ['M1,1c1,1,1,1,2,2', 'M2,2c1,1,1,1,2,2']);
	assert.throws(() => parseStrokes('<svg></svg>'), /no strokes/);
});

test('toData maps the 109-unit KanjiVG box onto the 1024 box, y up with the baseline at 900', () => {
	assert.deepEqual(toData([0, 0]), [0, 900]);
	assert.deepEqual(toData([109, 109]), [1024, -124]);
	assert.deepEqual(toData([54.5, 54.5]), [512, 388]);
});

test('flatten samples the curve densely enough and keeps its ends', () => {
	const pts = flatten(parsePath('M31.01,33c0.88,0.88,2.75,1.82,5.25,1.75c8.62-0.25,20-2.12,29.5-4.25'));
	assert.deepEqual(pts[0], [31.01, 33]);
	const last = pts[pts.length - 1];
	assert.ok(Math.abs(last[0] - 65.76) < 1e-6 && Math.abs(last[1] - 30.5) < 1e-6);
	for (let i = 1; i < pts.length; i++) assert.ok(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < 6, 'no gap over 6 units');
});

/** segDist is the distance of p to the segment a-b. */
function segDist(p, a, b) {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const len2 = dx * dx + dy * dy;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
	return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

test('strokeToData: the median starts and ends at the path ends, the outline is a closed polygon around it', () => {
	const d = parseStrokes(svgOf('03042.svg'))[1];
	const { outline, median } = strokeToData(d);
	const start = toData([49.76, 17.62]);
	assert.ok(Math.abs(median[0][0] - start[0]) <= 1 && Math.abs(median[0][1] - start[1]) <= 1);
	assert.ok(median.length >= 3 && median.length <= 24);
	assert.match(outline, /^M-?\d+ -?\d+( L-?\d+ -?\d+)+ Z$/);
	const poly = outline
		.slice(1, -2)
		.split(' L')
		.map((p) => p.trim().split(' ').map(Number));
	// every outline point is within the half width (plus the cap and a rounding allowance) of the median
	const reach = ((HALF_WIDTH * 1024) / 109) * 1.6;
	for (const [x, y] of poly) {
		const near = Math.min(...median.slice(1).map((b, i) => segDist([x, y], median[i], b)));
		assert.ok(near <= reach + 12, `outline point ${x},${y} is ${near} from the median`);
	}
	// and it encloses the median points (even-odd ray test)
	const inside = ([px, py]) => {
		let c = false;
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const [xi, yi] = poly[i];
			const [xj, yj] = poly[j];
			if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
		}
		return c;
	};
	const mid = median[Math.floor(median.length / 2)];
	assert.ok(inside(mid), 'the middle of the median lies inside the outline');
});

test('strokeToData copes with a stroke that is a dot', () => {
	const { outline, median } = strokeToData('M50,50c0,0,0,0,0,0');
	assert.ok(median.length >= 2);
	assert.match(outline, / Z$/);
});

test('buildLine: one {"char","data"} object with equal stroke and median counts, under the server line cap', () => {
	for (const [file, char, n] of [
		['03042.svg', 'あ', 3],
		['08a9e.svg', '語', 14],
		['04e94.svg', '五', 4]
	]) {
		const line = buildLine(char, svgOf(file));
		const parsed = JSON.parse(line);
		assert.equal(parsed.char, char);
		assert.deepEqual(Object.keys(parsed.data).sort(), ['medians', 'strokes']);
		assert.equal(parsed.data.strokes.length, n);
		assert.equal(parsed.data.medians.length, n);
		assert.ok(Buffer.byteLength(line) < 64 << 10, `${char}: ${Buffer.byteLength(line)} bytes`);
	}
});

test('includeCodePoint: kana, kanji and iteration marks in, Latin and symbols out', () => {
	for (const cp of [0x3042, 0x30a2, 0x4e94, 0x3405, 0x20000, 0xf900, 0x3005]) assert.equal(includeCodePoint(cp), true, cp.toString(16));
	for (const cp of [0x21, 0x2c, 0x2e, 0x2f, 0x2605, 0x2700, 0x3000, 0x30fb]) assert.equal(includeCodePoint(cp), false, cp.toString(16));
});

test('the CLI builds a pack: variants and symbols skipped, sorted by code point, manifest and notices written', () => {
	const dir = checkout();
	const out = join(dir, 'out');
	try {
		writeFileSync(join(dir, 'kanji', '00021.svg'), svgOf('03042.svg'));
		writeFileSync(join(dir, 'COPYING'), 'licence text\n');
		const r = spawnSync(process.execPath, [script, join(dir, 'kanji'), out, '--version', 'r20260714', '--commit', 'd95a976'], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
		const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
		assert.equal(manifest.id, 'kanjivg-strokes');
		assert.equal(manifest.type, 'strokes');
		assert.equal(manifest.format, 'hanzi-writer-jsonl-gz');
		assert.deepEqual(manifest.languages, ['ja']);
		assert.equal(manifest.license, 'CC BY-SA 3.0');
		assert.equal(manifest.version, 'r20260714');
		assert.match(manifest.notice, /changed/i);
		const rows = gunzipSync(readFileSync(join(out, 'strokes.jsonl.gz')))
			.toString('utf8')
			.trimEnd()
			.split('\n')
			.map((l) => JSON.parse(l));
		assert.deepEqual(
			rows.map((r) => r.char),
			['あ', '五', '口', '言', '語']
		);
		assert.ok(!readdirSync(out).includes('COPYING'));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the CLI refuses a checkout without kanji files and a malformed path', () => {
	const dir = mkdtempSync(join(tmpdir(), 'kvg-strokes-'));
	try {
		const none = spawnSync(process.execPath, [script, join(dir, 'kanji'), join(dir, 'out'), '--version', 'r1', '--commit', 'abc'], { encoding: 'utf8' });
		assert.notEqual(none.status, 0);
		mkdirSync(join(dir, 'kanji'));
		writeFileSync(join(dir, 'kanji', '03042.svg'), '<path id="kvg:03042-s1" d="M1,1L2,2"/>');
		const bad = spawnSync(process.execPath, [script, join(dir, 'kanji'), join(dir, 'out'), '--version', 'r1', '--commit', 'abc'], { encoding: 'utf8' });
		assert.notEqual(bad.status, 0);
		assert.match(bad.stderr, /03042/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the fetch script pins the commit and checks COPYING against the licence pin', () => {
	const sh = readFileSync(fileURLToPath(new URL('./fetch-kanjivg-strokes.sh', import.meta.url)), 'utf8');
	assert.match(sh, /commit="d95a97627fd9fe5b2c8d06ca81e38149609c0c1e"/);
	assert.match(sh, /UPSTREAM\.sha256/);
	assert.match(sh, /kanjivg-components\/LICENSE/);
	assert.match(sh, /sha256sum/);
	assert.match(sh, /Attribution-Share Alike 3\.0/);
});

test('the Dockerfile builds the pack in its own stage and ships it as a separate seed root', () => {
	const docker = readFileSync(fileURLToPath(new URL('../Dockerfile', import.meta.url)), 'utf8');
	assert.match(docker, /AS kanjivg/);
	assert.match(docker, /COPY --from=kanjivg \/out \/opt\/qinqin\/kanjivg/);
	assert.match(docker, /QINQIN_PACKS=[^\n]*\/opt\/qinqin\/kanjivg/);
});
