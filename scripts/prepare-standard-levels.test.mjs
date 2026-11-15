// Tests of the standard level generator (joyo-grades, tgh-chars):
//   node --test scripts/prepare-standard-levels.test.mjs
// Fixtures are hand-written; nothing here is copied from a restricted list.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, gzipSync } from 'node:zlib';
import { GENERATED_MARKER, PackError, writePack } from './prepare-level-packs.mjs';
import { JOYO_NOTICE, TGH_NOTICE, joyoLevels, parseJoyoSet, parseTgh, tghLevels } from './prepare-standard-levels.mjs';

const script = fileURLToPath(new URL('./prepare-standard-levels.mjs', import.meta.url));
const repoPacks = fileURLToPath(new URL('../plugins/data', import.meta.url));

// assertValidNotice mirrors the server's manifest notice rules
// (dict.ValidateNotice).
function assertValidNotice(notice) {
	assert.equal(typeof notice, 'string');
	assert.ok(notice.length > 0, 'notice is empty');
	assert.ok(Buffer.byteLength(notice, 'utf8') <= 4000, 'notice is over 4,000 bytes');
	assert.equal(notice, notice.trim());
	assert.doesNotMatch(notice, /[\u0000-\u0008\u000b-\u001f\u007f]/);
	assert.doesNotMatch(notice, /\n{3,}/);
	const link = /\[([^[\]\n]+)\]\(([^()\s]*)\)/g;
	for (const [, , url] of notice.matchAll(link)) assert.match(url, /^https:\/\/[^/?#\s]+/);
	assert.doesNotMatch(notice.replace(link, ''), /\]\(/, 'malformed link');
}

/** storedZip builds a zip with stored (uncompressed) members. */
function storedZip(members) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const [name, text] of Object.entries(members)) {
		const nameBuf = Buffer.from(name);
		const data = Buffer.from(text);
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, nameBuf, data);
		centrals.push(central, nameBuf);
		offset += local.length + nameBuf.length + data.length;
	}
	const centralBuf = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(members).length, 8);
	end.writeUInt16LE(Object.keys(members).length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, centralBuf, end]);
}

const FIXTURE_KANJI = new Map([
	['一', { grade: 1, freq: 2, old: 4 }],
	['二', { grade: 1, freq: null, old: 4 }],
	['誰', { grade: 8, freq: null, old: null }],
	['伊', { grade: 9, freq: null, old: null }],
	['岡', { grade: 4, freq: 900, old: null }]
]);

test('joyoLevels orders by grade, frequency (none last), code point; omits empty levels and jinmeiyō', () => {
	assert.deepEqual(joyoLevels(FIXTURE_KANJI), [
		{ name: 'Grade 1', entries: ['一', '二'] },
		{ name: 'Grade 4', entries: ['岡'] },
		{ name: 'Secondary', entries: ['誰'] }
	]);
});

const TGH = '#\tkTGH\nU+4E00\tkTGH\t2013:1\nU+4E42\tkTGH\t2013:3501\nU+77D7\tkTGH\t2013:3500\nU+3447\tkTGH\t2013:6602\n';

test('parseTgh ignores the header comment and tghLevels splits at 3,500 and 6,500', () => {
	const serials = parseTgh(TGH);
	assert.equal(serials.size, 4);
	assert.equal(serials.get('一'), 1);
	assert.deepEqual(tghLevels(serials), [
		{ name: 'Level 1', entries: ['一', '矗'] },
		{ name: 'Level 2', entries: ['乂'] },
		{ name: 'Level 3', entries: ['㑇'] }
	]);
});

test('parseTgh rejects a leading zero, a duplicate serial and a duplicate character', () => {
	assert.throws(() => parseTgh('U+4E00\tkTGH\t2013:01\n'), PackError);
	assert.throws(() => parseTgh('U+4E00\tkTGH\t2013:0\n'), PackError);
	assert.throws(() => parseTgh('U+4E00\tkTGH\t2013:1\nU+4E42\tkTGH\t2013:1\n'), PackError);
	assert.throws(() => parseTgh('U+4E00\tkTGH\t2013:1\nU+4E00\tkTGH\t2013:2\n'), PackError);
	assert.throws(() => parseTgh('U+4E00\tkTGH\t2012:1\n'), PackError);
	assert.throws(() => parseTgh('#\tkTGH\n'), PackError);
});

test('parseJoyoSet keeps the 2010 rows and skips the U+ variant rows', () => {
	const text = '#\tkJoyoKanji\nU+4E00\tkJoyoKanji\t2010\nU+5265\tkJoyoKanji\tU+525D\nU+4E8C\tkJoyoKanji\t2010\nU+4E09\tkTGH\t2013:3\n';
	assert.deepEqual([...parseJoyoSet(text)].sort(), ['一', '二']);
	assert.throws(() => parseJoyoSet('U+4E00\tkJoyoKanji\t1981\n'), PackError);
});

test('notices are valid', () => {
	assertValidNotice(JOYO_NOTICE);
	assertValidNotice(TGH_NOTICE);
	assert.match(TGH_NOTICE, /国发〔2013〕23号/);
});

test('writePack without a licence writes no LICENSE', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'qq-wp-'));
	try {
		await writePack(join(dir, 'p'), {
			manifest: { id: 'p' },
			unit: 'word',
			levels: [{ name: 'A', entries: ['x'] }],
			license: undefined,
			attribution: 'a'
		});
		assert.equal(existsSync(join(dir, 'p', 'LICENSE')), false);
		assert.equal(existsSync(join(dir, 'p', 'levels.json')), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

function kanjidicFixture() {
	const rows = [
		['一', 1, 2],
		['二', 1, undefined],
		['誰', 8, undefined],
		['伊', 9, undefined]
	];
	const body = rows
		.map(
			([literal, grade, freq]) =>
				`<character>\n<literal>${literal}</literal>\n<misc>\n<grade>${grade}</grade>\n${freq === undefined ? '' : `<freq>${freq}</freq>\n`}</misc>\n</character>`
		)
		.join('\n');
	return `<?xml version="1.0"?>\n<kanjidic2>\n<header><file_version>4</file_version><database_version>2026-315</database_version><date_of_creation>2026-11-11</date_of_creation></header>\n${body}\n</kanjidic2>\n`;
}

function fixturePacks() {
	const dir = mkdtempSync(join(tmpdir(), 'qq-std-'));
	mkdirSync(join(dir, 'kanjidic2'));
	mkdirSync(join(dir, 'unihan'));
	writeFileSync(join(dir, 'kanjidic2', 'kanjidic2.xml.gz'), gzipSync(kanjidicFixture()));
	writeFileSync(join(dir, 'kanjidic2', 'LICENSE'), 'kanjidic licence text\n');
	const other =
		'# Unihan_OtherMappings.txt\n# Date: 2026-07-31 00:00:00 GMT [KL]\n# Unicode Version 18.0.0\n#\n' +
		'U+4E00\tkJoyoKanji\t2010\nU+4E8C\tkJoyoKanji\t2010\n' +
		TGH;
	writeFileSync(join(dir, 'unihan', 'Unihan.zip'), storedZip({ 'Unihan_OtherMappings.txt': other }));
	writeFileSync(join(dir, 'unihan', 'LICENSE'), 'unicode licence text\n');
	return dir;
}

test('CLI writes both packs reproducibly', () => {
	const dir = fixturePacks();
	try {
		const run = () => spawnSync('node', [script, dir], { encoding: 'utf8' });
		const first = run();
		assert.equal(first.status, 0, first.stderr);
		const names = ['manifest.json', 'levels.json', 'LICENSE', 'ATTRIBUTION.md'];
		const snapshot = () =>
			Object.fromEntries(['joyo-grades', 'tgh-chars'].flatMap((id) => names.map((n) => [`${id}/${n}`, readFileSync(join(dir, id, n))])));
		const a = snapshot();
		const second = run();
		assert.equal(second.status, 0, second.stderr);
		const b = snapshot();
		for (const key of Object.keys(a)) assert.ok(a[key].equals(b[key]), `${key} differs between runs`);

		const joyo = JSON.parse(a['joyo-grades/manifest.json']);
		assert.equal(joyo.type, 'levels');
		assert.equal(joyo.language, 'ja');
		assert.equal(joyo.name, 'Jōyō kanji by school grade');
		assert.equal(joyo.license, 'CC BY-SA 4.0');
		assert.equal(joyo.version, 'kanjidic2@2026-315');
		assertValidNotice(joyo.notice);
		assert.deepEqual(JSON.parse(a['joyo-grades/levels.json']), {
			unit: 'character',
			levels: [
				{ name: 'Grade 1', entries: ['一', '二'] },
				{ name: 'Secondary', entries: ['誰'] }
			]
		});
		assert.equal(a['joyo-grades/LICENSE'].toString(), 'kanjidic licence text\n');

		const tgh = JSON.parse(a['tgh-chars/manifest.json']);
		assert.equal(tgh.type, 'levels');
		assert.equal(tgh.language, 'zh');
		assert.equal(tgh.name, '通用规范汉字表 (2013) levels');
		assert.equal(tgh.license, 'Unicode License v3');
		assert.equal(tgh.version, 'unihan@18.0.0');
		assertValidNotice(tgh.notice);
		assert.equal(JSON.parse(a['tgh-chars/levels.json']).levels.length, 3);
		assert.equal(a['tgh-chars/LICENSE'].toString(), 'unicode licence text\n');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('CLI fails naming a missing input and writes nothing', () => {
	const dir = mkdtempSync(join(tmpdir(), 'qq-std-'));
	try {
		const r = spawnSync('node', [script, dir], { encoding: 'utf8' });
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /kanjidic2/);
		assert.equal(existsSync(join(dir, 'joyo-grades')), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('real data: 2,136 jōyō kanji equal Unihan kJoyoKanji 2010; tgh 3,500 / 3,000 / 1,605', { skip: !existsSync(join(repoPacks, 'kanjidic2')) }, () => {
	const out = mkdtempSync(join(tmpdir(), 'qq-real-'));
	try {
		for (const d of ['kanjidic2', 'unihan']) {
			mkdirSync(join(out, d));
		}
		for (const [d, f] of [
			['kanjidic2', 'kanjidic2.xml.gz'],
			['kanjidic2', 'LICENSE'],
			['unihan', 'Unihan.zip'],
			['unihan', 'LICENSE']
		]) {
			writeFileSync(join(out, d, f), readFileSync(join(repoPacks, d, f)));
		}
		const r = spawnSync('node', [script, out], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
		const joyo = JSON.parse(readFileSync(join(out, 'joyo-grades', 'levels.json'), 'utf8')).levels.flatMap((l) => l.entries);
		assert.equal(joyo.length, 2136);
		assert.equal(new Set(joyo).size, 2136);
		const unzip = spawnSync('unzip', ['-p', join(repoPacks, 'unihan', 'Unihan.zip'), 'Unihan_OtherMappings.txt'], { encoding: 'utf8', maxBuffer: 1 << 28 });
		assert.deepEqual([...joyo].sort(), [...parseJoyoSet(unzip.stdout)].sort());
		const tgh = JSON.parse(readFileSync(join(out, 'tgh-chars', 'levels.json'), 'utf8')).levels;
		assert.deepEqual(
			tgh.map((l) => l.entries.length),
			[3500, 3000, 1605]
		);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

test('CLI refuses to wipe a pack directory it did not write', () => {
	const dir = fixturePacks();
	try {
		mkdirSync(join(dir, 'joyo-grades'));
		writeFileSync(join(dir, 'joyo-grades', 'precious.txt'), 'x');
		const r = spawnSync('node', [script, dir], { encoding: 'utf8' });
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /not written by/);
		assert.equal(existsSync(join(dir, 'joyo-grades', 'precious.txt')), true);
		assert.equal(existsSync(join(dir, 'tgh-chars')), false, 'nothing is written after a refusal');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the committed packs are byte-identical to a fresh generation from the bundled inputs', { skip: !existsSync(join(repoPacks, 'joyo-grades')) }, () => {
	const out = mkdtempSync(join(tmpdir(), 'qq-cmp-'));
	try {
		for (const [d, f] of [
			['kanjidic2', 'kanjidic2.xml.gz'],
			['kanjidic2', 'LICENSE'],
			['unihan', 'Unihan.zip'],
			['unihan', 'LICENSE']
		]) {
			mkdirSync(join(out, d), { recursive: true });
			writeFileSync(join(out, d, f), readFileSync(join(repoPacks, d, f)));
		}
		const r = spawnSync('node', [script, out], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
		for (const id of ['joyo-grades', 'tgh-chars']) {
			for (const name of ['manifest.json', 'levels.json', 'LICENSE', 'ATTRIBUTION.md', GENERATED_MARKER]) {
				assert.ok(
					readFileSync(join(out, id, name)).equals(readFileSync(join(repoPacks, id, name))),
					`${id}/${name} differs: run node scripts/prepare-standard-levels.mjs and commit`
				);
			}
		}
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});
