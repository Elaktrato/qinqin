// Tests of the images packs' readers and formats:
//   node --test scripts/images-lib.test.mjs
// Invented fixtures in the shape of the upstream files.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	MAP_HEADER,
	SPECS,
	applyManual,
	assemblePack,
	csvLine,
	formatTsv,
	manifestFor,
	mulberryConcepts,
	openmojiConcepts,
	parseCedict,
	parseJMdict,
	parseTsv,
	picturesFor,
	sortRows,
	svgLooksPlain
} from './images-lib.mjs';

test('TSV round trip, and a wrong header or a short line is refused', () => {
	const rows = [{ language: 'zh', target: '狗', sense: '0', concept: '1F415', score: '90', basis: 'name', note: 'gou3' }];
	const text = formatTsv(MAP_HEADER, rows);
	assert.deepEqual(parseTsv(text, MAP_HEADER), rows);
	assert.throws(() => parseTsv('a\tb\n', MAP_HEADER), /header/);
	assert.throws(() => parseTsv(MAP_HEADER.join('\t') + '\nzh\tx\n', MAP_HEADER), /fields/);
	assert.equal(formatTsv(['a'], [{ a: 'x\ty\nz' }]), 'a\nx y z\n', 'tabs and newlines in a value become spaces');
});

const CEDICT = `# CC-CEDICT
蘋果 苹果 [ping2 guo3] /apple/
打 打 [da3] /to hit/to fight/
打 打 [da2] /(loanword) dozen/
西瓜 西瓜 [xi1 gua1] /watermelon/
`;

test('parseCedict groups homographs into one entry with one sense per line, in file order', () => {
	const e = parseCedict(CEDICT);
	assert.equal(e.length, 3);
	assert.deepEqual(e[0].forms, ['苹果', '蘋果']);
	assert.deepEqual(e[1].senses, [['to hit', 'to fight'], ['(loanword) dozen']]);
	assert.equal(e[1].target, '打');
	assert.ok(e[0].rank < e[2].rank + 1, 'rank orders by form length first');
});

const JMDICT = `<JMdict>
<entry><ent_seq>1000001</ent_seq><k_ele><keb>林檎</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>りんご</reb></r_ele>
<sense><pos>&n;</pos><gloss>apple</gloss><gloss xml:lang="ger">Apfel</gloss></sense></entry>
<entry><ent_seq>1000002</ent_seq><r_ele><reb>ぶつ</reb></r_ele>
<sense><gloss xml:lang="ger">nur deutsch</gloss></sense><sense><gloss>to hit</gloss></sense></entry>
<entry><ent_seq>1000003</ent_seq><r_ele><reb>むご</reb></r_ele><sense><gloss xml:lang="ger">nur</gloss></sense></entry>
</JMdict>`;

test('parseJMdict keeps English glosses, drops senses without them and marks common words', () => {
	const e = parseJMdict(JMDICT);
	assert.equal(e.length, 2, 'an entry with no English gloss is dropped');
	assert.deepEqual(e[0], { target: 'j:1000001', forms: ['林檎', 'りんご'], senses: [['apple']], note: '林檎', common: true, rank: 1000001 });
	assert.equal(e[1].common, false);
	assert.deepEqual(e[1].senses, [['to hit']], 'the sense with only a German gloss is not counted');
});

test('openmojiConcepts skips skin tones, flags and helpers, and carries the CLDR names', () => {
	const list = [
		{ emoji: '🍎', hexcode: '1F34E', group: 'food-drink', annotation: 'red apple', tags: 'apple, fruit', openmoji_tags: '', openmoji_author: 'Liz Bravo', skintone: '', skintone_base_hexcode: '' },
		{ emoji: '✋', hexcode: '270B', group: 'people-body', annotation: 'raised hand', tags: 'hand', skintone: '', skintone_base_hexcode: '270B' },
		{ emoji: '👋🏽', hexcode: '1F44B-1F3FD', group: 'people-body', annotation: 'waving hand: medium skin tone', skintone: '4', skintone_base_hexcode: '1F44B' },
		{ emoji: '🇯🇵', hexcode: '1F1EF-1F1F5', group: 'flags', annotation: 'flag: Japan', skintone: '' },
		{ emoji: '', hexcode: '200D', group: 'component', annotation: 'zwj', skintone: '' },
		{ emoji: '', hexcode: 'F8FF', group: 'extras-unicode', annotation: 'apple logo', skintone: '' },
		{ emoji: '', hexcode: 'E000', group: 'extras-openmoji', subgroups: 'brand', annotation: 'apple', skintone: '' }
	];
	const cldr = { zh: { '🍎': { default: ['苹果'], tts: ['红苹果'] } } };
	const c = openmojiConcepts(list, cldr);
	assert.deepEqual(c.map((x) => x.id), ["1F34E", "270B"], "the base emoji of a skin-tone family stays");
	assert.deepEqual(c[0].native.zh, { name: '红苹果', keywords: ['苹果'] });
	assert.deepEqual(c[0].tags, ['apple', 'fruit']);
	assert.equal(c[0].credit, 'OpenMoji, Liz Bravo');
	assert.equal(openmojiConcepts(list, cldr, new Set(['nothing'])).length, 0, 'no SVG, no concept');
});

test('csvLine handles quotes', () => {
	assert.deepEqual(csvLine('1,"a, b",c'), ['1', 'a, b', 'c']);
	assert.deepEqual(csvLine('x,"say ""hi""",'), ['x', 'say "hi"', '']);
});

const SYMBOLS = `symbol-id,category-id,grammar,rated,tags,symbol-en,category-en,symbol-fr,category-fr
1,1,Letter,0,alphabet,A,Alphabet,UNE,Alphabet
2,2,Noun,0,fruit food,apple,Food,pomme,Food
3,2,Verb,0,,eat_,Food,manger,Food
4,3,Verb,0,movement,"run_,_to",Move,courir,Move
5,92,Noun,0,job,baker_1a,People,x,People
6,92,Noun,0,job,baker_1b,People,x,People
7,5,Interjection,0,,hello,Greetings,x,x
8,6,Noun,0,,close_to,Place,x,x
9,6,Verb,0,,"close_,_to",Place,x,x`;

test('mulberryConcepts: verbs, variants and unusable classes', () => {
	const c = mulberryConcepts(SYMBOLS);
	const byId = Object.fromEntries(c.map((x) => [x.id, x]));
	assert.ok(byId.apple && byId.apple.pos === 'noun');
	assert.equal(byId.apple.credit, 'Mulberry Symbols, Steve Lee');
	assert.ok(!byId.A && !byId.hello, 'letters and interjections are left out');
	assert.equal(c.filter((x) => x.label === 'baker').length, 1, 'baker_1b folds into baker_1a');
	const run = c.find((x) => x.label === 'run');
	assert.ok(run && run.pos === 'verb' && run.file === 'run_,_to');
	assert.equal(run.id, 'run_to');
	const ids = c.map((x) => x.id);
	assert.equal(new Set(ids).size, ids.length, 'concept ids are unique ("close to" and the verb "close, to")');
});

test('svgLooksPlain keeps drawings and refuses style, script and handlers', () => {
	assert.ok(svgLooksPlain('<?xml version="1.0"?><svg xmlns="x"><defs><linearGradient id="a"><stop/></linearGradient></defs><g><path d="M0"/></g></svg>'));
	assert.ok(!svgLooksPlain('<svg><style>.a{fill:red}</style><path/></svg>'));
	assert.ok(!svgLooksPlain('<svg><script>x</script></svg>'));
	assert.ok(!svgLooksPlain('<svg><path onclick="x()"/></svg>'));
	assert.ok(!svgLooksPlain('<svg><image href="a.png"/></svg>'));
});

test('applyManual replaces automatic rows of the same word and refuses unknown pictures', () => {
	const auto = [
		{ language: 'zh', target: '苹果', sense: '1', concept: 'x', score: '80', basis: 'gloss', note: '' },
		{ language: 'zh', target: '狗', sense: '0', concept: 'y', score: '90', basis: 'name', note: '' }
	];
	const out = applyManual(auto, [{ language: 'zh', target: '苹果', sense: '', concept: '1F34E', note: 'red' }], new Set(['1F34E']));
	assert.deepEqual(out.map((r) => [r.target, r.concept, r.score, r.basis, r.sense]), [['狗', 'y', '90', 'name', '0'], ['苹果', '1F34E', 100, 'manual', '0']]);
	assert.throws(() => applyManual(auto, [{ language: 'zh', target: 'z', sense: '0', concept: 'nope', note: '' }], new Set()), /unknown concept/);
});

test('sortRows is deterministic and picturesFor lists only used concepts', () => {
	const rows = [
		{ language: 'zh', target: 'b', sense: '1', concept: 'B', score: '80' },
		{ language: 'ja', target: 'a', sense: '0', concept: 'A', score: '90' },
		{ language: 'zh', target: 'a', sense: '2', concept: 'C', score: '70' }
	];
	assert.deepEqual(sortRows(rows).map((r) => r.language + r.target), ['jaa', 'zha', 'zhb']);
	const pics = picturesFor(rows, [{ id: 'B', label: 'b', credit: 'c' }, { id: 'A', label: 'a', credit: 'c' }, { id: 'Z', label: 'z', credit: 'c' }]);
	assert.deepEqual(pics.map((p) => [p.concept, p.file]), [['A', 'pictures/A.svg'], ['B', 'pictures/B.svg']]);
});

test('manifestFor states type, format and sorted languages', () => {
	const m = manifestFor({ id: 'images-x', name: 'X', version: '1', license: 'CC BY-SA 4.0', attribution: 'a', notice: '' }, ['zh', 'ja']);
	assert.equal(m.type, 'images');
	assert.equal(m.format, 'images-svg');
	assert.deepEqual(m.languages, ['ja', 'zh']);
});

test('assemblePack writes the pack files for the used concepts only', () => {
	const concepts = [
		{ id: '1F34E', label: 'red apple', credit: 'OpenMoji, Liz Bravo' },
		{ id: '1F415', label: 'dog', credit: 'OpenMoji' }
	];
	const map = formatTsv(MAP_HEADER, [
		{ language: 'zh', target: '苹果', sense: '0', concept: '1F34E', score: '100', basis: 'manual', note: '' },
		{ language: 'ja', target: '林檎', sense: '0', concept: '1F34E', score: '100', basis: 'manual', note: '' }
	]);
	const svg = Buffer.from('<svg viewBox="0 0 72 72"><path d="M0 0"/></svg>');
	const files = assemblePack('openmoji', map, concepts, () => svg, 'LEGAL');
	assert.deepEqual([...files.keys()].sort(), ['ATTRIBUTION.md', 'LICENSE', 'manifest.json', 'map.tsv', 'pictures.tsv', 'pictures/1F34E.svg']);
	const m = JSON.parse(files.get('manifest.json'));
	assert.deepEqual([m.type, m.format, m.languages, m.license, m.id], ['images', 'images-svg', ['ja', 'zh'], 'CC BY-SA 4.0', 'images-openmoji']);
	assert.match(files.get('pictures.tsv'), /1F34E\tpictures\/1F34E.svg\tred apple\tOpenMoji, Liz Bravo/);
	assert.match(files.get('ATTRIBUTION.md'), /All emojis designed by OpenMoji/);
	assert.ok(SPECS.mulberry.notice.length < 4000 && SPECS.openmoji.notice.length < 4000);

	assert.throws(() => assemblePack('openmoji', map, [], () => svg, 'L'), /pinned release does not have/);
	assert.throws(() => assemblePack('openmoji', map, concepts, () => null, 'L'), /missing/);
	assert.throws(() => assemblePack('openmoji', map, concepts, () => Buffer.from('<html></html>'), 'L'), /not an SVG/);
	assert.throws(() => assemblePack('openmoji', map, concepts, () => Buffer.alloc(300 << 10, 'x'), 'L'), /limit/);
});
