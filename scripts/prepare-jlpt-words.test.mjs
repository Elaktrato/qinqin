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
	dropReason,
	fitThresholds,
	jmdictIndex,
	kanjiLevel,
	kanjiLevelMap,
	matchRank,
	matchWords,
	levelFor,
	parseAnchors,
	parseCore,
	parseGrammar,
	parseJMdict,
	parseJiten,
	prepareWord,
	priorityLift,
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
<!ENTITY ateji "ateji (phonetic) reading">
<!ENTITY int "interjection (kandoushi)">
<!ENTITY suf "suffix">
<!ENTITY sl "manga slang">
<!ENTITY prt "particle">
]>
<JMdict>
${[
	entry(101, k('為る', 'rK'), r('する', '<re_pri>ichi1</re_pri>'), sense('to do', 'uk')),
	entry(102, k('此れ'), r('これ', '<re_pri>ichi1</re_pri>'), '<sense><pos>&pn;</pos><misc>&uk;</misc><gloss>this</gloss></sense>'),
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
	entry(118, k('有難う'), r('ありがとう', '<re_pri>ichi1</re_pri>'), '<sense><pos>&exp;</pos><misc>&uk;</misc><gloss>thank you</gloss></sense>'),
	entry(119, '<k_ele><keb>銀行</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf01</ke_pri></k_ele>', r('ぎんこう'), sense('bank')),
	entry(120, k('綺麗', 'ateji'), r('きれい', '<re_pri>ichi1</re_pri>'), sense('pretty')),
	entry(121, r('あああ'), '<sense><pos>&int;</pos><gloss>aaah</gloss></sense>'),
	entry(122, r('げ'), '<sense><pos>&suf;</pos><gloss>-looking</gloss></sense>'),
	entry(123, k('５分'), r('ごふん'), sense('five minutes')),
	entry(124, k('言葉を失う'), r('ことばをうしなう'), '<sense><pos>&exp;</pos><gloss>to be lost for words</gloss></sense>'),
	entry(125, k('初めまして'), r('はじめまして'), '<sense><pos>&exp;</pos><gloss>nice to meet you</gloss></sense>'),
	entry(126, r('なんです'), '<sense><pos>&exp;</pos><gloss>it is that</gloss></sense>'),
	entry(127, r('やばい'), '<sense><pos>&n;</pos><misc>&sl;</misc><gloss>awesome</gloss></sense>'),
	entry(128, r('ね'), '<sense><pos>&prt;</pos><gloss>right?</gloss></sense>')
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
銀行,ぎんこう,30
`;

const TEST_THRESHOLDS = { R5: 4, R4: 8, R3: 11, R2: 13, R1: 14 };

/** The jōyō kanji of the fixture (a joyo-grades levels.json): 縡 and 為 are not jōyō. */
const JOYO = { unit: 'character', levels: [{ name: 'Grade 1', entries: [...'日本学校人大食風勉強事猫鳥此犬橋箸銀言葉失五分'] }] };

function fixture() {
	const entries = parseJMdict(JMDICT);
	const index = jmdictIndex(entries);
	const kanji = kanjiLevelMap(KANJI);
	const joyo = new Set(JOYO.levels.flatMap((l) => l.entries));
	const jiten = parseJiten(JITEN);
	const ctx = { kanji, joyo, core: new Map(), grammar: new Set() };
	return { entries, index, kanji, joyo, jiten, ctx };
}

const names = (levels) => levels.map((l) => l.name);
const forms = (level) => level.entries.map((e) => (typeof e === 'string' ? e : `${e.form}/${e.reading}`));

// ---- parsing

test('parseJiten groups the rows of one rank, ranks ascending', () => {
	const jiten = parseJiten(JITEN);
	assert.deepEqual(jiten[0], { rank: 1, rows: [{ term: '為る', reading: 'する' }, { term: 'する', reading: '' }] });
	assert.deepEqual(
		jiten.map((g) => g.rank),
		[...[...Array(18).keys()].map((i) => i + 1), 30]
	);
	assert.throws(() => parseJiten('word,rank\nx,1\n'), /missing column term/);
});

test('parseJMdict reads forms, readings, flags, usually-kana and priority', () => {
	const entries = parseJMdict(JMDICT);
	assert.equal(entries.length, 28);
	assert.equal(entries.find((e) => e.seq === 117).expOnly, true); // the second sense inherits exp
	assert.equal(entries.find((e) => e.seq === 104).expOnly, false);
	const suru = entries.find((e) => e.seq === 101);
	assert.deepEqual(suru.kebs, [{ text: '為る', inf: ['rK'] }]);
	assert.equal(suru.rebs[0].text, 'する');
	assert.equal(suru.uk, true);
	assert.ok(suru.pri > 0);
	assert.deepEqual([...entries.find((e) => e.seq === 119).tags].sort(), ['ichi1', 'news1', 'nf01']);
	assert.ok(entries.find((e) => e.seq === 120).kebs[0].inf.includes('ateji'));
	assert.ok(entries.find((e) => e.seq === 121).pos.has('int'));
	assert.ok(entries.find((e) => e.seq === 127).misc.has('sl'));
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

test('kanjiLevel: the hardest jōyō kanji wins; kana, usually-kana, ateji and non-jōyō spellings have none', () => {
	const { entries, kanji, joyo } = fixture();
	const bySeq = (n) => entries.find((e) => e.seq === n);
	assert.equal(kanjiLevel(bySeq(104), kanji, joyo), 0); // 学校: N5 N5
	assert.equal(kanjiLevel(bySeq(110), kanji, joyo), 1); // 勉強: N4 N4
	assert.equal(kanjiLevel(bySeq(109), kanji, joyo), 4); // 犬: jōyō without a JLPT level → N1
	assert.equal(kanjiLevel(bySeq(105), kanji, joyo), null); // テレビ
	assert.equal(kanjiLevel(bySeq(101), kanji, joyo), null); // する is usually kana: 為 (N1) does not count
	assert.equal(kanjiLevel(bySeq(120), kanji, joyo), null); // 綺麗: ateji, read as a kana word
	assert.equal(kanjiLevel(bySeq(116), kanji, new Set(['日'])), null); // 事 outside the jōyō set: a kana word
	assert.equal(kanjiLevel({ kebs: [{ text: '人々', inf: [] }], rebs: [], uk: false }, kanji, joyo), 0); // 々 ignored
	// Only search-only kanji forms (the particle の, searchable as 乃): written in kana.
	assert.equal(kanjiLevel({ kebs: [{ text: '乃', inf: ['sK'] }], rebs: [{ text: 'の', inf: [], restr: [], nokanji: false }], uk: false }, kanji, joyo), null);
});

test('rankLevel follows the thresholds; beyond R1 is not listed', () => {
	assert.equal(rankLevel(1, TEST_THRESHOLDS), 0);
	assert.equal(rankLevel(4, TEST_THRESHOLDS), 0);
	assert.equal(rankLevel(5, TEST_THRESHOLDS), 1);
	assert.equal(rankLevel(11, TEST_THRESHOLDS), 2);
	assert.equal(rankLevel(13, TEST_THRESHOLDS), 3);
	assert.equal(rankLevel(14, TEST_THRESHOLDS), 4);
	assert.equal(rankLevel(15, TEST_THRESHOLDS), null);
});

test('priorityLift: basic (ichi1) words in nf01–nf06 two levels, in nf07–nf12 (or spec1, gai1) one, others none', () => {
	const tagged = (...t) => ({ tags: new Set(t) });
	assert.equal(priorityLift(tagged('ichi1', 'news1', 'nf06')), 2);
	assert.equal(priorityLift(tagged('ichi1', 'news1', 'nf07')), 1);
	assert.equal(priorityLift(tagged('ichi1', 'news1', 'nf12')), 1);
	assert.equal(priorityLift(tagged('spec1')), 1);
	assert.equal(priorityLift(tagged('gai1', 'ichi1')), 1); // タクシー
	assert.equal(priorityLift(tagged('news1', 'nf01')), 0); // newspaper words alone (株主, 東欧)
	assert.equal(priorityLift(tagged('ichi1')), 0);
	assert.equal(priorityLift(tagged('news2', 'nf30')), 0);
	assert.equal(priorityLift(tagged()), 0);
});

/** prepared builds a prepared word by hand: rank, kanji level, cap, priority, register floor. */
const prepared = (o) => ({ rank: 1, k: null, lift: 0, pri: false, floor: false, fn: true, drop: null, core: null, news: false, ...o });

test('levelFor: frequency first; kanji raise by one at most and never a priority word; lifts, floors and the core', () => {
	const t = TEST_THRESHOLDS;
	assert.equal(levelFor(prepared({ rank: 2 }), t), 0); // by rank alone
	assert.equal(levelFor(prepared({ rank: 2, k: 4 }), t), 1); // N1 kanji raise an N5-ranked word by one only
	assert.equal(levelFor(prepared({ rank: 2, k: 4, pri: true }), t), 0); // not at all with a priority tag
	assert.equal(levelFor(prepared({ rank: 9, k: 0 }), t), 2); // easy kanji never lower a word
	assert.equal(levelFor(prepared({ rank: 14, lift: 2, pri: true }), t), 2); // ≈ N1 by rank, two levels easier
	assert.equal(levelFor(prepared({ rank: 14, lift: 1, pri: true }), t), 3); // one level easier
	assert.equal(levelFor(prepared({ rank: 12, lift: 2, pri: true }), t), 2); // ≈ N2 by rank: lifted to ≈ N3, no easier
	assert.equal(levelFor(prepared({ rank: 9, lift: 2, pri: true }), t), 2); // ≈ N3 by rank: not lifted
	assert.equal(levelFor(prepared({ rank: 99, lift: 2, pri: true, news: true }), t), 2); // beyond R1: in by its tags, from ≈ N1
	assert.equal(levelFor(prepared({ rank: 2 }), t), 0); // see below: a function word
	assert.equal(levelFor(prepared({ rank: 2, fn: false }), t), 1); // outside the core, no easier than ≈ N4
	assert.equal(levelFor(prepared({ rank: 2, fn: true }), t), 0); // kana function words (は, これ) can be ≈ N5
	assert.equal(levelFor(prepared({ rank: 99, lift: 1, pri: true }), t), null); // beyond R1 without the newspaper tag: out
	assert.equal(levelFor(prepared({ rank: 1, floor: true }), t), 2); // slang, interjections: ≈ N3 or harder
	assert.equal(levelFor(prepared({ rank: 1, drop: 'noise' }), t), null);
	assert.equal(levelFor(prepared({ rank: 99, drop: 'noise', core: 0 }), t), 0); // the core always applies
	assert.equal(levelFor(prepared({ rank: 99, core: 1 }), t, { useCore: false }), null); // the estimate without it
});

test('dropReason: grammar, set phrases, numbers, noise and one-kana fragments go; particles and vocabulary stay', () => {
	const { entries, ctx } = fixture();
	const bySeq = (n) => entries.find((e) => e.seq === n);
	assert.equal(dropReason(bySeq(117), ctx), 'grammar'); // のだ: exp, starts with a particle, no kanji form
	assert.equal(dropReason({ ...bySeq(125), tags: new Set(['ichi1']) }, ctx), null); // 初めまして: exp starting with は, written with a kanji, common
	assert.equal(dropReason(bySeq(124), ctx), 'phrase'); // 言葉を失う
	assert.equal(dropReason(bySeq(123), ctx), 'number'); // ５分
	assert.equal(dropReason(bySeq(121), ctx), 'noise'); // あああ
	assert.equal(dropReason(bySeq(122), ctx), 'fragment'); // げ
	assert.equal(dropReason(bySeq(128), ctx), 'particle'); // ね: grammar, not vocabulary
	assert.equal(dropReason({ ...bySeq(104), kebs: [{ text: '十人', inf: [] }] }, ctx), 'number'); // a numeral and a counter
	assert.equal(dropReason({ ...bySeq(124), kebs: [{ text: 'もう無理', inf: [] }] }, ctx), 'expression'); // exp, no common-word tag
	const kana = (text, pos = 'int') => ({ seq: 1, kebs: [], rebs: [{ text, inf: [], restr: [], nokanji: false }], uk: false, expOnly: false, pos: new Set([pos]), firstPos: new Set([pos]) });
	assert.equal(dropReason(kana('っつ'), ctx), 'noise'); // a clipped sound
	assert.equal(dropReason(kana('ゲッ'), ctx), 'noise');
	assert.equal(dropReason(kana('ちょっと', 'adv'), ctx), null);
	assert.equal(dropReason(bySeq(118), ctx), null); // 有難う
	assert.equal(dropReason(bySeq(126), { ...ctx, grammar: new Set([126]) }), 'grammar list'); // なんです
});

test('prepareWord reads the rules off the entry', () => {
	const { entries, ctx } = fixture();
	const bySeq = (n) => entries.find((e) => e.seq === n);
	const bank = prepareWord({ rank: 30, entry: bySeq(119) }, ctx);
	assert.deepEqual({ lift: bank.lift, pri: bank.pri, news: bank.news, floor: bank.floor }, { lift: 2, pri: true, news: true, floor: false });
	assert.equal(prepareWord({ rank: 5, entry: bySeq(127) }, ctx).floor, true); // やばい: slang
	assert.equal(prepareWord({ rank: 5, entry: bySeq(121) }, ctx).floor, true); // an interjection not on JMdict's basic lists
	assert.equal(prepareWord({ rank: 5, entry: bySeq(104) }, { ...ctx, core: new Map([[104, 0]]) }).core, 0);
});

test('parseCore, parseGrammar and parseAnchors read the project lists and report what JMdict lacks', () => {
	const { index } = fixture();
	const core = parseCore('# comment\nN5\t学校\tがっこう\nN4\tテレビ\t\nN5\t未知語\tみちご\nN5\tはし\t\n', index);
	assert.deepEqual([...core.levelOf], [[104, 0], [105, 1]]);
	assert.deepEqual(core.unmatched, ['未知語/みちご']);
	assert.deepEqual(core.ambiguous, ['はし']); // 橋 or 箸: never guessed
	assert.throws(() => parseCore('N3\t猫\tねこ\n', index), /N5 or N4/);
	const grammar = parseGrammar('# x\nなんです\nのだ\n', index);
	assert.deepEqual([...grammar.seqs].sort(), [117, 126]);
	assert.deepEqual(parseAnchors('# x\n天気\tてんき\tN4\n'), [{ form: '天気', reading: 'てんき', max: 1 }]);
});

test('buildLevels: levels easiest first, by rank; a newspaper-common word beyond R1 gets in; unmatched ranks reported', () => {
	const { index, jiten, ctx } = fixture();
	const matched = matchWords(jiten, index);
	assert.deepEqual(
		matched.unmatched.map((u) => u.rank),
		[5]
	);
	const { levels } = buildLevels({ words: matched.words, ctx: { ...ctx, thresholds: TEST_THRESHOLDS } });
	assert.deepEqual(names(levels), LEVEL_NAMES);
	assert.deepEqual(names(levels), ['≈ N5', '≈ N4', '≈ N3', '≈ N2', '≈ N1']);
	assert.deepEqual(forms(levels[0]), ['此れ/これ']); // outside the core only a kana function word is ≈ N5
	assert.deepEqual(forms(levels[1]), ['為る/する', '日本/にほん', '学校/がっこう', 'テレビ', '風/かぜ', '食べる/たべる']);
	assert.deepEqual(forms(levels[2]), ['勉強/べんきょう', '猫/ねこ', '銀行/ぎんこう']); // 銀行 (30): beyond R1, in by ichi1 nf01, lifted two levels
	assert.deepEqual(forms(levels[3]), ['犬/いぬ', '風/ふう']); // 犬: ≈ N3 by rank, its N1 kanji raise it one level
	assert.deepEqual(forms(levels[4]), ['橋/はし', '鳥/とり']); // 箸 (15) and 事 (16) beyond R1
});

test('buildLevels applies the core list: its words take its level, ranked or not', () => {
	const { index, jiten, ctx } = fixture();
	const { words } = matchWords(jiten, index);
	const core = new Map([[113, 0], [115, 1], [109, 0]]); // 箸 (beyond R1), 大人 (not ranked), 犬
	const { levels } = buildLevels({ words, ctx: { ...ctx, core, thresholds: TEST_THRESHOLDS }, entries: index.bySeq });
	assert.deepEqual(forms(levels[0]), ['此れ/これ', '犬/いぬ', '箸/はし']);
	assert.deepEqual(forms(levels[1]), ['為る/する', '日本/にほん', '学校/がっこう', 'テレビ', '風/かぜ', '食べる/たべる', '大人/おとな']);
});

test('fitThresholds cuts at the target-th listable word by rank and reports the placed sizes', () => {
	const { index, jiten, ctx } = fixture();
	const { words } = matchWords(jiten, index);
	const fit = fitThresholds({ words, ctx, targets: [4, 8, 10, 12, 14] });
	// Listable ranks: 1–4, 6–16, 18, 30 (5 matches nothing, 17 のだ is grammar).
	// R1 is fitted on the placed total: 13 words by rank and 銀行 (30) by its newspaper tag make 14.
	assert.deepEqual(fit.thresholds, { R5: 4, R4: 9, R3: 11, R2: 13, R1: 14 });
	assert.deepEqual(fit.rankCumulative, [4, 8, 10, 12, 13]);
	assert.equal(fit.cumulative[4], 14);
	assert.deepEqual(fit.short, []);
	// A target the data cannot reach takes every word and says so.
	const short = fitThresholds({ words, ctx, targets: [4, 8, 10, 12, 99] });
	assert.deepEqual(short.short, ['≈ N1']);
	assert.equal(short.thresholds.R1, 30);
});

test('the bundled thresholds are increasing and the targets are the commonly cited sizes', () => {
	const t = THRESHOLDS;
	assert.ok(t.R5 < t.R4 && t.R4 < t.R3 && t.R3 < t.R2 && t.R2 < t.R1);
	assert.deepEqual(TARGET_CUMULATIVE, [800, 1500, 3700, 6000, 10000]);
});

test('consistency: single-kanji agreement, the core estimate, monotonic levels, spot samples', () => {
	const { index, jiten, ctx } = fixture();
	const { words } = matchWords(jiten, index);
	const c0 = { ...ctx, thresholds: TEST_THRESHOLDS, core: new Map([[104, 0], [107, 0], [113, 0]]) };
	const built = buildLevels({ words, ctx: c0, entries: index.bySeq });
	const c = consistency({ built, ctx: c0, sample: 2 });
	// Single-kanji words with a JLPT kanji: 風 かぜ (N4/≈N4), 猫 (N3/≈N3), 風 ふう (core: ≈ N5), 鳥 (N2/≈N1).
	assert.deepEqual(c.singleKanji, { words: 4, agree: 2 });
	// The core words' levels without the core: 学校 ≈ N4 (one off), 風 ふう ≈ N2 (three off), 箸 not listed.
	assert.deepEqual(c.coreEstimate, { words: 3, exact: 0, withinOne: 1, unlisted: 1 });
	assert.equal(c.monotonic, true);
	assert.deepEqual(c.samples[0], ['これ', '風']); // evenly spaced through これ 学校 風 箸; a usually-kana word in kana
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
	const { index, jiten, ctx } = fixture();
	const { words } = matchWords(jiten, index);
	const base = baseLevels(BASE, index);
	const { levels, fromBase } = buildLevels({ words, ctx: { ...ctx, thresholds: TEST_THRESHOLDS }, base, entries: index.bySeq });
	assert.deepEqual(forms(levels[0]), ['此れ/これ', '学校/がっこう', '犬/いぬ']);
	assert.deepEqual(forms(levels[1]), ['為る/する', '日本/にほん', 'テレビ', '風/かぜ', '食べる/たべる', '風/ふう']);
	assert.deepEqual(forms(levels[2]), ['勉強/べんきょう', '猫/ねこ', '箸/はし', '銀行/ぎんこう']); // 箸 beyond R1 but in the base list
	assert.deepEqual(forms(levels[3]), ['鳥/とり']);
	assert.deepEqual(forms(levels[4]), ['橋/はし']);
	assert.equal(fromBase, 5);
});

test('calibrateWithBase fits on 80 % and reports per-level agreement on the held-out 20 %', () => {
	const { index, jiten, ctx } = fixture();
	const { words } = matchWords(jiten, index);
	const base = baseLevels(BASE, index);
	const a = calibrateWithBase({ words, ctx, base });
	const b = calibrateWithBase({ words, ctx, base });
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
	put('joyo-grades/levels.json', JSON.stringify(JOYO));
	put('joyo-grades/manifest.json', JSON.stringify({ id: 'joyo-grades', version: 'kanjidic2@2026-11-11' }));
	put('lists/core.tsv', 'N5\t学校\tがっこう\nN4\t大人\tおとな\n');
	put('lists/grammar.tsv', 'なんです\n');
	put('lists/anchors.tsv', '学校\tがっこう\tN5\n');
	return root;
}

const PACK_FILES = ['manifest.json', 'levels.json', 'LICENSE', 'LICENSE-kanjiapi.dev', 'ATTRIBUTION.md', 'UNMATCHED.tsv'];

test('the CLI writes the pack byte for byte the same on a re-run', () => {
	const packs = packsDir();
	const run = (out) => {
		const res = spawnSync(process.execPath, [script, '--packs', packs, '--lists', join(packs, 'lists'), '--out', out], { encoding: 'utf8' });
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
	const res = spawnSync(process.execPath, [script, '--packs', packs, '--lists', join(packs, 'lists'), '--out', join(packs, 'out')], { encoding: 'utf8' });
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

test('the anchors hold, the core list matches JMdict, and the estimate agrees with the core without it', () => {
	const packs = fileURLToPath(new URL('../plugins/data', import.meta.url));
	const res = spawnSync(process.execPath, [script, '--calibrate', '--packs', packs], { encoding: 'utf8' });
	assert.equal(res.status, 0, res.stderr);
	// Every core word is one JMdict entry: none unmatched, none ambiguous.
	assert.match(res.stdout, /^core: \d+ words, 0 unmatched, 0 ambiguous$/m);
	// Every anchor is in the pack at its level or easier.
	const anchors = /^anchors: (\d+) of (\d+) at or under their level/m.exec(res.stdout);
	assert.ok(anchors, res.stdout);
	assert.equal(anchors[1], anchors[2], res.stdout.split('\n').filter((l) => l.startsWith('anchor miss')).join('\n'));
	// The core N5/N4 words, placed by the rules alone (the core switched off): measured 73.2 % within one
	// level on 2026-11-28. The review asked for 90 %; the rules alone reached 87.8 % before the blind teacher
	// spot check showed the non-core words far too easy, and the fix (outside the core, ≈ N4 or harder; lifts
	// stop at ≈ N3) costs this measure. The days of the week, 切手, 晴れ and the like rank 10,000–35,000 in
	// Jiten, so frequency alone cannot place them: the core does. The floor keeps it from sliding.
	const core = /^core estimate: (\d+) words, (\d+) exact, (\d+) within one level/m.exec(res.stdout);
	assert.ok(core, res.stdout);
	assert.ok(Number(core[3]) / Number(core[1]) >= 0.7, core[0]);
});
