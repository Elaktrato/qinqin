// Tests of the Kanji alive audio pack generator:
//   node --test scripts/prepare-audio-kanjialive.test.mjs
// The CSV is a hand-written imitation in the real column layout and the
// clips are generated Ogg-magic stubs; no Kanji alive data is committed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPack, exampleRows } from './prepare-audio-kanjialive.mjs';

const script = fileURLToPath(new URL('./prepare-audio-kanjialive.mjs', import.meta.url));

const HEADER =
	'kanji,kname,kstroke,kmeaning,kgrade,kunyomi_ja,kunyomi,onyomi_ja,onyomi,examples,radical,rad_order,rad_stroke,rad_name_ja,rad_name,rad_meaning,rad_position_ja,rad_position';
const q = (v) => `"${v.replaceAll('"', '""')}"`;
const row = (kanji, kname, examples) =>
	[kanji, kname, '3', q('a, "b"'), '1', 'x', 'x', 'y', 'y', q(JSON.stringify(examples)), 'r', '1', '1', 'n', 'n', 'm', '', ''].join(',');
const CSV =
	HEADER + '\n' +
	row('述', 'jutsu-no(beru)', [['述語（じゅつご）', 'predicate'], ['記述する（きじゅつする）', 'to describe'], ['従（三位）（じゅさんみ）', 'odd']]) + '\n' +
	row('一', 'ichi', [['一年生（いちねんせい）', 'first-year student'], ['一人（ひとり）', 'one person']]) + '\n';

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), 'ka-'));
	const audio = join(dir, 'audio-opus');
	mkdirSync(audio);
	for (const f of ['jutsu-no(beru)_06_a.opus', 'jutsu-no(beru)_06_b.opus', 'ichi_06_a.opus', 'ichi_06_b.opus']) {
		writeFileSync(join(audio, f), Buffer.concat([Buffer.from('OggS'), Buffer.from(f)]));
	}
	writeFileSync(join(dir, 'LICENSE.txt'), 'legal code text\n');
	return { dir, audio, csv: join(dir, 'ka_data.csv'), license: join(dir, 'LICENSE.txt') };
}

test('exampleRows maps the n-th example to suffix a..l', () => {
	const rows = exampleRows(CSV);
	assert.deepEqual(rows.slice(0, 3), [
		{ kname: 'jutsu-no(beru)', form: '述語', reading: 'じゅつご', suffix: 'a' },
		{ kname: 'jutsu-no(beru)', form: '記述する', reading: 'きじゅつする', suffix: 'b' },
		{ kname: 'jutsu-no(beru)', form: '従（三位）', reading: 'じゅさんみ', suffix: 'c' },
	]);
	assert.equal(rows.length, 5);
	assert.deepEqual(rows[3], { kname: 'ichi', form: '一年生', reading: 'いちねんせい', suffix: 'a' });
});

test('exampleRows rejects more than twelve examples and malformed words', () => {
	const many = Array.from({ length: 13 }, (_, i) => [`語${i}（ご${i}）`, 'x']);
	assert.throws(() => exampleRows(HEADER + '\n' + row('語', 'go', many)), /12/);
	assert.throws(() => exampleRows(HEADER + '\n' + row('語', 'go', [['語', 'x']])), /語/);
});

test('buildPack writes the manifest, index, clips and attribution; missing clips are skipped', () => {
	const f = fixture();
	const out = join(f.dir, 'out', 'kanjialive-audio');
	const res = buildPack({ csvText: CSV, audioDir: f.audio, out, licenseText: 'legal code text\n', version: '2026-09-04' });
	assert.deepEqual({ rows: res.rows, skipped: res.skipped }, { rows: 4, skipped: 1 });
	const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
	assert.equal(manifest.id, 'kanjialive-audio');
	assert.equal(manifest.type, 'audio');
	assert.equal(manifest.format, 'audio-index');
	assert.equal(manifest.language, 'ja');
	assert.equal(manifest.license, 'CC BY 4.0');
	assert.equal(manifest.attribution, 'Kanji alive (https://kanjialive.com), CC BY 4.0');
	assert.equal(manifest.version, '2026-09-04');
	const lines = readFileSync(join(out, 'index.tsv'), 'utf8').trimEnd().split('\n');
	assert.equal(lines[0], 'kind\tform\treading\tfile\tlicense\tattribution\tsource');
	assert.equal(lines[1], 'term\t述語\tじゅつご\taudio/jutsu-no(beru)_06_a.opus\t\t\t');
	assert.equal(lines.length, 5);
	assert.deepEqual(readdirSync(join(out, 'audio')).sort(), ['ichi_06_a.opus', 'ichi_06_b.opus', 'jutsu-no(beru)_06_a.opus', 'jutsu-no(beru)_06_b.opus']);
	assert.equal(readFileSync(join(out, 'LICENSE'), 'utf8'), 'legal code text\n');
	assert.match(readFileSync(join(out, 'ATTRIBUTION.md'), 'utf8'), /Kanji alive/);
	rmSync(f.dir, { recursive: true });
});

test('buildPack is deterministic', () => {
	const f = fixture();
	const a = join(f.dir, 'a');
	const b = join(f.dir, 'b');
	for (const out of [a, b]) buildPack({ csvText: CSV, audioDir: f.audio, out, licenseText: 'L\n', version: '1' });
	for (const name of ['manifest.json', 'index.tsv', 'ATTRIBUTION.md', 'LICENSE']) {
		assert.equal(readFileSync(join(a, name), 'utf8'), readFileSync(join(b, name), 'utf8'), name);
	}
	rmSync(f.dir, { recursive: true });
});

test('the CLI copies --license-file to LICENSE and fails without it', () => {
	const f = fixture();
	writeFileSync(f.csv, CSV);
	const out = join(f.dir, 'cli-out');
	const ok = spawnSync('node', [script, f.csv, f.dir, out, '--license-file', f.license], { encoding: 'utf8' });
	assert.equal(ok.status, 0, ok.stderr);
	assert.equal(readFileSync(join(out, 'LICENSE'), 'utf8'), 'legal code text\n');
	assert.match(ok.stdout, /4 clips/);
	assert.match(ok.stdout, /1 .*skipped/);
	const none = spawnSync('node', [script, f.csv, f.dir, join(f.dir, 'no-out')], { encoding: 'utf8' });
	assert.notEqual(none.status, 0);
	assert.match(none.stderr, /license-file/);
	assert.equal(existsSync(join(f.dir, 'no-out')), false);
	rmSync(f.dir, { recursive: true });
});

test('the CLI refuses to write into the committed plugins/data tree', () => {
	const f = fixture();
	writeFileSync(f.csv, CSV);
	const bad = spawnSync('node', [script, f.csv, f.dir, join(fileURLToPath(new URL('../plugins/data', import.meta.url)), 'kanjialive-audio'), '--license-file', f.license], { encoding: 'utf8' });
	assert.notEqual(bad.status, 0);
	assert.match(bad.stderr, /plugins\/data/);
	rmSync(f.dir, { recursive: true });
});
