// Tests of the sources consistency check, on synthetic repositories:
//   node --test scripts/check-sources.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FETCHED_PACKS, LOCAL_ONLY_PACKS, checkSources, docPackIds, noticeProblems } from './check-sources.mjs';

const script = fileURLToPath(new URL('./check-sources.mjs', import.meta.url));
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const GOOD = { license: 'MIT', attribution: 'someone' };
const DOC = [
	'# Sources',
	'| Pack | Provides |',
	'|---|---|',
	'| **A** (`pack-a`) | x |',
	'Optional: **J** (`jlpt-words`).',
	'- **B** (`pack-b`, unit `word`): list item',
	''
].join('\n');

/** repo builds a temp repository: packs maps "plugins/data/x" to a manifest (or null for none). */
function repo(packs, doc = DOC) {
	const root = mkdtempSync(join(tmpdir(), 'check-sources-'));
	dirs.push(root);
	for (const [rel, manifest] of Object.entries(packs)) {
		mkdirSync(join(root, rel), { recursive: true });
		if (manifest) writeFileSync(join(root, rel, 'manifest.json'), JSON.stringify(manifest));
	}
	mkdirSync(join(root, 'docs'), { recursive: true });
	if (doc !== null) writeFileSync(join(root, 'docs/sources.md'), doc);
	return root;
}

const okPacks = () => ({
	'plugins/data/pack-a': { id: 'pack-a', ...GOOD },
	'plugins/data/pack-b': { id: 'pack-b', ...GOOD, notice: 'Fine. [Site](https://example.org/x)' },
	'plugins/samples/mini': { id: 'mini', ...GOOD }
});

test('a consistent repository passes', () => {
	assert.deepEqual(checkSources(repo(okPacks())), []);
});

test('a pack without manifest, or with empty license/attribution, is reported', () => {
	const p = okPacks();
	p['plugins/samples/none'] = null;
	p['plugins/samples/mini'] = { id: 'mini', license: ' ', attribution: '' };
	const out = checkSources(repo(p)).join('\n');
	assert.match(out, /plugins\/samples\/none: no manifest\.json/);
	assert.match(out, /plugins\/samples\/mini\/manifest\.json: "license" is missing or empty/);
	assert.match(out, /plugins\/samples\/mini\/manifest\.json: "attribution" is missing or empty/);
});

test('a bundled pack missing from the docs is reported; a sample need not be', () => {
	const p = okPacks();
	p['plugins/data/pack-c'] = { id: 'pack-c', ...GOOD };
	const out = checkSources(repo(p)).join('\n');
	assert.match(out, /bundled pack "pack-c"/);
	assert.doesNotMatch(out, /"mini"/);
});

test('a doc id that matches no pack is reported unless allow-listed', () => {
	const doc = DOC + '| Pack | Provides |\n|---|---|\n| **Gone** (`ghost-pack`) | x |\n- **L** (`hsk30-words`, local)\n';
	const out = checkSources(repo(okPacks(), doc));
	assert.equal(out.length, 1);
	assert.match(out[0], /names pack "ghost-pack"/);
});

test('fetched and local-only audio packs the docs name are accepted', () => {
	assert.ok(FETCHED_PACKS.includes('kanjialive-audio'));
	assert.ok(LOCAL_ONLY_PACKS.includes('commons-audio-zh') && LOCAL_ONLY_PACKS.includes('commons-audio-ja'));
	const doc = DOC + '| Pack | Provides |\n|---|---|\n| **K** (`kanjialive-audio`) | x |\n- **C** (`commons-audio-zh`, local)\n- **D** (`commons-audio-ja`, local)\n';
	assert.deepEqual(checkSources(repo(okPacks(), doc)), []);
});

test('the fetched strokes pack the docs name is accepted', () => {
	assert.ok(FETCHED_PACKS.includes('hanzi-writer-strokes'));
	const doc = DOC + '- **Hanzi Writer stroke data** (`hanzi-writer-strokes`, fetched at build time)\n';
	assert.deepEqual(checkSources(repo(okPacks(), doc)), []);
});

test('ids outside table rows and list items are not pack names', () => {
	assert.deepEqual(
		[...docPackIds('See `some-flag` and `freq-csv`.\n| Pack | x |\n|---|---|\n| **A** (`pack-a`) | `other-thing` |\n')],
		['pack-a']
	);
});

test('notice rules', () => {
	assert.deepEqual(noticeProblems('Plain.\n\nSecond [a](https://example.org/p?q=1) paragraph.'), []);
	assert.match(noticeProblems('x'.repeat(4001))[0], /4001 bytes/);
	assert.deepEqual(noticeProblems('語'.repeat(1333)), []); // 3,999 bytes
	assert.match(noticeProblems('語'.repeat(1334))[0], /4002 bytes/);
	assert.match(noticeProblems('[a](http://example.org)')[0], /only https/);
	assert.match(noticeProblems('[a](javascript:alert(1))').join(), /malformed link|only https/);
	assert.match(noticeProblems('[](https://example.org)')[0], /malformed link/);
	assert.match(noticeProblems('[a](https://user@example.org/)')[0], /user information/);
	assert.match(noticeProblems('[a](https:///path)')[0], /no host|invalid/);
	assert.match(noticeProblems('a\rb')[0], /control character U\+000D/);
});

// The vectors are shared with server/internal/dict/notice_vectors_test.go:
// the server validator and this mirror must agree on each.
test('noticeProblems agrees with the server on the shared vectors', () => {
	const vectors = JSON.parse(readFileSync(new URL('./testdata/notice-vectors.json', import.meta.url), 'utf8'));
	assert.ok(vectors.length > 30);
	for (const v of vectors) {
		const problems = noticeProblems(v.notice);
		assert.equal(problems.length === 0, v.ok, `${v.name}: ${problems.join('; ') || 'no problems'}`);
	}
});

test('the mirror explains percent escapes, ports, user information and bidi controls', () => {
	assert.match(noticeProblems('[a](https://a.com/%zz)')[0], /invalid URL escape "%zz"/);
	assert.match(noticeProblems('[a](https://a.com:99999/)')[0], /port 99999 is out of range/);
	assert.match(noticeProblems('[a](https://@a.com/)')[0], /user information/);
	assert.match(noticeProblems('a\u202eb')[0], /bidirectional control character U\+202E/);
});

test('a manifest notice with a replacement character (broken encoding) is reported', () => {
	const p = okPacks();
	p['plugins/data/pack-b'].notice = 'Broken \ufffd text.';
	assert.match(checkSources(repo(p)).join(), /U\+FFFD/);
});

test('a field table naming `notice` in its first cell is not a pack table', () => {
	const doc = DOC + '\n| Field | Meaning |\n|---|---|\n| `notice` | caveats |\n| `ghost-field` | x |\n';
	assert.deepEqual(checkSources(repo(okPacks(), doc)), []);
	assert.deepEqual([...docPackIds(doc)].sort(), ['pack-a', 'pack-b']);
});

test('a bad notice in a manifest is reported with its file', () => {
	const p = okPacks();
	p['plugins/data/pack-b'].notice = '[x](http://example.org)';
	const out = checkSources(repo(p));
	assert.equal(out.length, 1);
	assert.match(out[0], /^plugins\/data\/pack-b\/manifest\.json: notice link/);
});

test('the CLI exits 1 with messages on failure and 0 on success', () => {
	const bad = spawnSync(process.execPath, [script, repo({ 'plugins/data/x': { id: 'x' } })], { encoding: 'utf8' });
	assert.equal(bad.status, 1);
	assert.match(bad.stderr, /"license" is missing or empty/);
	const good = spawnSync(process.execPath, [script, repo(okPacks())], { encoding: 'utf8' });
	assert.equal(good.status, 0, good.stderr);
});

test('missing docs/sources.md is one clear error', () => {
	assert.deepEqual(checkSources(repo(okPacks(), null)), ['docs/sources.md: file is missing']);
});

test('the local-only zh components pack the docs name is accepted', () => {
	assert.ok(LOCAL_ONLY_PACKS.includes('zh-components'));
	const doc = DOC + '- **Chinese components** (`zh-components`, local)\n';
	assert.deepEqual(checkSources(repo(okPacks(), doc)), []);
});
