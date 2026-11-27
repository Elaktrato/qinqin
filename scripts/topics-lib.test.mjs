// Tests of the topic-label generator (#220):
//   node --test scripts/topics-lib.test.mjs
// The lists, dictionaries, pictures and agent answers are small invented
// stand-ins shaped like what scripts/build-topic-labels.mjs reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildLabels,
	cedictSenses,
	coverage,
	decide,
	formatLabels,
	groupRows,
	groupTopics,
	jaTargets,
	parseJsonLines,
	pictureTopics,
	readAnswers,
	toneless,
	topicIds,
	topicsFor,
	zhTargets
} from './topics-lib.mjs';

const LIST = { version: 1, rule: 'topics/list', topics: [{ id: 'food', scope: 'f' }, { id: 'drink', scope: 'd' }, { id: 'animals', scope: 'a' }, { id: 'work', scope: 'w' }, { id: 'function', scope: 'x' }, { id: 'feelings', scope: 'e' }] };
const IDS = topicIds(LIST);

test('topicIds reads the list and refuses a bad or repeated id', () => {
	assert.deepEqual(IDS, ['food', 'drink', 'animals', 'work', 'function', 'feelings']);
	assert.throws(() => topicIds({ topics: [{ id: 'Food' }] }), /id/);
	assert.throws(() => topicIds({ topics: [{ id: 'food' }, { id: 'food' }] }), /twice/);
});

const TABLE = [
	{ group: 'food-drink', subgroup: 'drink', topics: 'drink' },
	{ group: 'food-drink', subgroup: 'food-fruit', topics: 'food' },
	{ group: 'smileys-emotion', subgroup: '*', topics: 'feelings' },
	{ group: 'animals-nature', subgroup: 'animal-mammal', topics: 'animals' }
];

test('groupTopics maps a subgroup first, then the group wildcard, else nothing', () => {
	const of = groupTopics(TABLE, IDS);
	assert.deepEqual(of('food-drink', 'drink'), ['drink']);
	assert.deepEqual(of('smileys-emotion', 'face-smiling'), ['feelings']);
	assert.deepEqual(of('objects', 'other-object'), []);
	assert.throws(() => groupTopics([{ group: 'g', subgroup: 's', topics: 'nope' }], IDS), /nope/);
});

test('groupRows keeps only the mapped concepts, sorted, with their group and subgroup', () => {
	const om = [
		{ hexcode: '1F415', group: 'animals-nature', subgroups: 'animal-mammal' },
		{ hexcode: '1F34E', group: 'food-drink', subgroups: 'food-fruit' },
		{ hexcode: '2615', group: 'food-drink', subgroups: 'drink' }
	];
	assert.deepEqual(groupRows(om, new Set(['2615', '1F34E'])), [
		{ concept: '1F34E', group: 'food-drink', subgroup: 'food-fruit' },
		{ concept: '2615', group: 'food-drink', subgroup: 'drink' }
	]);
});

const GROUPS = [
	{ concept: '1F34E', group: 'food-drink', subgroup: 'food-fruit' },
	{ concept: '2615', group: 'food-drink', subgroup: 'drink' },
	{ concept: '1F415', group: 'animals-nature', subgroup: 'animal-mammal' },
	{ concept: '1F4BC', group: 'objects', subgroup: 'office' }
];
const MAP = [
	{ language: 'zh', target: '苹果', sense: '0', concept: '1F34E', score: '100', basis: 'manual', note: '' },
	{ language: 'zh', target: '茶', sense: '1', concept: '2615', score: '90', basis: 'name', note: '' },
	{ language: 'zh', target: '狗', sense: '1', concept: '1F415', score: '90', basis: 'name', note: '' },
	{ language: 'zh', target: '包', sense: '2', concept: '1F4BC', score: '80', basis: 'gloss', note: '' },
	{ language: 'ja', target: 'j:1', sense: '1', concept: '1F415', score: '100', basis: 'name+gloss', note: '犬' }
];

test('pictureTopics gives each mapped word the topics of its picture, per sense, for one language', () => {
	const p = pictureTopics(MAP, 'zh', GROUPS, groupTopics(TABLE, IDS));
	assert.deepEqual(p.get('苹果'), [{ sense: 0, topics: ['food'], note: '' }]);
	assert.deepEqual(p.get('茶'), [{ sense: 1, topics: ['drink'], note: '' }]);
	assert.equal(p.has('包'), false, 'an unmapped group gives no topic');
	assert.equal(p.has('j:1'), false);
});

const CEDICT = [
	'# CC-CEDICT',
	'茶 茶 [cha2] /tea/tea plant/',
	'狗 狗 [gou3] /dog/',
	'行 行 [hang2] /row/line/profession/',
	'行 行 [xing2] /to walk/to go/capable/',
	'蘋果 苹果 [ping2 guo3] /apple/'
].join('\n');

test('toneless folds marks, digits, spaces and ü', () => {
	assert.equal(toneless('bú kèqi'), 'bukeqi');
	assert.equal(toneless('bu2 ke4 qi5'), 'bukeqi');
	assert.equal(toneless('lǜ'), 'lv');
	assert.equal(toneless('lu:4'), 'lv');
});

test('cedictSenses keeps one sense per line with its pinyin, numbered from 1', () => {
	const s = cedictSenses(CEDICT);
	assert.deepEqual(s.get('行'), [
		{ n: 1, reading: 'hang2', glosses: ['row', 'line', 'profession'] },
		{ n: 2, reading: 'xing2', glosses: ['to walk', 'to go', 'capable'] }
	]);
});

const HSK = { unit: 'word', levels: [
	{ name: 'HSK 1', entries: [{ form: '茶', reading: 'chá' }, { form: '行', reading: 'xíng' }] },
	{ name: 'HSK 2', entries: [{ form: '狗', reading: 'gǒu' }, { form: '行', reading: 'háng' }] },
	{ name: 'HSK 5', entries: [{ form: '苹果', reading: 'píngguǒ' }] }
] };

test('zhTargets lists HSK 1-4 words once, in list order, with their senses (matching reading first) and picture hint', () => {
	const t = zhTargets(HSK, cedictSenses(CEDICT), pictureTopics(MAP, 'zh', GROUPS, groupTopics(TABLE, IDS)), 4);
	assert.deepEqual(t.map((w) => w.key), ['茶', '行', '狗']);
	assert.deepEqual(t[0], { key: '茶', form: '茶', reading: 'chá', senses: [{ n: 1, reading: 'cha2', glosses: ['tea', 'tea plant'] }], picture: ['drink'] });
	assert.deepEqual(t[1].senses.map((s) => s.n), [2, 1], 'the senses of the listed readings, xíng first');
	assert.equal(t[1].reading, 'xíng / háng');
});

const JMDICT = [
	{ target: 'j:10', forms: ['犬', 'いぬ'], senses: [['dog']], note: '犬', common: true, rank: 10 },
	{ target: 'j:20', forms: ['は'], senses: [['topic marker particle']], note: 'は', common: true, rank: 20 },
	{ target: 'j:21', forms: ['歯', 'は'], senses: [['tooth']], note: '歯', common: true, rank: 21 },
	{ target: 'j:30', forms: ['行く', '行く', 'いく', 'ゆく'], senses: [['to go'], ['to proceed'], ['to die']], note: '行く', common: true, rank: 30 }
];
const JLPT = { unit: 'word', levels: [
	{ name: '≈ N5', entries: [{ form: '犬', reading: 'いぬ' }, 'は', { form: '行く', reading: 'いく' }] },
	{ name: '≈ N4', entries: [{ form: '歯', reading: 'は' }, { form: '無い字', reading: 'ないじ' }] },
	{ name: '≈ N2', entries: [{ form: '猫', reading: 'ねこ' }] }
] };

test('jaTargets resolves each listed word to a JMdict entry (kana words to a kana-only entry) and keeps the rest unresolved', () => {
	const t = jaTargets(JLPT, JMDICT, new Map([['j:10', [{ sense: 1, topics: ['animals'] }]]]), ['≈ N5', '≈ N4', '≈ N3']);
	assert.deepEqual(t.map((w) => [w.form, w.reading, w.key]), [
		['犬', 'いぬ', 'j:10'],
		['は', undefined, 'j:20'],
		['行く', 'いく', 'j:30'],
		['歯', 'は', 'j:21'],
		['無い字', 'ないじ', '']
	]);
	assert.deepEqual(t[0].picture, ['animals']);
	assert.deepEqual(t[2].senses.map((s) => s.n), [1, 2, 3]);
});

test('parseJsonLines reads one object per line and skips fences and prose', () => {
	assert.deepEqual(parseJsonLines('```json\n{"i":1,"t":["food"]}\nnote\n{"i":2,"v":"ok"}\n```'), [{ i: 1, t: ['food'] }, { i: 2, v: 'ok' }]);
});

test('readAnswers keys answers by item, keeps only known topics and refuses an answer without any', () => {
	const a = readAnswers([{ i: 1, t: ['food', 'bogus', 'food'] }, { i: 2, t: [] }, { i: 3, v: 'ok' }, { i: 4, t: ['work'], s: { 2: ['animals'], x: ['food'] } }], IDS);
	assert.deepEqual(a.get(1), { t: ['food'] });
	assert.equal(a.has(2), false);
	assert.deepEqual(a.get(3), { ok: true });
	assert.deepEqual(a.get(4), { t: ['work'], s: { 2: ['animals'] } });
});

test('decide: two confirmations keep the suggestion', () => {
	const d = decide({ t: ['food'] }, { a: { ok: true }, b: { ok: true } });
	assert.deepEqual(d, { t: ['food'], confidence: 0.95, review: 'confirmed', note: '' });
});

test('decide: the same change by both teachers is applied', () => {
	const d = decide({ t: ['food'] }, { a: { t: ['drink'], n: 'a drink' }, b: { t: ['drink'], n: 'tea is a drink' } });
	assert.deepEqual(d, { t: ['drink'], confidence: 0.9, review: 'changed', note: 'a drink | tea is a drink' });
});

test('decide: a disagreement goes to the adjudicator; it picks a version or writes its own', () => {
	const picked = decide({ t: ['food'] }, { a: { ok: true }, b: { t: ['drink'], n: 'b' }, c: { t: ['drink'], n: 'c' } });
	assert.deepEqual(picked, { t: ['drink'], confidence: 0.8, review: 'adjudicated', note: 'b | c' });
	const own = decide({ t: ['food'] }, { a: { ok: true }, b: { t: ['drink'] }, c: { t: ['drink', 'food'], n: 'both' } });
	assert.equal(own.confidence, 0.7);
	assert.deepEqual(own.t, ['drink', 'food']);
});

test('decide: a disagreement without an adjudication keeps the suggestion at low confidence', () => {
	const d = decide({ t: ['food'] }, { a: { ok: true }, b: { t: ['drink'], n: 'b' } });
	assert.deepEqual(d, { t: ['food'], confidence: 0.5, review: 'disputed', note: 'b' });
});

test('decide: sense topics take part in the comparison', () => {
	const d = decide({ t: ['work'], s: { 2: ['movement'] } }, { a: { ok: true }, b: { t: ['work'], s: { 2: ['movement'] } } });
	assert.equal(d.review, 'confirmed');
});

const BATCH = {
	language: 'zh',
	batch: 1,
	reviewers: { suggest: 'zh-suggester', a: 'zh-teacher-1', b: 'zh-teacher-2', c: 'zh-teacher-3' },
	items: [{ i: 1, key: '茶', form: '茶', reading: 'chá' }, { i: 2, key: '行', form: '行', reading: 'xíng / háng' }, { i: 3, key: '狗', form: '狗' }],
	suggest: [{ i: 1, t: ['drink'] }, { i: 2, t: ['movement'], s: { 1: ['work'] } }, { i: 3, t: ['animals'] }],
	a: [{ i: 1, v: 'ok' }, { i: 2, v: 'ok' }, { i: 3, v: 'ok' }],
	b: [{ i: 1, v: 'ok' }, { i: 2, v: 'change', t: ['movement', 'qualities'], s: { 1: ['work'] }, n: 'also capable' }, { i: 3, v: 'ok' }],
	c: [{ i: 2, t: ['movement'], s: { 1: ['work'] }, n: 'keep' }]
};
const IDS2 = [...IDS, 'movement', 'qualities'];

test('buildLabels: words first in list order, sense rows after their word, then picture-only words; deterministic', () => {
	const picture = pictureTopics(MAP, 'zh', GROUPS, groupTopics(TABLE, IDS));
	const meta = { attribution: 'A', reviewers: [{ id: 'zh-teacher-1', role: 'r' }] };
	const file = buildLabels('zh', [BATCH], picture, IDS2, meta);
	assert.equal(file.version, 1);
	assert.equal(file.license, 'CC-BY-4.0');
	assert.deepEqual(file.labels.map((l) => [l.key, l.sense ?? 0, l.topics.join(','), l.review, l.confidence]), [
		['茶', 0, 'drink', 'confirmed', 0.95],
		['行', 0, 'movement', 'adjudicated', 0.8],
		['行', 1, 'work', 'adjudicated', 0.8],
		['狗', 0, 'animals', 'confirmed', 0.95],
		['苹果', 0, 'food', 'picture', 0.6]
	]);
	assert.deepEqual(file.labels[1].by, ['zh-teacher-1', 'zh-teacher-2', 'zh-teacher-3']);
	assert.equal(file.labels[1].note, 'also capable | keep');
	assert.equal(file.labels[4].basis, 'picture');
	assert.ok(file.labels.every((l) => l.reading === undefined), 'Chinese labels carry no reading');
	assert.equal(formatLabels(file), formatLabels(buildLabels('zh', [BATCH], picture, IDS2, meta)));
});

test('formatLabels writes one label per line so a change is a one-line diff', () => {
	const text = formatLabels({ version: 1, language: 'zh', labels: [{ key: 'a', form: 'a', topics: ['food'] }, { key: 'b', form: 'b', topics: ['drink'] }] });
	const lines = text.split('\n');
	assert.ok(lines.includes('  {"key":"a","form":"a","topics":["food"]},'));
	assert.ok(lines.includes('  {"key":"b","form":"b","topics":["drink"]}'));
	assert.deepEqual(JSON.parse(text).labels.length, 2);
});

const FILE = { labels: [
	{ key: '茶', form: '茶', topics: ['drink'] },
	{ key: '行', form: '行', topics: ['movement'] },
	{ key: '行', form: '行', sense: 1, topics: ['work'] },
	{ key: 'j:20', form: 'は', topics: ['function'] },
	{ key: 'j:21', form: '歯', reading: 'は', topics: ['body'] }
] };

test('topicsFor: the word row first, then sense rows; form plus reading; a kana word also by reading', () => {
	assert.deepEqual(topicsFor(FILE, { form: '行' }), ['movement', 'work']);
	assert.deepEqual(topicsFor(FILE, { form: '歯', reading: 'は' }), ['body']);
	assert.deepEqual(topicsFor(FILE, { form: 'は' }), ['function']);
	assert.deepEqual(topicsFor(FILE, { form: '歯', reading: 'し' }), []);
	assert.deepEqual(topicsFor({ labels: [{ key: 'j:21', form: '歯', reading: 'は', topics: ['body'] }] }, { form: 'は' }), ['body']);
});

test('coverage counts the share of each level with a topic', () => {
	const levels = { levels: [{ name: 'HSK 1', entries: [{ form: '茶' }, { form: '行' }, { form: '无' }, { form: '无2' }] }, { name: 'HSK 2', entries: ['歯'] }] };
	assert.deepEqual(coverage(levels, FILE), [
		{ level: 'HSK 1', words: 4, labelled: 2, share: 0.5, missing: ['无', '无2'] },
		{ level: 'HSK 2', words: 1, labelled: 1, share: 1, missing: [] }
	]);
});
