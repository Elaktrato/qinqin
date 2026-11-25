// Tests of the sources consistency check, on synthetic repositories:
//   node --test scripts/check-sources.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FETCHED_PACKS, GENERATED_PACKS, LOCAL_ONLY_PACKS, checkSources, docPackIds, noticeProblems } from './check-sources.mjs';

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

test('generated sentence packs may be named while absent, and are checked once present', () => {
	assert.deepEqual([...GENERATED_PACKS].sort(), ['ja-sentences-tatoeba', 'zh-sentences-tatoeba']);
	const doc = DOC + '| Pack | Provides |\n|---|---|\n| **T** (`zh-sentences-tatoeba`) | x |\n| **U** (`ja-sentences-tatoeba`) | x |\n';
	// Before server/tools/tatoeba ran: the docs describe them, nothing is wrong.
	assert.deepEqual(checkSources(repo(okPacks(), doc)), []);
	// Generated (and pinned): they are bundled packs like any other.
	const p = okPacks();
	p['plugins/data/zh-sentences-tatoeba'] = { id: 'zh-sentences-tatoeba', version: '2000-01-02', ...GOOD, notice: 'From [Tatoeba](https://tatoeba.org).' };
	p['plugins/data/ja-sentences-tatoeba'] = { id: 'ja-sentences-tatoeba', version: '2000-01-02', license: '', attribution: 'x' };
	const pinned = (root) => {
		mkdirSync(join(root, 'server/tools/tatoeba'), { recursive: true });
		writeFileSync(join(root, 'server/tools/tatoeba/pin.json'), JSON.stringify({ exportDate: '2000-01-02', archives: [{ sha256: 'cd'.repeat(32) }] }));
		return root;
	};
	const out = checkSources(pinned(repo(p, doc))).join('\n');
	assert.match(out, /ja-sentences-tatoeba\/manifest\.json: "license" is missing or empty/);
	assert.doesNotMatch(out, /zh-sentences-tatoeba/);
	// Present but not in the docs: reported.
	assert.match(checkSources(pinned(repo(p))).join('\n'), /bundled pack "zh-sentences-tatoeba"/);
});

test('generated packs follow server/tools/tatoeba/pin.json', () => {
	const doc = DOC + '| Pack | Provides |\n|---|---|\n| **T** (`zh-sentences-tatoeba`) | x |\n| **U** (`ja-sentences-tatoeba`) | x |\n';
	const pin = (pinned, date = '2000-01-02') => ({
		exportDate: pinned ? date : '',
		archives: [{ name: 'a', sha256: pinned ? 'ab'.repeat(32) : '' }]
	});
	const withPin = (packs, p) => {
		const root = repo(packs, doc);
		mkdirSync(join(root, 'server/tools/tatoeba'), { recursive: true });
		writeFileSync(join(root, 'server/tools/tatoeba/pin.json'), JSON.stringify(p));
		return root;
	};
	const gen = (version) => ({
		...okPacks(),
		'plugins/data/zh-sentences-tatoeba': { id: 'zh-sentences-tatoeba', version, ...GOOD },
		'plugins/data/ja-sentences-tatoeba': { id: 'ja-sentences-tatoeba', version, ...GOOD }
	});
	// Not pinned: absence is fine; packs without a pin are not.
	assert.deepEqual(checkSources(withPin(okPacks(), pin(false))), []);
	assert.match(checkSources(withPin(gen('2000-01-02'), pin(false))).join('\n'), /zh-sentences-tatoeba.*pin\.json is not pinned/);
	// Pinned: both packs must exist, at the pinned export date.
	const missing = checkSources(withPin(okPacks(), pin(true))).join('\n');
	assert.match(missing, /zh-sentences-tatoeba: server\/tools\/tatoeba\/pin\.json pins the export of 2000-01-02 but plugins\/data\/zh-sentences-tatoeba is missing/);
	assert.match(missing, /ja-sentences-tatoeba: server\/tools\/tatoeba\/pin\.json pins/);
	assert.deepEqual(checkSources(withPin(gen('2000-01-02'), pin(true))), []);
	assert.match(checkSources(withPin(gen('1999-12-31'), pin(true))).join('\n'), /version "1999-12-31".*export date 2000-01-02/);
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

test('the fetched font packs are exactly the sources of prepare-font-pack.mjs, and the docs may name them', async () => {
	const { SOURCES } = await import('./prepare-font-pack.mjs');
	for (const id of Object.keys(SOURCES)) assert.ok(FETCHED_PACKS.includes(id), `${id} is not in FETCHED_PACKS`);
	const doc = DOC + '| Pack | Provides |\n|---|---|\n' + Object.keys(SOURCES).map((id) => `| **F** (\`${id}\`) | x |`).join('\n') + '\n';
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

// The vectors are shared with server/internal/pack/notice_vectors_test.go:
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

test('built-in theme packs are bundled packs that need a LICENSE and a docs entry', () => {
	const p = okPacks();
	p['server/internal/themes/builtin/night'] = { id: 'night', ...GOOD };
	p['server/internal/themes/builtin/day'] = { id: 'day', ...GOOD };
	const root = repo(p, DOC + '- **Night** (`night`, built in)\n');
	writeFileSync(join(root, 'server/internal/themes/builtin/night/LICENSE'), 'MIT License\n');
	writeFileSync(join(root, 'server/internal/themes/builtin/day/LICENSE'), '  \n');
	const out = checkSources(root).join('\n');
	assert.match(out, /server\/internal\/themes\/builtin\/day: LICENSE is missing or empty/);
	assert.match(out, /bundled pack "day"/);
	assert.doesNotMatch(out, /"night"/);
	assert.doesNotMatch(out, /builtin\/night/);
});

test('rule g: a project-written pack must be CC BY 4.0 with the qinqin credit and its legal code', () => {
	const bad = okPacks();
	bad['plugins/data/ja-grammar'] = { id: 'ja-grammar', license: 'CC0-1.0', attribution: 'written for qinqin; CC0 1.0' };
	const out = checkSources(repo(bad, DOC + '- **J** (`ja-grammar`)\n')).join('\n');
	assert.match(out, /plugins\/data\/ja-grammar\/manifest.json: project-written pack must state license "CC-BY-4.0"/);
	assert.match(out, /plugins\/data\/ja-grammar\/manifest.json: attribution must carry the credit "qinqin contributors, CC BY 4.0"/);
	assert.match(out, /plugins\/data\/ja-grammar: LICENSE must be the CC BY 4.0 legal code/);

	const good = okPacks();
	good['plugins/data/ja-grammar'] = {
		id: 'ja-grammar',
		license: 'CC-BY-4.0 (the lessons); the syllabus is referenced',
		attribution: 'x; qinqin contributors, CC BY 4.0 (https://github.com/Elaktrato/qinqin)'
	};
	const root = repo(good, DOC + '- **J** (`ja-grammar`)\n');
	writeFileSync(join(root, 'plugins/data/ja-grammar/LICENSE'), 'Attribution 4.0 International\n');
	assert.deepEqual(checkSources(root), []);
});

test('rule g: the licence is exactly CC-BY-4.0, optionally with a parenthesised qualifier', () => {
	const make = (license) => {
		const p = okPacks();
		p['plugins/data/ja-grammar'] = { id: 'ja-grammar', license, attribution: 'qinqin contributors, CC BY 4.0' };
		const root = repo(p, DOC + '- **J** (`ja-grammar`)\n');
		writeFileSync(join(root, 'plugins/data/ja-grammar/LICENSE'), 'Attribution 4.0 International\n');
		return checkSources(root).join('\n');
	};
	assert.equal(make('CC-BY-4.0'), '');
	assert.equal(make('CC-BY-4.0 (the lessons)'), '');
	for (const bad of ['CC-BY-4.0-or-later', 'CC-BY-4.0X', 'CC-BY-4.01', 'CC-BY-4.0; plus other terms', 'cc-by-4.0'])
		assert.match(make(bad), /must state license "CC-BY-4\.0"/, bad);
});

/** withFont adds a font file (and optionally a licence text) to a temp repository. */
function withFont(root, rel, licence) {
	mkdirSync(dirname(join(root, rel)), { recursive: true });
	writeFileSync(join(root, rel), 'wOF2');
	if (licence) {
		mkdirSync(join(root, 'apps/web/static'), { recursive: true });
		writeFileSync(join(root, 'apps/web/static', licence), 'SIL OPEN FONT LICENSE Version 1.1');
	}
	return root;
}

const FONT_DOC = DOC + '\n## Interface font\n\nFigtree (`Figtree-Variable.woff2`), licence text `apps/web/static/FONT-OFL.TXT`.\n\n## Other\n';

test('a bundled font named in the docs with an existing licence text passes', () => {
	const root = withFont(repo(okPacks(), FONT_DOC), 'apps/web/src/lib/assets/fonts/Figtree-Variable.woff2', 'FONT-OFL.TXT');
	assert.deepEqual(checkSources(root), []);
});

test('a bundled font the docs do not name is reported', () => {
	const root = withFont(repo(okPacks()), 'apps/web/static/fonts/Other.ttf', 'FONT-OFL.TXT');
	assert.deepEqual(checkSources(root), [
		'apps/web/static/fonts/Other.ttf: bundled font is not named in docs/sources.md; name the file, in backticks, in a section that also names its licence text (`apps/web/static/<NAME>.TXT`)'
	]);
});

test('a bundled font whose docs section names no existing licence text is reported', () => {
	const missing = withFont(repo(okPacks(), FONT_DOC), 'apps/web/src/lib/assets/fonts/Figtree-Variable.woff2');
	assert.deepEqual(checkSources(missing), [
		'apps/web/src/lib/assets/fonts/Figtree-Variable.woff2: the docs/sources.md section naming it names no licence text that exists under apps/web/static'
	]);
	// A licence text in another section does not count.
	const doc = DOC + '\n## Interface font\n\nFigtree (`Figtree-Variable.woff2`).\n\n## Other\n\n`apps/web/static/FONT-OFL.TXT`\n';
	const elsewhere = withFont(repo(okPacks(), doc), 'apps/web/src/lib/assets/fonts/Figtree-Variable.woff2', 'FONT-OFL.TXT');
	assert.equal(checkSources(elsewhere).length, 1);
});

test('node_modules and build output are not scanned for fonts', () => {
	const root = withFont(repo(okPacks()), 'apps/web/node_modules/x/a.woff2');
	withFont(root, 'apps/web/build/_app/immutable/assets/abc.woff2');
	assert.deepEqual(checkSources(root), []);
});

/** withIcons adds a vendored icon module (and optionally a licence text) to a temp repository. */
function withIcons(root, name, licence) {
	const dir = join(root, 'apps/web/src/lib/ui/icons');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), 'export const ICONS = {};');
	writeFileSync(join(dir, name.replace(/\.ts$/, '.test.ts')), '// a test, never named');
	if (licence) {
		mkdirSync(join(root, 'apps/web/static'), { recursive: true });
		writeFileSync(join(root, 'apps/web/static', licence), 'ISC License');
	}
	return root;
}

const ICON_DOC = DOC + '\n## Icons\n\nLucide (`lucide.ts`), licence text `apps/web/static/LUCIDE-LICENSE.TXT`.\n\n## Other\n';

test('rule f: a vendored icon set named in the docs with an existing licence text passes', () => {
	const root = withIcons(repo(okPacks(), ICON_DOC), 'lucide.ts', 'LUCIDE-LICENSE.TXT');
	assert.deepEqual(checkSources(root), []);
});

test('rule f: a vendored icon set the docs do not name, or name without a licence text, is reported', () => {
	const unnamed = withIcons(repo(okPacks()), 'lucide.ts', 'LUCIDE-LICENSE.TXT');
	assert.deepEqual(checkSources(unnamed), [
		'apps/web/src/lib/ui/icons/lucide.ts: vendored icon set is not named in docs/sources.md; name the file, in backticks, in a section that also names its licence text (`apps/web/static/<NAME>.TXT`)'
	]);
	const unlicensed = withIcons(repo(okPacks(), ICON_DOC), 'lucide.ts');
	assert.deepEqual(checkSources(unlicensed), [
		'apps/web/src/lib/ui/icons/lucide.ts: the docs/sources.md section naming it names no licence text that exists under apps/web/static'
	]);
});
