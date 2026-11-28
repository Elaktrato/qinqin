// Tests of the doubtful-picture review (#274): which mappings are doubtful, the batches, the decision of two
// teachers and an adjudicator, and how decisions reach the committed maps.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRemovals } from './images-lib.mjs';
import { batches, decideItem, decisionRows, doubtReasons, readVerdicts, REMOVED_HEADER } from './picture-review-lib.mjs';

const row = (over = {}) => ({ language: 'zh', target: '打', sense: '1', concept: '1F94A', score: '80', basis: 'gloss', note: '', ...over });

test('doubtReasons names every reason a mapping is doubtful; a manual or plain mapping has none', () => {
	assert.deepEqual(doubtReasons(row(), { senses: 4, shared: 1, length: 1 }), ['one-gloss-match', 'several-senses', 'single-character']);
	assert.deepEqual(doubtReasons(row({ sense: '0', basis: 'name+gloss', score: '100' }), { senses: 3, shared: 1, length: 2 }), ['whole-entry-of-several-senses']);
	assert.deepEqual(doubtReasons(row({ sense: '2', basis: 'name', score: '90' }), { senses: 3, shared: 5, length: 2 }), ['not-the-first-sense', 'shared-picture']);
	assert.deepEqual(doubtReasons(row({ basis: 'name+gloss', score: '100' }), { senses: 1, shared: 1, length: 2 }), []);
	assert.deepEqual(doubtReasons(row({ basis: 'manual', score: '100' }), { senses: 4, shared: 9, length: 1 }), []);
	assert.deepEqual(doubtReasons(row({ language: 'ja', basis: 'name', score: '70' }), { senses: 1, shared: 1, length: 1 }), ['weak-score']);
});

test('batches cut a list into batches of at most n, numbered from 1', () => {
	const items = Array.from({ length: 7 }, (_, i) => ({ id: `x${i}` }));
	const out = batches(items, 3);
	assert.deepEqual(out.map((b) => b.items.map((i) => i.i)), [[1, 2, 3], [1, 2, 3], [1]]);
	assert.deepEqual(out.map((b) => b.n), [1, 2, 3]);
});

test('readVerdicts keeps accept, remove and change (with a picture name) answers, drops the rest', () => {
	const got = readVerdicts([
		{ i: 1, v: 'accept' },
		{ i: 2, v: 'remove', r: 'shows a boxing glove, not to hit' },
		{ i: 3, v: 'change', to: 'red apple', r: 'the fruit' },
		{ i: 4, v: 'change' },
		{ i: 'x', v: 'accept' },
		{ i: 5, v: 'maybe' }
	]);
	assert.deepEqual([...got.keys()], [1, 2, 3]);
	assert.deepEqual(got.get(3), { v: 'change', to: 'red apple', r: 'the fruit' });
});

test('decideItem: agreement stands; a disagreement is the adjudicator’s; none is undecided', () => {
	assert.deepEqual(decideItem({ v: 'accept' }, { v: 'accept' }), { v: 'accept', by: 'both' });
	assert.deepEqual(decideItem({ v: 'change', to: 'Red Apple' }, { v: 'change', to: 'red apple' }), { v: 'change', to: 'red apple', by: 'both' });
	assert.deepEqual(decideItem({ v: 'accept' }, { v: 'remove' }), { v: 'disputed' });
	assert.deepEqual(decideItem({ v: 'accept' }, { v: 'remove' }, { v: 'remove', r: 'wrong sense' }), { v: 'remove', by: 'adjudicator' });
	assert.deepEqual(decideItem({ v: 'change', to: 'dog' }, { v: 'change', to: 'cat' }), { v: 'disputed' });
	assert.deepEqual(decideItem(undefined, { v: 'accept' }), { v: 'undecided' });
});

test('decisionRows: a removal or change drops the row from its pack; a known picture name adds a manual row', () => {
	const items = [
		{ pack: 'openmoji', language: 'zh', target: '打', sense: 1, concept: '1F94A', decision: { v: 'remove' }, word: '打' },
		{ pack: 'mulberry', language: 'zh', target: '苹果', sense: 0, concept: 'apple', decision: { v: 'change', to: 'red apple' }, word: '苹果' },
		{ pack: 'openmoji', language: 'zh', target: '梨', sense: 0, concept: '1F34E', decision: { v: 'change', to: 'no such picture' }, word: '梨' },
		{ pack: 'openmoji', language: 'zh', target: '猫', sense: 0, concept: '1F408', decision: { v: 'accept' }, word: '猫' },
		{ pack: 'openmoji', language: 'zh', target: '狗', sense: 0, concept: '1F415', decision: { v: 'change', to: 'dog' }, word: '狗' }
	];
	const names = new Map([
		['red apple', { pack: 'openmoji', concept: '1F34E' }],
		['dog', { pack: 'openmoji', concept: '1F415' }]
	]);
	const { removed, manual } = decisionRows(items, names);
	assert.deepEqual(removed.map((r) => [r.pack, r.target, r.concept]), [['openmoji', '打', '1F94A'], ['mulberry', '苹果', 'apple'], ['openmoji', '梨', '1F34E']]);
	assert.deepEqual(manual.map((r) => [r.pack, r.target, r.sense, r.concept]), [['openmoji', '苹果', '0', '1F34E']]);
	assert.equal(REMOVED_HEADER.join(','), 'language,target,sense,concept,note');
});

test('applyRemovals drops exactly the removed (language, target, sense, concept) rows', () => {
	const rows = [row(), row({ sense: '3', concept: '1F44A' }), row({ target: '球' })];
	const out = applyRemovals(rows, [{ language: 'zh', target: '打', sense: '1', concept: '1F94A' }]);
	assert.deepEqual(out.map((r) => `${r.target}/${r.sense}/${r.concept}`), ['打/3/1F44A', '球/1/1F94A']);
});
