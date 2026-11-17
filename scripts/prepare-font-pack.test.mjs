// Tests of scripts/prepare-font-pack.mjs. The font is synthetic: a
// TrueType font with one tiny glyph per code point, generated here (no
// upstream face is downloaded). The pure parts (pins, slice planning,
// renaming, the faces.json rules) run everywhere; building a pack needs the
// subsetter (`npm --prefix scripts/fonts ci`) and is skipped without it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FacesError, checkPackDir, parseFaces, unicodeRange } from './fonts/faces.mjs';
import { buildSfnt, parseSfnt, readCmap, readNames, weightOf } from './fonts/sfnt.mjs';
import {
	FORBIDDEN_NAMES,
	SLICES_FILE,
	SOURCES,
	buildPack,
	familyName,
	formatSliceTable,
	generateSliceTable,
	loadTools,
	planSlices,
	renameFont
} from './prepare-font-pack.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(new URL('./prepare-font-pack.mjs', import.meta.url));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

let tools = null;
try {
	tools = loadTools();
} catch {
	// building is skipped below
}
const needTools = tools ? {} : { skip: 'run `npm --prefix scripts/fonts ci` to build packs' };

// --- a synthetic TrueType font --------------------------------------------------

const COPYRIGHT = "Copyright 2026 The Test Authors, with Reserved Font Name 'Source'";
const LICENSE_DESC = 'This Font Software is licensed under the SIL Open Font License, Version 1.1.';

function u16(n) {
	const b = Buffer.alloc(2);
	b.writeUInt16BE(n & 0xffff);
	return b;
}
function u32(n) {
	const b = Buffer.alloc(4);
	b.writeUInt32BE(n >>> 0);
	return b;
}

function nameTable(records) {
	const header = Buffer.alloc(6 + records.length * 12);
	header.writeUInt16BE(records.length, 2);
	header.writeUInt16BE(header.length, 4);
	const parts = [];
	let off = 0;
	records.forEach(([platform, id, value], i) => {
		let data;
		if (platform === 3) {
			data = Buffer.from(value, 'utf16le');
			data.swap16();
		} else data = Buffer.from(value, 'latin1');
		const r = 6 + i * 12;
		header.writeUInt16BE(platform, r);
		header.writeUInt16BE(platform === 3 ? 1 : 0, r + 2);
		header.writeUInt16BE(platform === 3 ? 0x409 : 0, r + 4);
		header.writeUInt16BE(id, r + 6);
		header.writeUInt16BE(data.length, r + 8);
		header.writeUInt16BE(off, r + 10);
		parts.push(data);
		off += data.length;
	});
	return Buffer.concat([header, ...parts]);
}

/** makeFont builds a TrueType font mapping each code point to its own one-point glyph. */
export function makeFont({ points, family = 'Noto Test Sans', subfamily = 'Regular', weight = 400 }) {
	const n = points.length + 1; // glyph 0 is .notdef
	const glyph = Buffer.concat([u16(1), u16(0), u16(0), u16(10), u16(10), u16(0), u16(0), Buffer.from([1]), u16(0), u16(0), Buffer.alloc(1)]);
	const glyf = Buffer.concat(Array.from({ length: n }, () => glyph)); // 20 bytes each
	const loca = Buffer.concat(Array.from({ length: n + 1 }, (_, i) => u16((i * glyph.length) / 2)));
	const head = Buffer.concat([u32(0x00010000), u32(0x00010000), u32(0), u32(0x5f0f3cf5), u16(0), u16(1000),
		Buffer.alloc(16), u16(0), u16(0), u16(10), u16(10), u16(0), u16(8), u16(2), u16(0), u16(0)]);
	const hhea = Buffer.concat([u32(0x00010000), u16(800), u16(-200), u16(0), u16(1000), u16(0), u16(0), u16(10),
		u16(1), u16(0), u16(0), Buffer.alloc(8), u16(0), u16(n)]);
	const maxp = Buffer.concat([u32(0x00010000), u16(n), u16(1), u16(1), Buffer.alloc(22)]);
	const hmtx = Buffer.concat(Array.from({ length: n }, () => Buffer.concat([u16(1000), u16(0)])));
	const os2 = Buffer.alloc(96);
	os2.writeUInt16BE(4, 0);
	os2.writeUInt16BE(500, 2);
	os2.writeUInt16BE(weight, 4);
	os2.writeUInt16BE(5, 6);
	os2.write('TEST', 58, 'latin1');
	os2.writeUInt16BE(0x40, 62);
	os2.writeInt16BE(800, 68);
	os2.writeInt16BE(-200, 70);
	os2.writeUInt16BE(800, 74);
	os2.writeUInt16BE(200, 76);
	const groups = points.map((c, i) => Buffer.concat([u32(c), u32(c), u32(i + 1)]));
	const fmt12 = Buffer.concat([u16(12), u16(0), u32(16 + groups.length * 12), u32(0), u32(groups.length), ...groups]);
	const cmap = Buffer.concat([u16(0), u16(1), u16(3), u16(10), u32(12), fmt12]);
	const post = Buffer.concat([u32(0x00030000), Buffer.alloc(28)]);
	const ps = family.replace(/ /g, '');
	const name = nameTable([
		[3, 0, COPYRIGHT],
		[3, 1, family],
		[3, 2, subfamily],
		[3, 3, `1.000;TEST;${ps}-${subfamily}`],
		[3, 4, `${family} ${subfamily}`],
		[3, 5, 'Version 1.000'],
		[3, 6, `${ps}-${subfamily}`],
		[3, 7, `${family.split(' ')[0]} is a trademark of the Test Authors.`],
		[3, 9, 'Klee Designer'],
		[3, 13, LICENSE_DESC],
		[3, 14, 'https://openfontlicense.org'],
		[1, 1, family]
	]);
	return buildSfnt({ version: 0x00010000, tables: new Map(Object.entries({ head, hhea, maxp, 'OS/2': os2, hmtx, cmap, loca, glyf, post, name })) });
}

const TEST_POINTS = [
	...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => 0x20 + i),
	0x3001, 0x3002, 0x4e00, 0x4e01, 0x4e02, 0x4e03, 0x4e04, 0x4e59, 0x4e8c, 0x5341, 0x5382, 0x9f98, 0x9f99, 0x20000
];
const TEST_TABLE = {
	version: 1,
	chunkRanked: 3,
	chunkRest: 4,
	base: { Hans: [[0x20, 0x7e], [0x3000, 0x303f], [0xff00, 0xffef]] },
	ranked: { Hans: '一乙二十丁厂七' }
};
const OFL = Buffer.from(`${COPYRIGHT}\n\n${LICENSE_DESC}\n\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n(test stand-in)\n`);

function testSource(font, over = {}) {
	return {
		face: 'kai',
		script: 'Hans',
		original: 'Noto Test Sans',
		upstream: 'https://example.invalid/test-font',
		authors: 'The Test Authors',
		ref: 'test',
		fonts: [{ url: 'https://example.invalid/test.ttf', file: 'test.ttf', sha256: sha256(font), bytes: font.length }],
		license: { url: 'https://example.invalid/OFL.txt', sha256: sha256(OFL) },
		...over
	};
}

const names = (ttf) => new Map(readNames(parseSfnt(ttf).tables.get('name')).map((r) => [r.nameID, r.value]));

// --- the pure parts ------------------------------------------------------------------

test('the synthetic font reads back: cmap, names, weight, checksums', () => {
	const font = makeFont({ points: TEST_POINTS, weight: 600 });
	const parsed = parseSfnt(font);
	assert.deepEqual(readCmap(parsed.tables.get('cmap')), TEST_POINTS);
	assert.equal(names(font).get(1), 'Noto Test Sans');
	assert.equal(weightOf(parsed.tables), '600');
	let sum = 0;
	for (let i = 0; i < font.length; i += 4) sum = (sum + font.readUInt32BE(i)) >>> 0;
	assert.equal(sum, 0xb1b0afba, 'whole-font checksum');
});

test('planSlices: slice 0, ranked chunks, the rest ascending; every code point once', () => {
	const slices = planSlices(TEST_POINTS, 'Hans', TEST_TABLE);
	assert.deepEqual(slices[0].length, 95 + 2);
	assert.deepEqual(slices[1], [0x4e00, 0x4e59, 0x4e8c]);
	assert.deepEqual(slices[2], [0x4e01, 0x5341, 0x5382]); // 十 丁 厂, sorted within the slice
	assert.deepEqual(slices[3], [0x4e03]);
	assert.deepEqual(slices[4], [0x4e02, 0x4e04, 0x9f98, 0x9f99]);
	assert.deepEqual(slices[5], [0x20000]);
	const all = slices.flat().sort((a, b) => a - b);
	assert.deepEqual(all, TEST_POINTS);
	assert.equal(unicodeRange(slices[0]), 'U+20-7E,U+3001-3002');
	assert.equal(unicodeRange([0x41, 0x43, 0x44, 0x20000]), 'U+41,U+43-44,U+20000');
});

test('renameFont: qinqin family, copyright and licence kept, no reserved or original name left', () => {
	const renamed = renameFont(makeFont({ points: TEST_POINTS }), 'qinqin Kai SC');
	const n = names(renamed);
	assert.equal(n.get(0), COPYRIGHT);
	assert.equal(n.get(1), 'qinqin Kai SC');
	assert.equal(n.get(2), 'Regular');
	assert.equal(n.get(4), 'qinqin Kai SC');
	assert.equal(n.get(6), 'qinqinKaiSC-Regular');
	assert.match(n.get(3), /qinqin;qinqinKaiSC-Regular$/);
	assert.equal(n.get(13), LICENSE_DESC);
	assert.equal(n.has(7), false, 'trademark dropped');
	assert.equal(n.has(9), false, 'designer dropped');
	const recs = readNames(parseSfnt(renamed).tables.get('name'));
	assert.ok(recs.every((r) => r.platformID === 3), 'Macintosh records dropped');
	for (const r of recs) {
		if ([0, 13, 14].includes(r.nameID)) continue;
		for (const w of FORBIDDEN_NAMES) assert.ok(!r.value.includes(w), `name ${r.nameID} "${r.value}" contains ${w}`);
	}
	assert.deepEqual(readCmap(parseSfnt(renamed).tables.get('cmap')), TEST_POINTS, 'only the name table changes');
});

test('renameFont refuses a kept name that still carries a reserved name', () => {
	assert.throws(() => renameFont(makeFont({ points: [0x41], subfamily: 'Klee Bold' }), 'qinqin Kai JP'), /name ID 2 .*Klee/);
});

test('the faces.json rules pass the contract fixtures (docs/contracts/fonts)', () => {
	const dir = join(root, 'docs/contracts/fonts');
	const body = (c) => (c.faces && typeof c.faces === 'object' && '$raw' in c.faces ? c.faces.$raw : JSON.stringify(c.faces));
	for (const c of JSON.parse(readFileSync(join(dir, 'faces-valid.json'), 'utf8')).cases) {
		assert.doesNotThrow(() => parseFaces(body(c)), c.name);
	}
	for (const c of JSON.parse(readFileSync(join(dir, 'faces-invalid.json'), 'utf8')).cases) {
		assert.throws(
			() => parseFaces(body(c)),
			(err) => err instanceof FacesError && err.code === c.code && err.path === c.path,
			`${c.name}: want ${c.code} at ${c.path}`
		);
	}
});

test('SOURCES: every face pinned to a commit or release, with hashes, in the enums, renamed without reserved names', () => {
	for (const [id, s] of Object.entries(SOURCES)) {
		assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
		assert.ok(['sans', 'serif', 'kai'].includes(s.face) && ['Hans', 'Hant', 'Jpan'].includes(s.script), id);
		for (const f of [...s.fonts, s.license]) {
			assert.match(f.sha256, /^[0-9a-f]{64}$/, id);
			assert.match(f.url, /^https:\/\/(raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([0-9a-f]{40}|v[0-9.]+)\/|github\.com\/[^/]+\/[^/]+\/releases\/download\/v[0-9.]+\/)/, `${id}: ${f.url} is not pinned`);
		}
		for (const w of FORBIDDEN_NAMES) assert.ok(!familyName(s.face, s.script).includes(w));
	}
	assert.equal(familyName('kai', 'Hans'), 'qinqin Kai SC');
	assert.equal(familyName('sans', 'Jpan'), 'qinqin Sans JP');
});

test('the committed slice table is well formed', async (t) => {
	const table = JSON.parse(readFileSync(SLICES_FILE, 'utf8'));
	assert.equal(table.chunkRanked, 200);
	assert.equal(table.chunkRest, 500);
	for (const script of ['Hans', 'Hant', 'Jpan']) {
		const chars = [...table.ranked[script]];
		assert.equal(new Set(chars).size, chars.length, `${script}: a character twice`);
		assert.ok(chars.length > 2000, script);
		assert.ok(table.base[script].every(([lo, hi]) => lo <= hi));
	}
	assert.equal([...table.ranked.Hans].length, 6500);
	assert.ok([...table.ranked.Jpan].length >= 2136);
	if (!existsSync(join(root, 'apps/web/node_modules/opencc-js'))) {
		t.skip('run `npm --prefix apps/web ci` to compare with a fresh --slices');
		return;
	}
	assert.equal(readFileSync(SLICES_FILE, 'utf8'), formatSliceTable(await generateSliceTable()), 'stale: run --slices');
});

test('buildPack refuses fonts and licences that differ from the pins', async () => {
	const font = makeFont({ points: TEST_POINTS });
	const out = mkdtempSync(join(tmpdir(), 'font-pack-'));
	try {
		const source = testSource(font);
		await assert.rejects(
			buildPack({ id: 'x', source, fonts: [Buffer.concat([font, Buffer.alloc(4)])], license: OFL, table: TEST_TABLE, tools, out }),
			/does not match the pinned/
		);
		await assert.rejects(
			buildPack({ id: 'x', source, fonts: [font], license: Buffer.concat([OFL, Buffer.from('x')]), table: TEST_TABLE, tools, out }),
			/OFL\.txt: sha256 .* does not match the pinned/
		);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

test('the CLI refuses a face or script that does not match the source', () => {
	const r = spawnSync(process.execPath, [script, '--source', 'klee-one', '--out', tmpdir(), '--face', 'sans'], { encoding: 'utf8' });
	assert.equal(r.status, 2);
	assert.match(r.stderr, /klee-one is kai/);
	const u = spawnSync(process.execPath, [script, '--source', 'nope', '--out', tmpdir()], { encoding: 'utf8' });
	assert.equal(u.status, 2);
});

// --- building a pack ---------------------------------------------------------------

test('buildPack: a valid, renamed pack whose slices cover the font exactly', needTools, async () => {
	const regular = makeFont({ points: TEST_POINTS, weight: 400 });
	const semibold = makeFont({ points: TEST_POINTS, weight: 600, subfamily: 'SemiBold' });
	const source = testSource(regular, {
		fonts: [regular, semibold].map((f, i) => ({ url: `https://example.invalid/${i}.ttf`, file: `${i}.ttf`, sha256: sha256(f), bytes: f.length }))
	});
	const out = mkdtempSync(join(tmpdir(), 'font-pack-'));
	try {
		const res = await buildPack({ id: 'test-kai', source, fonts: [regular, semibold], license: OFL, table: TEST_TABLE, tools, out });
		assert.deepEqual(checkPackDir(out).manifest, res.manifest);
		const m = res.manifest;
		assert.equal(m.type, 'font');
		assert.equal(m.format, 'font-slices');
		assert.equal(m.license, 'OFL-1.1');
		assert.equal(m.version, '1.000-q1');
		assert.match(m.attribution, /Noto Test Sans by The Test Authors/);
		assert.match(m.notice, /modified version/);
		assert.ok(!('language' in m));
		assert.deepEqual(readFileSync(join(out, 'LICENSE')), OFL, 'LICENSE is the OFL.txt byte for byte');
		assert.match(readFileSync(join(out, 'ATTRIBUTION.md'), 'utf8'), /modified version of \*\*Noto Test Sans\*\*/);

		const faces = parseFaces(readFileSync(join(out, 'faces.json'), 'utf8'));
		assert.deepEqual(faces.map((f) => [f.face, f.script, f.weight, f.original]), [
			['kai', 'Hans', '400', 'Noto Test Sans'],
			['kai', 'Hans', '600', 'Noto Test Sans']
		]);
		assert.equal(faces[0].slices.length, 6);
		const files = readdirSync(join(out, 'slices'));
		assert.equal(files.length, 12);
		for (const f of faces) {
			const covered = [];
			for (const s of f.slices) {
				const woff2 = readFileSync(join(out, s.file));
				const ttf = Buffer.from(await tools.fontverter.convert(woff2, 'truetype'));
				const n = names(ttf);
				assert.equal(n.get(0), COPYRIGHT, 'ID 0 is the original copyright');
				assert.equal(n.get(1), 'qinqin Kai SC');
				for (const [id, value] of n) {
					if ([0, 13, 14].includes(id)) continue;
					for (const w of FORBIDDEN_NAMES) assert.ok(!value.includes(w), `${s.file}: name ${id} "${value}" contains ${w}`);
				}
				const points = readCmap(parseSfnt(ttf).tables.get('cmap'));
				assert.equal(unicodeRange(points), s.unicodeRange, `${s.file} maps exactly its range`);
				covered.push(...points);
			}
			assert.deepEqual(covered.sort((a, b) => a - b), TEST_POINTS, 'the slices cover the font, each code point once');
		}
		// Deterministic: a second build writes the same files.
		const again = mkdtempSync(join(tmpdir(), 'font-pack-'));
		try {
			await buildPack({ id: 'test-kai', source, fonts: [regular, semibold], license: OFL, table: TEST_TABLE, tools, out: again });
			assert.deepEqual(readdirSync(join(again, 'slices')).sort(), files.sort());
		} finally {
			rmSync(again, { recursive: true, force: true });
		}
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

