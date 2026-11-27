// Tests of the estimated JLPT word list generator, on a synthetic fixture
// (made-up ranks and levels, no published JLPT list):
//   node --test scripts/prepare-jlpt-words.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
	JLPT_WORDS_NOTICE,
	LEVEL_NAMES,
	TARGET_CUMULATIVE,
	THRESHOLDS,
	baseLevels,
	buildLevels,
	calibrateWithBase,
	consistency,
	estimateLevel,
	fitThresholds,
	jmdictIndex,
	kanjiLevel,
	kanjiLevelMap,
	matchRank,
	matchWords,
	parseJMdict,
	parseJiten,
	rankLevel,
	wordEntry
} from './prepare-jlpt-words.mjs';

const script = fileURLToPath(new URL('./prepare-jlpt-words.mjs', import.meta.url));
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// ---- the fixture

/** A kanji levels pack in the jlpt-kanji shape; 橋, 犬 and 縡 have no level. */
const KANJI = {
	unit: 'character',
	levels: [
		{ name: 'N5', entries: ['日', '本', '学', '校', '人', '大', '食'] },
		{ name: 'N4', entries: ['風', '勉', '強', '事'] },
		{ name: 'N3', entries: ['猫'] },
		{ name: 'N2', entries: ['鳥'] },
		{ name: 'N1', entries: ['為', '此'] }
	]
};

const k = (keb, ...inf) => `<k_ele><keb>${keb}</keb>${inf.map((i) => `<ke_inf>&${i};</ke_inf>`).join('')}</k_ele>`;
const r = (reb, extra = '') => `<r_ele><reb>${reb}</reb>${extra}</r_ele>`;
const sense = (gloss, misc = '') => `<sense><pos>&n;</pos>${misc ? `<misc>&${misc};</misc>` : ''}<gloss>${gloss}</gloss></sense>`;
const entry = (seq, ...parts) => `<entry>\n<ent_seq>${seq}</ent_seq>\n${parts.join('\n')}\n</entry>`;

const JMDICT = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY uk "word usually written using kana alone">
<!ENTITY n "noun">
<!ENTITY sK "search-only kanji form">
<!ENTITY exp "expressions (phrases, clauses, etc.)">
]>
<JMdict>
${[
	entry(101, k('為る', 'rK'), r('する', '<re_pri>ichi1</re_pri>'), sense('to do', 'uk')),
	entry(102, k('此れ'), r('これ', '<re_pri>ichi1</re_pri>'), sense('this', 'uk')),
	entry(103, k('日本'), r('にほん', '<re_pri>news1</re_pri>'), r('にっぽん'), sense('Japan')),
	entry(104, k('学校'), r('がっこう'), sense('school')),
	entry(105, r('テレビ'), sense('television')),
	entry(106, k('風'), r('かぜ'), sense('wind')),
	entry(107, k('風'), r('ふう'), sense('method')),
	entry(108, k('食べる'), r('たべる'), sense('to eat')),
	entry(109, k('犬'), r('いぬ'), sense('dog')),
	entry(110, k('勉強'), r('べんきょう'), sense('study')),
	entry(111, k('猫'), r('ねこ'), sense('cat')),
	entry(112, k('橋'), r('はし'), sense('bridge')),
	entry(113, k('箸'), r('はし'), sense('chopsticks')),
	entry(114, k('鳥'), r('とり'), sense('bird')),
	entry(115, k('大人'), r('おとな'), sense('adult')),
	entry(116, k('事'), k('縡', 'sK'), r('こと'), sense('thing')),
	entry(117, r('のだ'), '<sense><pos>&exp;</pos><gloss>it is that</gloss></sense>', '<sense><gloss>the explanation is</gloss></sense>'),
	entry(118, k('有難う'), r('ありがとう'), '<sense><pos>&exp;</pos><misc>&uk;</misc><gloss>thank you</gloss></sense>')
].join('\n')}
</JMdict>
`;

// Ranks: one rank is one word, every form and reading of it on its own row.
const JITEN = `term,reading,rank
為る,する,1
する,,1
此れ,これ,2
これ,,2
日本,にほん,3
日本,にっぽん,3
学校,がっこう,4
んだ,,5
テレビ,,6
風,かぜ,7
食べる,たべる,8
犬,いぬ,9
勉強,べんきょう,10
猫,ねこ,11
風,ふう,12
橋,はし,13
はし,,13
鳥,とり,14
箸,はし,15
縡,こと,16
事,こと,16
こと,,16
のだ,,17
有難う,ありがとう,18
ありがとう,,18
`;

const TEST_THRESHOLDS = { R5: 4, R4: 8, R3: 11, R2: 13, R1: 14 };

function fixture() {
	const entries = parseJMdict(JMDICT);
	const index = jmdictIndex(entries);
	const kanji = kanjiLevelMap(KANJI);
	const jiten = parseJiten(JITEN);
	return { entries, index, kanji, jiten };
}

const names = (levels) => levels.map((l) => l.name);
const forms = (level) => level.entries.map((e) => (typeof e === 'string' ? e : `${e.form}/${e.reading}`));

// ---- parsing

test('parseJiten groups the rows of one rank, ranks ascending', () => {
	const jiten = parseJiten(JITEN);
	assert.deepEqual(jiten[0], { rank: 1, rows: [{ term: '為る', reading: 'する' }, { term: 'する', reading: '' }] });
	assert.deepEqual(
		jiten.map((g) => g.rank),
		[...Array(18).keys()].map((i) => i + 1)
	);
	assert.throws(() => parseJiten('word,rank\nx,1\n'), /missing column term/);
});

test('parseJMdict reads forms, readings, flags, usually-kana and priority', () => {
	const entries = parseJMdict(JMDICT);
	assert.equal(entries.length, 18);
	assert.equal(entries.find((e) => e.seq === 117).expOnly, true); // the second sense inherits exp
	assert.equal(entries.find((e) => e.seq === 104).expOnly, false);
	const suru = entries.find((e) => e.seq === 101);
	assert.deepEqual(suru.kebs, [{ text: '為る', inf: ['rK'] }]);
	assert.equal(suru.rebs[0].text, 'する');
	assert.equal(suru.uk, true);
	assert.ok(suru.pri > 0);
	const tv = entries.find((e) => e.seq === 105);
	assert.deepEqual(tv.kebs, []);
	assert.equal(tv.uk, false);
});

// ---- matching

test('matchRank picks the entry matching most rows by form and reading', () => {
	const { index, jiten } = fixture();
	const byRank = (n) => jiten.find((g) => g.rank === n).rows;
	assert.equal(matchRank(byRank(1), index).entry.seq, 101); // 為る/する and する
	assert.equal(matchRank(byRank(7), index).entry.seq, 106); // 風 かぜ, not 風 ふう
	assert.equal(matchRank(byRank(12), index).entry.seq, 107); // 風 ふう
	assert.equal(matchRank(byRank(13), index).entry.seq, 112); // 橋 and はし: the bridge, not 箸
	assert.equal(matchRank(byRank(6), index).entry.seq, 105); // kana only
	assert.equal(matchRank(byRank(5), index).entry, null); // んだ: no entry
});

test('a kana row alone that several entries share is matched and counted as ambiguous', () => {
	const { index } = fixture();
	const m = matchRank([{ term: 'はし', reading: '' }], index);
	assert.equal(m.entry.seq, 112); // equal scores: lowest sequence number
	assert.equal(m.ambiguous, true);
});

test('wordEntry writes a kanji word as {form, reading} and a kana-only word as its kana', () => {
	const { entries } = fixture();
	const bySeq = (n) => entries.find((e) => e.seq === n);
	assert.deepEqual(wordEntry(bySeq(103)), { form: '日本', reading: 'にほん' });
	assert.deepEqual(wordEntry(bySeq(101)), { form: '為る', reading: 'する' });
	assert.equal(wordEntry(bySeq(105)), 'テレビ');
	assert.deepEqual(wordEntry(bySeq(116)), { form: '事', reading: 'こと' }); // not the search-only 縡
});

// ---- the rules

test('kanjiLevel: the hardest kanji wins, a kanji without a level counts as N1, kana and usually-kana words have none', () => {
	const { entries, kanji } = fixture();
	const bySeq = (n) => entries.find((e) => e.seq === n);
	assert.equal(kanjiLevel(bySeq(104), kanji), 0); // 学校: N5 N5
	assert.equal(kanjiLevel(bySeq(110), kanji), 1); // 勉強: N4 N4
	assert.equal(kanjiLevel(bySeq(109), kanji), 4); // 犬: no level → N1
	assert.equal(kanjiLevel(bySeq(105), kanji), null); // テレビ
	assert.equal(kanjiLevel(bySeq(101), kanji), null); // する is usually kana: 為 (N1) does not count
	assert.equal(kanjiLevel({ kebs: [{ text: '人々', inf: [] }], rebs: [], uk: false }, kanji), 0); // 々 ignored
	// Only search-only kanji forms (the particle の, searchable as 乃): written in kana.
	assert.equal(kanjiLevel({ kebs: [{ text: '乃', inf: ['sK'] }], rebs: [{ text: 'の', inf: [], restr: [], nokanji: false }], uk: false }, kanji), null);
});

test('rankLevel follows the thresholds; beyond R1 is not listed; estimateLevel takes the harder', () => {
	assert.equal(rankLevel(1, TEST_THRESHOLDS), 0);
	assert.equal(rankLevel(4, TEST_THRESHOLDS), 0);
	assert.equal(rankLevel(5, TEST_THRESHOLDS), 1);
	assert.equal(rankLevel(11, TEST_THRESHOLDS), 2);
	assert.equal(rankLevel(13, TEST_THRESHOLDS), 3);
	assert.equal(rankLevel(14, TEST_THRESHOLDS), 4);
	assert.equal(rankLevel(15, TEST_THRESHOLDS), null);
	assert.equal(estimateLevel(0, 3), 3);
	assert.equal(estimateLevel(4, 0), 4);
	assert.equal(estimateLevel(null, 2), 2);
	assert.equal(estimateLevel(2, null), null); // no rank within R1: not listed
});

test('matchWords leaves out grammar expressions (exp-only entries read with a particle or copula first) and keeps set phrases', () => {
	const { index, jiten } = fixture();
	const m = matchWords(jiten, index);
	assert.deepEqual(m.expressions.map((w) => w.entry.seq), [117]); // のだ
	assert.ok(m.words.some((w) => w.entry.seq === 118)); // 有難う, ありがとう
	assert.ok(!m.words.some((w) => w.entry.seq === 117));
});

test('buildLevels: the estimate per level, easiest first, by rank; unmatched ranks reported', () => {
	const { index, kanji, jiten } = fixture();
	const matched = matchWords(jiten, index);
	assert.deepEqual(
		matched.unmatched.map((u) => u.rank),
		[5]
	);
	const { levels } = buildLevels({ words: matched.words, kanji, thresholds: TEST_THRESHOLDS });
	assert.deepEqual(names(levels), LEVEL_NAMES);
	assert.deepEqual(names(levels), ['≈ N5', '≈ N4', '≈ N3', '≈ N2', '≈ N1']);
	assert.deepEqual(forms(levels[0]), ['為る/する', '此れ/これ', '日本/にほん', '学校/がっこう']);
	assert.deepEqual(forms(levels[1]), ['テレビ', '風/かぜ', '食べる/たべる']);
	assert.deepEqual(forms(levels[2]), ['勉強/べんきょう', '猫/ねこ']);
	assert.deepEqual(forms(levels[3]), ['風/ふう']);
	assert.deepEqual(forms(levels[4]), ['犬/いぬ', '橋/はし', '鳥/とり']); // 箸 (15) and 事 (16) beyond R1
});

test('fitThresholds meets each cumulative target with the smallest rank', () => {
	const { index, kanji, jiten } = fixture();
	const { words } = matchWords(jiten, index);
	const fit = fitThresholds({ words, kanji, targets: [4, 7, 9, 10, 13] });
	assert.deepEqual(fit.thresholds, { R5: 4, R4: 8, R3: 11, R2: 12, R1: 14 });
	assert.deepEqual(fit.cumulative, [4, 7, 9, 10, 13]);
	// A target the data cannot reach takes every word and says so.
	const short = fitThresholds({ words, kanji, targets: [4, 7, 9, 10, 99] });
	assert.equal(short.thresholds.R1, 18);
	assert.deepEqual(short.short, ['≈ N1']);
});

test('the bundled thresholds are increasing and the targets are the commonly cited sizes', () => {
	const t = THRESHOLDS;
	assert.ok(t.R5 < t.R4 && t.R4 < t.R3 && t.R3 < t.R2 && t.R2 < t.R1);
	assert.deepEqual(TARGET_CUMULATIVE, [800, 1500, 3700, 6000, 10000]);
});

test('consistency: single-kanji agreement, monotonic levels, spot samples', () => {
	const { index, kanji, jiten } = fixture();
	const { words } = matchWords(jiten, index);
	const built = buildLevels({ words, kanji, thresholds: TEST_THRESHOLDS });
	const c = consistency({ placed: built.placed, kanji, sample: 2 });
	// Single-kanji words with a JLPT kanji: 風 かぜ (N4/N4), 猫 (N3/N3), 風 ふう (N4 kanji, ≈ N2), 鳥 (N2, ≈ N1).
	assert.deepEqual(c.singleKanji, { words: 4, agree: 2 });
	// Each JLPT kanji's easiest word against the kanji's own level: 日 本 学 校 風 猫 equal; 食 勉 強 鳥 one harder.
	assert.deepEqual(c.kanjiEasiestWord, { kanji: 10, same: 6, oneHarder: 4, harder: 0 });
	assert.deepEqual(c.cumulative, [4, 7, 9, 10, 13]);
	assert.equal(c.monotonic, true);
	assert.deepEqual(c.samples[0], ['する', '日本']); // evenly spaced; a usually-kana word in kana
	assert.equal(c.samples.length, 5);
});

// ---- the optional base list

const BASE = {
	'n5.csv': 'expression,reading,meaning\n学校,がっこう,x\n犬,いぬ,x\n',
	'n4.csv': 'expression,reading,meaning\n風,ふう,x\n',
	'n3.csv': 'expression,reading,meaning\n未知語,みちご,x\n箸,はし,x\n',
	'n2.csv': 'expression,reading,meaning\n鳥,とり,x\n',
	'n1.csv': 'expression,reading,meaning\nはし,,x\n'
};

test('baseLevels matches base words by form and reading and reports the unmatched and ambiguous', () => {
	const { index } = fixture();
	const b = baseLevels(BASE, index);
	assert.equal(b.levelOf.get(104), 0); // 学校
	assert.equal(b.levelOf.get(109), 0); // 犬
	assert.equal(b.levelOf.get(107), 1); // 風 ふう, not 風 かぜ
	assert.equal(b.levelOf.get(113), 2); // 箸 はし, not 橋
	assert.equal(b.levelOf.get(114), 3); // 鳥
	assert.deepEqual(b.stats[2].unmatched, ['未知語/みちご']);
	assert.equal(b.stats[4].ambiguous, 1); // はし alone: 橋 or 箸
	assert.equal(b.levelOf.has(112), false); // an ambiguous base word is reported, never guessed
});

test('buildLevels with a base list keeps the base levels and estimates the rest', () => {
	const { index, kanji, jiten } = fixture();
	const { words } = matchWords(jiten, index);
	const base = baseLevels(BASE, index);
	const { levels, fromBase } = buildLevels({ words, kanji, thresholds: TEST_THRESHOLDS, base, entries: index.bySeq });
	assert.deepEqual(forms(levels[0]), ['為る/する', '此れ/これ', '日本/にほん', '学校/がっこう', '犬/いぬ']);
	assert.deepEqual(forms(levels[1]), ['テレビ', '風/かぜ', '食べる/たべる', '風/ふう']);
	assert.deepEqual(forms(levels[2]), ['勉強/べんきょう', '猫/ねこ', '箸/はし']); // 箸 beyond R1 but in the base list
	assert.deepEqual(forms(levels[3]), ['鳥/とり']);
	assert.deepEqual(forms(levels[4]), ['橋/はし']);
	assert.equal(fromBase, 5);
});

test('calibrateWithBase fits on 80 % and reports per-level agreement on the held-out 20 %', () => {
	const { index, kanji, jiten } = fixture();
	const { words } = matchWords(jiten, index);
	const base = baseLevels(BASE, index);
	const a = calibrateWithBase({ words, kanji, base });
	const b = calibrateWithBase({ words, kanji, base });
	assert.deepEqual(a, b);
	assert.equal(a.holdout.words + a.train.words, 5); // the base words Jiten ranks: 学校 犬 風ふう 箸 鳥
	assert.equal(a.holdout.perLevel.length, 5);
	assert.ok(a.thresholds.R5 <= a.thresholds.R4);
});

// ---- the CLI

function packsDir({ jiten = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'jlpt-words-'));
	dirs.push(root);
	const put = (rel, data) => {
		mkdirSync(join(root, rel, '..'), { recursive: true });
		writeFileSync(join(root, rel), data);
	};
	if (jiten) {
		put('jiten-frequency/freq.csv.gz', gzipSync(Buffer.from(JITEN)));
		put('jiten-frequency/LICENSE', 'CC BY-SA 4.0 legal code\n');
		put('jiten-frequency/manifest.json', JSON.stringify({ id: 'jiten-frequency', version: '2026-11-12' }));
	}
	put('jmdict/jmdict.xml.gz', gzipSync(Buffer.from(JMDICT)));
	put('jmdict/LICENSE', 'CC BY-SA 4.0 legal code\n');
	put('jmdict/manifest.json', JSON.stringify({ id: 'jmdict', version: '2026-11-11' }));
	put('jlpt-kanji/levels.json', JSON.stringify(KANJI));
	put('jlpt-kanji/LICENSE', 'MIT licence text\n');
	put('jlpt-kanji/manifest.json', JSON.stringify({ id: 'jlpt-kanji', version: 'kanjiapi.dev@76aa080+kanjidic2@2026-11-11' }));
	return root;
}

const PACK_FILES = ['manifest.json', 'levels.json', 'LICENSE', 'LICENSE-kanjiapi.dev', 'ATTRIBUTION.md', 'UNMATCHED.tsv'];

test('the CLI writes the pack byte for byte the same on a re-run', () => {
	const packs = packsDir();
	const run = (out) => {
		const res = spawnSync(process.execPath, [script, '--packs', packs, '--out', out], { encoding: 'utf8' });
		assert.equal(res.status, 0, res.stderr);
		return PACK_FILES.map((f) => readFileSync(join(out, 'jlpt-words', f), 'utf8'));
	};
	const a = run(join(packs, 'a'));
	const b = run(join(packs, 'b'));
	assert.deepEqual(a, b);
	const manifest = JSON.parse(a[0]);
	assert.equal(manifest.id, 'jlpt-words');
	assert.equal(manifest.name, 'JLPT words (approximate)');
	assert.equal(manifest.type, 'levels');
	assert.equal(manifest.license, 'CC BY-SA 4.0');
	assert.equal(manifest.notice, JLPT_WORDS_NOTICE);
	const lv = JSON.parse(a[1]);
	assert.equal(lv.unit, 'word');
	assert.deepEqual(names(lv.levels), LEVEL_NAMES);
	assert.equal(a[2], 'CC BY-SA 4.0 legal code\n'); // JMdict's and Jiten's licence
	assert.equal(a[3], 'MIT licence text\n'); // kanjiapi.dev's, via jlpt-kanji
	assert.match(a[4], /no official JLPT vocabulary list has been published since 2010/);
	assert.match(a[5], /^rank\tterms\n5\tんだ\n/);
});

test('the CLI fails clearly without the Jiten pack and writes nothing', () => {
	const packs = packsDir({ jiten: false });
	const res = spawnSync(process.execPath, [script, '--packs', packs, '--out', join(packs, 'out')], { encoding: 'utf8' });
	assert.equal(res.status, 1);
	assert.match(res.stderr, /jiten-frequency/);
	assert.equal(existsSync(join(packs, 'out')), false);
});

test('the notice says it is an estimate and credits its inputs in the notice mini-markup', () => {
	assert.match(JLPT_WORDS_NOTICE, /^The JLPT word levels are an estimate, not an official list: no official JLPT vocabulary list has been published since 2010\./);
	for (const link of ['(https://jiten.moe/frequency-dictionaries)', '(https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project)', '(https://github.com/onlyskin/kanjiapi.dev)']) {
		assert.ok(JLPT_WORDS_NOTICE.includes(link), link);
	}
	assert.ok(Buffer.byteLength(JLPT_WORDS_NOTICE) <= 4000);
	assert.doesNotMatch(JLPT_WORDS_NOTICE, /\]\((?!https:)/);
});

test('the committed pack is what the generator writes from the bundled data', () => {
	const packs = fileURLToPath(new URL('../plugins/data', import.meta.url));
	const out = mkdtempSync(join(tmpdir(), 'jlpt-words-bundled-'));
	dirs.push(out);
	const res = spawnSync(process.execPath, [script, '--packs', packs, '--out', out], { encoding: 'utf8' });
	assert.equal(res.status, 0, res.stderr);
	for (const f of PACK_FILES) {
		assert.equal(readFileSync(join(out, 'jlpt-words', f), 'utf8'), readFileSync(join(packs, 'jlpt-words', f), 'utf8'), `${f} differs: re-run node scripts/prepare-jlpt-words.mjs`);
	}
	// The shipped cuts are the cumulative fit on the bundled data.
	assert.match(res.stdout, new RegExp(`thresholds: R5 ${THRESHOLDS.R5}, R4 ${THRESHOLDS.R4}, R3 ${THRESHOLDS.R3}, R2 ${THRESHOLDS.R2}, R1 ${THRESHOLDS.R1}`));
	const fit = spawnSync(process.execPath, [script, '--calibrate', '--packs', packs], { encoding: 'utf8' });
	assert.equal(fit.status, 0, fit.stderr);
	assert.match(fit.stdout, new RegExp(`^cumulative fit: R5 ${THRESHOLDS.R5}, R4 ${THRESHOLDS.R4}, R3 ${THRESHOLDS.R3}, R2 ${THRESHOLDS.R2}, R1 ${THRESHOLDS.R1};`));
});
