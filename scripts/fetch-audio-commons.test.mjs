// Tests of the local Commons / Lingua Libre audio tool:
//   node --test scripts/fetch-audio-commons.test.mjs
// Fixtures in scripts/testdata/commons-*.json are hand-written imitations of
// the Commons API shape (action=query, prop=imageinfo|videoinfo); nothing
// here touches the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { allowedLicence, plan, rowFromFile, stripHtml, writeIndexFiles } from './fetch-audio-commons.mjs';

const script = fileURLToPath(new URL('./fetch-audio-commons.mjs', import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(new URL(`./testdata/${name}`, import.meta.url), 'utf8'));
const pages = (name) => Object.values(fixture(name).query.pages);

test('the licence allow-list', () => {
	for (const ok of ['CC0', 'cc0', 'Public domain', 'public domain', 'CC BY 2.0', 'CC BY 3.0', 'CC BY 4.0', 'CC BY-SA 2.0', 'CC BY-SA 2.5', 'CC BY-SA 3.0', 'CC BY-SA 4.0', 'CC BY 2.0 fr', 'CC BY-SA 2.0 uk', 'cc by-sa 3.0 de']) {
		assert.equal(allowedLicence(ok), true, ok);
	}
	for (const no of ['CC BY-NC-SA 4.0', 'CC BY-NC 4.0', 'CC BY-ND 4.0', 'GFDL', 'GFDL 1.2', 'CC BY 1.0', 'CC BY 5.0', 'Copyrighted free use', 'Attribution', '', undefined, 'CC BY 4.0 and GFDL']) {
		assert.equal(allowedLicence(no), false, String(no));
	}
});

test('stripHtml drops tags, decodes entities and collapses whitespace', () => {
	assert.equal(stripHtml('<ul><li>Speaker: <a href="x">Ann &amp; Bob</a></li>\n<li>Recorder: Ann</li></ul>'), 'Speaker: Ann & Bob Recorder: Ann');
});

test('syllable files become numbered syllable rows with licence, credit and page URL', () => {
	const [nǐ, shi4, ma1, lv] = pages('commons-zh-syllables.json');
	const a = rowFromFile(nǐ, 'zh');
	assert.deepEqual(
		{ kind: a.kind, form: a.form, reading: a.reading, license: a.license, attribution: a.attribution, source: a.source },
		{ kind: 'syllable', form: '', reading: 'ni3', license: 'CC BY 2.0 fr', attribution: 'Test Speaker One, Test Speaker Two', source: 'https://commons.example.test/wiki/File:Zh-n%C7%90.ogg' }
	);
	assert.equal(a.ext, 'ogg');
	assert.equal(a.url, 'https://upload.example.test/commons/7/73/Zh-n%C7%90.ogg');
	assert.equal(rowFromFile(shi4, 'zh').reading, 'shi4');
	assert.equal(rowFromFile(shi4, 'zh').attribution, 'Someone');
	assert.equal(rowFromFile(lv, 'zh').reading, 'lv4');
	assert.equal(rowFromFile(ma1, 'zh'), null, 'a non-commercial licence is dropped');
});

test('files that are not one valid syllable are dropped', () => {
	const pg = pages('commons-zh-syllables.json');
	assert.equal(rowFromFile(pg[4], 'zh'), null); // Zh-xyzzy
	assert.equal(rowFromFile(pg[5], 'zh'), null); // GFDL
});

test('Lingua Libre titles give a term row with no reading, from the transcoded file', () => {
	const [nihao, yuan, xiexie, nc, deu] = pages('commons-lingualibre-cmn.json');
	const r = rowFromFile(nihao, 'zh');
	assert.equal(r.kind, 'term');
	assert.equal(r.form, '你好');
	assert.equal(r.reading, '');
	assert.equal(r.license, 'CC BY-SA 4.0');
	assert.equal(r.attribution, 'Speaker: Testspeaker Recorder: Testspeaker');
	assert.equal(r.ext, 'ogg');
	assert.match(r.url, /x\.wav\.ogg$/);
	assert.equal(rowFromFile(xiexie, 'zh').ext, 'mp3');
	assert.equal(rowFromFile(yuan, 'zh'), null, 'a recording of "102 块钱" does not say 块钱');
	assert.equal(rowFromFile(nc, 'zh'), null);
	assert.equal(rowFromFile(deu, 'zh'), null, 'another language is not this pack');
	assert.equal(rowFromFile(nihao, 'ja'), null, 'a cmn recording is not a Japanese one');
});

test('plan keeps allowed files only and counts what it drops by reason', () => {
	const res = plan(pages('commons-zh-syllables.json').concat(pages('commons-lingualibre-cmn.json')), 'zh');
	assert.deepEqual(res.rows.map((r) => `${r.kind}:${r.form}:${r.reading}`).sort(), ['syllable::lv4', 'syllable::ni3', 'syllable::shi4', 'term:你好:', 'term:谢谢:']);
	assert.deepEqual(res.dropped, { licence: 3, title: 3 });
	assert.deepEqual(res.licences, { 'CC BY 2.0 fr': 1, 'CC BY-SA 2.0 uk': 1, CC0: 1, 'CC BY-SA 4.0': 2 });
});

test('writeIndexFiles writes a per-file-licence manifest and an index', () => {
	const dir = mkdtempSync(join(tmpdir(), 'commons-'));
	const res = plan(pages('commons-zh-syllables.json'), 'zh');
	const names = res.rows.map((r, i) => ({ ...r, file: `audio/p${r.pageid}.${r.ext}` }));
	writeIndexFiles(join(dir, 'pack'), 'zh', names, res, '2026-11-15');
	const m = JSON.parse(readFileSync(join(dir, 'pack', 'manifest.json'), 'utf8'));
	assert.deepEqual({ id: m.id, type: m.type, format: m.format, language: m.language, license: m.license }, { id: 'commons-audio-zh', type: 'audio', format: 'audio-index', language: 'zh', license: 'per file' });
	const lines = readFileSync(join(dir, 'pack', 'index.tsv'), 'utf8').trimEnd().split('\n');
	assert.equal(lines[0], 'kind\tform\treading\tfile\tlicense\tattribution\tsource');
	assert.equal(lines.length, 4);
	assert.match(lines[1], /^syllable\t\tni3\taudio\/p1001\.ogg\tCC BY 2\.0 fr\tTest Speaker One, Test Speaker Two\thttps:\/\/commons\.example\.test/);
	assert.match(readFileSync(join(dir, 'pack', 'ATTRIBUTION.md'), 'utf8'), /CC BY 2\.0 fr: 1/);
	rmSync(dir, { recursive: true });
});

test('the CLI refuses an output directory outside plugins/data-local and a bad language', () => {
	const bad = spawnSync('node', [script, '--lang', 'zh', '--category', 'X', join(tmpdir(), 'out')], { encoding: 'utf8' });
	assert.notEqual(bad.status, 0);
	assert.match(bad.stderr, /data-local/);
	const lang = spawnSync('node', [script, '--lang', 'fr', '--category', 'X'], { encoding: 'utf8' });
	assert.notEqual(lang.status, 0);
	assert.match(lang.stderr, /--lang/);
	assert.equal(existsSync(join(tmpdir(), 'out', 'manifest.json')), false);
});
