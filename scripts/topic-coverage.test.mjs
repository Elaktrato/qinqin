// The shipped topic labels meet the coverage floors and are what their inputs build (#220):
//   node --test scripts/topic-coverage.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LANGS, build, inputs, root } from './build-topic-labels.mjs';
import { report } from './topic-coverage.mjs';

test('the labels files are what the committed batches and pictures build', () => {
	const ins = inputs();
	for (const lang of LANGS) {
		const have = readFileSync(join(root, 'server/internal/topics/labels', `${lang}.json`), 'utf8');
		assert.equal(build(lang, ins), have, `${lang}: run node scripts/build-topic-labels.mjs`);
	}
});

test('HSK 1-4: at least 90 % of each level has a topic', () => {
	for (const r of report('zh')) assert.ok(r.share >= 0.9, `${r.level}: ${r.labelled}/${r.words}`);
});

test('≈ N5-N3: at least 85 % of each level has a topic, once jlpt-words is bundled (#219)', (t) => {
	const rows = report('ja');
	if (!rows) return t.skip('plugins/data/jlpt-words is not on this branch');
	for (const r of rows) assert.ok(r.share >= 0.85, `${r.level}: ${r.labelled}/${r.words}`);
});
