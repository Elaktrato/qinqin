import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../docs/contracts/reader/coverage.json';
import type { SegmentMatch } from '$lib/api/types';
import type { Familiarity } from '$lib/study/known';
import { coverageOf, mergeTallies, tallyChapter, unknownList, type ChapterTally } from './coverage';

type FixtureMatch = { start: number; end: number; surface: string; lemma: string; entries: number[] };
const toMatch = (m: FixtureMatch): SegmentMatch => ({
	surface: m.surface,
	start: m.start,
	end: m.end,
	lemma: m.lemma,
	reason: '',
	entries: m.entries.map((id) => ({ id, kind: 'word' as const }))
});
const chapterTally = (n: number, lang: string, paragraphs: string[], matches: FixtureMatch[][]): ChapterTally =>
	tallyChapter(n, lang, paragraphs, new Map(matches.map((list, p) => [p, list.map(toMatch)])));

describe('coverage (reader/coverage.json)', () => {
	it.each(fixture.cases)('$name', (c) => {
		const chapters = 'chapters' in c ? (c.chapters as { paragraphs: string[]; matches: FixtureMatch[][] }[]) : [{ paragraphs: c.paragraphs as string[], matches: c.matches as FixtureMatch[][] }];
		const tally = mergeTallies(chapters.map((ch, n) => chapterTally(n, c.lang, ch.paragraphs, ch.matches)));
		const states = c.states as Record<string, Familiarity>;
		const stateOf = (id: number): Familiarity => states[String(id)] ?? 'new';
		const { unknown, ...figures } = c.expect;
		expect(coverageOf(tally, stateOf)).toEqual(figures);
		expect(unknownList(tally, stateOf).map((t) => ({ entryId: t.entryId, count: t.count, state: t.state }))).toEqual(unknown);
	});

	it('keeps the lemma, the first reading and the first occurrence of a type', () => {
		const m = (start: number, end: number, reading?: string): SegmentMatch => ({
			surface: '食べた',
			start,
			end,
			lemma: '食べる',
			reason: '',
			entries: [{ id: 5, kind: 'word' }],
			...(reading ? { reading: { type: 'kana', value: reading } } : {})
		});
		const tally = tallyChapter(3, 'ja', ['食べた食べた'], new Map([[0, [m(0, 3), m(3, 6, 'たべる')]]]));
		expect(tally.types.get(5)).toEqual({ entryId: 5, count: 2, lemma: '食べる', reading: 'たべる', first: { chapter: 3, p: 0, start: 0 } });
	});

	it('mergeTallies keeps the earliest first occurrence', () => {
		const a = chapterTally(2, 'zh', ['你'], [[{ start: 0, end: 1, surface: '你', lemma: '你', entries: [1] }]]);
		const b = chapterTally(0, 'zh', ['。你'], [[{ start: 1, end: 2, surface: '你', lemma: '你', entries: [1] }]]);
		const merged = mergeTallies([a, b]);
		expect(merged.types.get(1)?.first).toEqual({ chapter: 0, p: 0, start: 1 });
		expect(merged.types.get(1)?.count).toBe(2);
	});

	it('30 000 tokens: tally, coverage and list well inside the budget', () => {
		const texts: string[] = [];
		const matches = new Map<number, SegmentMatch[]>();
		const han = '的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该派够父石';
		const chars = Array.from(han);
		let id = 0;
		for (let p = 0; p < 300; p++) {
			const list: SegmentMatch[] = [];
			let text = '';
			for (let i = 0; i < 100; i++) {
				const ch = chars[(p * 7 + i) % chars.length];
				list.push({ surface: ch, start: i, end: i + 1, lemma: ch, reason: '', entries: [{ id: ((p * 7 + i) % chars.length) + 1, kind: 'word' }] });
				text += ch;
				id++;
			}
			texts.push(text);
			matches.set(p, list);
		}
		expect(id).toBe(30_000);
		const stateOf = (e: number): Familiarity => (e % 3 === 0 ? 'known' : e % 3 === 1 ? 'learning' : 'new');
		const tally = tallyChapter(0, 'zh', texts, matches);
		const cov = coverageOf(tally, stateOf);
		const list = unknownList(tally, stateOf);
		expect(cov.tokens).toBe(30_000);
		expect(list.length).toBeGreaterThan(0);
		// A recompute after a review reads the tally again and gives the same answer.
		expect(coverageOf(tally, stateOf)).toEqual(cov);
		expect(unknownList(tally, stateOf)).toEqual(list);
	});
});
