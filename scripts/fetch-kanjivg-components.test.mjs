// The bundled KanjiVG licence text is pinned: plugins/data/UPSTREAM.sha256
// holds the SHA-256 of kanjivg-components/LICENSE (KanjiVG's COPYING at the
// pinned commit), and the fetch script checks a fresh clone against it.
//   node --test scripts/fetch-kanjivg-components.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));

test('UPSTREAM.sha256 pins the KanjiVG licence text', () => {
	const line = read('plugins/data/UPSTREAM.sha256')
		.toString()
		.split('\n')
		.find((l) => l.endsWith('  kanjivg-components/LICENSE'));
	assert.ok(line, 'no kanjivg-components/LICENSE line in UPSTREAM.sha256');
	const sum = createHash('sha256').update(read('plugins/data/kanjivg-components/LICENSE')).digest('hex');
	assert.equal(line.split('  ')[0], sum);
});

test('the fetch script checks COPYING against the pinned sum', () => {
	const script = read('scripts/fetch-kanjivg-components.sh').toString();
	assert.match(script, /UPSTREAM\.sha256/);
	assert.match(script, /kanjivg-components\/LICENSE/);
	assert.match(script, /sha256sum/);
});
