// Tests of the word -> picture matcher:
//   node --test scripts/picture-match.test.mjs
// The concepts and entries are invented stand-ins for OpenMoji, Mulberry,
// CC-CEDICT and JMdict, shaped like what scripts/build-picture-map.mjs reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foldKana, matchEntries, normalizeGloss, normalizeLabel, THRESHOLD } from './picture-match.mjs';

test('normalizeGloss drops parentheses, articles and the infinitive marker', () => {
	assert.deepEqual(normalizeGloss('apple'), { text: 'apple', verb: false });
	assert.deepEqual(normalizeGloss('(a) red apple'), { text: 'red apple', verb: false });
	assert.deepEqual(normalizeGloss('the sun'), { text: 'sun', verb: false });
	assert.deepEqual(normalizeGloss('to eat'), { text: 'eat', verb: true });
	assert.deepEqual(normalizeGloss('dog (animal)'), { text: 'dog', verb: false });
});

test('normalizeGloss rejects glosses that are not a meaning', () => {
	for (const g of ['surname Wang', 'CL:個|个[ge4]', 'variant of 蘋果|苹果[ping2 guo3]', 'see also 犬', '', '(Tw)', 'abbr. for apple', 'Red Square', 'Hong Kong']) {
		assert.equal(normalizeGloss(g), null, g);
	}
});

test('normalizeLabel reads Mulberry file names and OpenMoji names alike', () => {
	assert.equal(normalizeLabel('apple_pie'), 'apple pie');
	assert.equal(normalizeLabel('bank_(money)'), 'bank');
	assert.equal(normalizeLabel('Red Apple'), 'red apple');
});

test('foldKana folds katakana to hiragana', () => {
	assert.equal(foldKana('リンゴ'), 'りんご');
	assert.equal(foldKana('ラーメン'), 'らーめん');
});

const concepts = [
	{ id: '1F34E', label: 'red apple', tags: ['apple', 'fruit'], pos: 'noun', native: { zh: { name: '红苹果', keywords: ['苹果', '水果'] }, ja: { name: '赤リンゴ', keywords: ['りんご', '果物'] } } },
	{ id: '1F34F', label: 'green apple', tags: ['apple', 'fruit'], pos: 'noun', native: { zh: { name: '青苹果', keywords: ['苹果', '水果'] }, ja: { name: '青リンゴ', keywords: ['りんご', '果物'] } } },
	{ id: '1F415', label: 'dog', tags: ['pet'], pos: 'noun', native: { zh: { name: '狗', keywords: ['宠物'] }, ja: { name: '犬', keywords: ['ペット'] } } },
	{ id: '1F525', label: 'fire', tags: ['flame'], pos: 'noun', native: { zh: { name: '火焰', keywords: ['火'] }, ja: { name: '火', keywords: ['炎'] } } },
	{ id: '1F3E6', label: 'bank', tags: ['building'], pos: 'noun', native: { zh: { name: '银行', keywords: [] }, ja: { name: '銀行', keywords: [] } } },
	{ id: 'mul-eat', label: 'eat', tags: [], pos: 'verb', native: {} }
];

const entry = (target, forms, ...senses) => ({ target, forms, senses, note: forms[0] });
const run = (entries, lang = 'zh', opts = {}) => matchEntries(entries, concepts, lang, opts);

test('an exact name in the entry language is a strong match', () => {
	const { rows } = run([entry('狗', ['狗'], ['canine'])]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].concept, '1F415');
	assert.equal(rows[0].sense, 0);
	assert.ok(rows[0].score >= 90);
});

test('the name and the English gloss agreeing raise the score and name the sense', () => {
	const { rows } = run([entry('银行', ['银行'], ['bank', 'depository'])]);
	assert.equal(rows[0].concept, '1F3E6');
	assert.equal(rows[0].sense, 1);
	assert.equal(rows[0].basis, 'name+gloss');
	assert.equal(rows[0].score, 100);
});

test('a keyword shared by two pictures is ambiguous: a review row, no map row', () => {
	const { rows, review } = run([entry('苹果', ['苹果'], ['(fruit) apple pie filling'])]);
	assert.deepEqual(rows, []);
	assert.equal(review.length, 1);
	assert.equal(review[0].reason, 'ambiguous-keyword');
	assert.deepEqual(review[0].candidates.sort(), ['1F34E', '1F34F']);
});

test('a unique first gloss resolves a keyword that is shared in the entry language', () => {
	const e = entry('苹果', ['苹果'], ['red apple']);
	const { rows } = run([e]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].concept, '1F34E');
	assert.equal(rows[0].sense, 1);
});

test('a keyword alone is only a review row; with the gloss that confirms it, a map row', () => {
	let out = run([entry('火', ['火'], ['spark'])], 'zh');
	assert.deepEqual(out.rows, []);
	assert.equal(out.review[0].reason, 'weak');
	out = run([entry('火', ['火'], ['fire'])], 'zh');
	assert.equal(out.rows[0].concept, '1F525');
	assert.equal(out.rows[0].score, 90);
});

test('a name on an entry with several senses needs a gloss to confirm it', () => {
	const e = entry('火焰', ['火焰'], ['spark'], ['rage']);
	const { rows, review } = run([e]);
	assert.deepEqual(rows, []);
	assert.equal(review[0].reason, 'multi-sense-unconfirmed');
});

test('a homograph (the form of several entries) needs the gloss to confirm the name', () => {
	const a = entry('银行', ['银行'], ['to bank']);
	const b = entry('银行', ['银行'], ['bank']);
	const { rows } = run([a, b]);
	// only the entry whose gloss agrees maps
	assert.equal(rows.length, 1);
	assert.equal(rows[0].sense, 1);
});

test('a verb gloss matches verb pictures only, a plain gloss never a verb picture', () => {
	let out = run([entry('吃', ['吃'], ['to eat'])]);
	assert.equal(out.rows[0].concept, 'mul-eat');
	out = run([entry('x', ['x'], ['eat'])]);
	assert.deepEqual(out.rows, []);
	out = run([entry('y', ['y'], ['to fire'])]);
	assert.deepEqual(out.rows, [], '"to fire" must not get the flame');
});

test('a second gloss alone is below the threshold and goes to the review list', () => {
	const { rows, review } = run([entry('z', ['z'], ['blaze', 'fire'])]);
	assert.deepEqual(rows, []);
	assert.equal(review[0].reason, 'weak');
	assert.deepEqual(review[0].candidates, ['1F525']);
});

test('the Japanese forms fold katakana and use the reading when there is no kanji', () => {
	const e = entry('j:1', ['りんご', 'リンゴ'], ['orchard fruit']);
	const { review } = run([e], 'ja');
	assert.equal(review[0].reason, 'ambiguous-keyword'); // red or green apple
	const f = entry('j:2', ['犬', 'いぬ'], ['dog']);
	const { rows } = run([f], 'ja');
	assert.equal(rows[0].concept, '1F415');
});

test('a conflict between the name and the gloss is a review row', () => {
	const e = entry('银行', ['银行'], ['dog']);
	const { rows, review } = run([e]);
	assert.deepEqual(rows, []);
	assert.equal(review[0].reason, 'conflict');
});

test('styleOffset lowers every score (a second picture set ranks below the first)', () => {
	const a = run([entry('狗', ['狗'], ['dog'])]).rows[0].score;
	const b = run([entry('狗', ['狗'], ['dog'])], 'zh', { styleOffset: -5 }).rows[0].score;
	assert.equal(b, a - 5);
});

test('maxPerConcept keeps the entries ranked first and reviews the rest', () => {
	const es = ['狗', '犬子', '小狗'].map((f, i) => ({ ...entry(f, [f], ['dog']), rank: i }));
	const { rows, review } = run(es, 'zh', { maxPerConcept: 2 });
	assert.equal(rows.length, 2);
	assert.deepEqual(rows.map((r) => r.target), ['狗', '犬子']);
	assert.equal(review.at(-1).reason, 'over-cap');
});

test('a keyword and a weak gloss do not add up to a map row', () => {
	const { rows, review } = run([entry('火', ['火'], ['spark', 'fire'])]);
	assert.deepEqual(rows, []);
	assert.equal(review[0].reason, 'weak');
});
