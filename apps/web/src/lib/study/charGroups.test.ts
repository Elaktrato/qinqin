import { describe, expect, it, vi } from 'vitest';
import type { CharRow, Scheme } from '$lib/api/types';
import type { CharMastery } from './mastery';
import { MASTERY_THRESHOLD as MASTERY_SOURCE, stageOf } from './mastery';
import {
	MASTERY_THRESHOLD,
	buildSections,
	cellStates,
	dataGap,
	filterCells,
	groupOptions,
	masteryGlyphs,
	sectionStats,
	type SchemeLevelMembers,
	type CellState,
	type GroupKey,
	type Section
} from './charGroups';

function row(i: number, c: string, extra: Partial<CharRow> = {}): CharRow {
	return { i, c, ...extra };
}

function labels(sections: Section[]): string[] {
	return sections.map((s) => s.label);
}

function glyphs(section: Section | undefined): string[] {
	return (section?.chars ?? []).map((c) => c.c);
}

function bySection(sections: Section[], label: string): Section | undefined {
	return sections.find((s) => s.label === label);
}

function mastery(score: number, reviewedCards = score > 0 ? 1 : 0): CharMastery {
	return { score, stage: stageOf(score), reviewedCards };
}

function scheme(id: number, name: string, language: string, packId?: string, levels: string[] = []): Scheme {
	return {
		id,
		name,
		unit: 'word',
		language,
		...(packId !== undefined ? { packId } : {}),
		levels: levels.map((levelName, index) => ({ id: id * 100 + index, ord: index + 1, name: levelName }))
	};
}

// mulberry32: a tiny deterministic PRNG so the property checks are
// reproducible.
function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(rand: () => number, values: readonly T[]): T {
	return values[Math.floor(rand() * values.length)];
}

function randomChars(rand: () => number, count: number): CharRow[] {
	const out: CharRow[] = [];
	for (let n = 0; n < count; n++) {
		const c = String.fromCodePoint(0x4e00 + n);
		const r: CharRow = { i: n + 1, c };
		const maybe = <T>(values: readonly T[]): T | undefined =>
			rand() < 0.35 ? undefined : pick(rand, values);
		const s = maybe([1, 2, 3, 7, 12, 29, 0, -1, 2.5]);
		if (s !== undefined) r.s = s;
		const g = maybe([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0]);
		if (g !== undefined) r.g = g;
		const f = maybe([1, 500, 501, 1000, 1499, 2000, 2001, 2500, 2501, 4000, 0, -3]);
		if (f !== undefined) r.f = f;
		const t = maybe([1, 0, 2]);
		if (t !== undefined) r.t = t;
		const b = maybe([1, 2, 3, 0]);
		if (b !== undefined) r.b = b;
		const h = maybe([1, 2, 3, 4, 5, 6, 7, 0]);
		if (h !== undefined) r.h = h;
		if (rand() < 0.2) r.v = [String.fromCodePoint(0x9000 + n)];
		out.push(r);
	}
	return out;
}

const ALL_FIXED_KEYS: GroupKey[] = ['grade', 'freq', 'strokes', 'common', 'hkgrade'];

describe('groupOptions', () => {
	const hsk = ['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6', 'HSK 7–9'];
	// The packs of a seeded server: the two samples, the bundled HSK 3.0
	// characters and words and JLPT kanji, and a locally installed JLPT
	// vocabulary (optional, not bundled).
	const schemes: Scheme[] = [
		scheme(1, 'HSK mini (sample)', 'zh', 'hsk-mini', ['1', '2']),
		scheme(2, 'HSK 3.0 (characters)', 'zh', 'hsk-chars', hsk),
		scheme(3, 'HSK 3.0 (words)', 'zh', 'hsk-words', hsk),
		scheme(4, 'JLPT (kanji)', 'ja', 'jlpt-kanji', ['N5', 'N4', 'N3', 'N2', 'N1']),
		scheme(5, 'JLPT N5 mini (sample)', 'ja', 'jlpt-mini', ['N5']),
		scheme(6, 'hsk-mini', 'zh'),
		scheme(12, 'JLPT mini', 'ja'),
		scheme(13, 'JLPT (vocabulary)', 'ja', 'jlpt-words', ['N5', 'N4', 'N3', 'N2', 'N1'])
	];

	it('offers grade, frequency, strokes and the non-sample ja schemes (JLPT kanji, a locally installed JLPT vocabulary) for ja', () => {
		expect(groupOptions('ja', schemes)).toEqual([
			{ key: 'grade', label: 'Grade' },
			{ key: 'freq', label: 'Frequency' },
			{ key: 'strokes', label: 'Strokes' },
			{ key: 'scheme:4', label: 'JLPT (kanji)' },
			{ key: 'scheme:13', label: 'JLPT (vocabulary)' }
		]);
	});

	it('has no built-in JLPT grouping: the pre-2010 scale is gone', () => {
		expect(groupOptions('ja', []).map((o) => o.label)).toEqual(['Grade', 'Frequency', 'Strokes']);
	});

	it('offers common, HK grade, strokes and the non-sample zh schemes (the bundled HSK 3.0 characters and words) for zh', () => {
		expect(groupOptions('zh', schemes)).toEqual([
			{ key: 'common', label: 'Common' },
			{ key: 'hkgrade', label: 'HK primary grade' },
			{ key: 'strokes', label: 'Strokes' },
			{ key: 'scheme:2', label: 'HSK 3.0 (characters)' },
			{ key: 'scheme:3', label: 'HSK 3.0 (words)' }
		]);
	});

	it('matches the language by its primary subtag', () => {
		expect(groupOptions('zh-TW', schemes).map((o) => o.key)).toEqual([
			'common',
			'hkgrade',
			'strokes',
			'scheme:2',
			'scheme:3'
		]);
	});

	it('tells schemes of the same name apart by pack id', () => {
		const both = [
			scheme(2, 'HSK 3.0 (characters)', 'zh', 'hsk-chars', hsk),
			scheme(3, 'HSK 3.0 (words)', 'zh', 'hsk-words', hsk),
			scheme(14, 'HSK 3.0 (characters)', 'zh', 'hsk30-chars', hsk)
		];
		expect(groupOptions('zh', both).slice(3)).toEqual([
			{ key: 'scheme:2', label: 'HSK 3.0 (characters) · hsk-chars' },
			{ key: 'scheme:3', label: 'HSK 3.0 (words)' },
			{ key: 'scheme:14', label: 'HSK 3.0 (characters) · hsk30-chars' }
		]);
	});

	it('keeps a user pack whose name looks like a sample when its pack id differs', () => {
		const own = [scheme(10, 'HSK Mini', 'zh', 'my-own'), scheme(11, 'JLPT N5 mini (sample)', 'ja', 'mine')];
		expect(groupOptions('zh', own).some((o) => o.key === 'scheme:10')).toBe(true);
		expect(groupOptions('ja', own).some((o) => o.key === 'scheme:11')).toBe(true);
	});

	it('hides the bundled samples by pack id even when renamed', () => {
		const renamed = [scheme(7, 'My list', 'zh', 'hsk-mini'), scheme(8, 'Other list', 'ja', 'jlpt-mini')];
		expect(groupOptions('zh', renamed).some((o) => o.key === 'scheme:7')).toBe(false);
		expect(groupOptions('ja', renamed).some((o) => o.key === 'scheme:8')).toBe(false);
	});

	it('offers nothing for a non-Han language', () => {
		expect(groupOptions('es', [scheme(9, 'Spanish levels', 'es', 'es-lv')])).toEqual([]);
	});
});

describe('buildSections: ja grade', () => {
	const chars = [
		row(1, '一', { g: 1 }),
		row(2, '右', { g: 1 }),
		row(3, '引', { g: 2 }),
		row(4, '悪', { g: 3 }),
		row(5, '愛', { g: 4 }),
		row(6, '圧', { g: 5 }),
		row(7, '異', { g: 6 }),
		row(8, '亜', { g: 8 }),
		row(9, '丑', { g: 9 }),
		row(10, '乃', { g: 10 }),
		row(11, '亅'),
		row(12, '乂', { g: 7 })
	];

	it('uses the fixed grade order and labels', () => {
		expect(labels(buildSections(chars, 'grade'))).toEqual([
			'Grade 1',
			'Grade 2',
			'Grade 3',
			'Grade 4',
			'Grade 5',
			'Grade 6',
			'Secondary (grade 8)',
			'Names (jinmeiyō, 9–10)',
			'Not graded'
		]);
	});

	it('keeps input order inside a section and merges grades 9 and 10', () => {
		const sections = buildSections(chars, 'grade');
		expect(glyphs(bySection(sections, 'Grade 1'))).toEqual(['一', '右']);
		expect(glyphs(bySection(sections, 'Names (jinmeiyō, 9–10)'))).toEqual(['丑', '乃']);
	});

	it('puts missing and unknown grades under Not graded', () => {
		expect(glyphs(bySection(buildSections(chars, 'grade'), 'Not graded'))).toEqual(['亅', '乂']);
	});

	it('omits empty sections', () => {
		expect(labels(buildSections([row(1, '一', { g: 2 })], 'grade'))).toEqual(['Grade 2']);
		expect(buildSections([], 'grade')).toEqual([]);
	});

	it('gives each section a distinct id', () => {
		const ids = buildSections(chars, 'grade').map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('buildSections: ja frequency', () => {
	it('buckets ranks by 500 and ends with Not ranked', () => {
		const chars = [
			row(1, 'a', { f: 1 }),
			row(2, 'b', { f: 500 }),
			row(3, 'c', { f: 501 }),
			row(4, 'd', { f: 1000 }),
			row(5, 'e', { f: 1001 }),
			row(6, 'f', { f: 1501 }),
			row(7, 'g', { f: 2001 }),
			row(8, 'h', { f: 2500 }),
			row(9, 'i'),
			row(10, 'j', { f: 0 })
		];
		const sections = buildSections(chars, 'freq');
		expect(labels(sections)).toEqual([
			'1–500',
			'501–1000',
			'1001–1500',
			'1501–2000',
			'2001–2501',
			'Not ranked'
		]);
		expect(glyphs(bySection(sections, '1–500'))).toEqual(['a', 'b']);
		expect(glyphs(bySection(sections, '2001–2501'))).toEqual(['g', 'h']);
		expect(glyphs(bySection(sections, 'Not ranked'))).toEqual(['i', 'j']);
	});

	it('folds every rank above 2000 into the one last bucket 2001–2501', () => {
		const sections = buildSections(
			[row(1, 'z'), row(2, 'y', { f: 2501 }), row(3, 'x', { f: 2001 }), row(4, 'w', { f: 4000 })],
			'freq'
		);
		expect(labels(sections)).toEqual(['2001–2501', 'Not ranked']);
		expect(glyphs(bySection(sections, '2001–2501'))).toEqual(['y', 'x', 'w']);
	});
});

describe('buildSections: strokes', () => {
	it('orders by stroke count with singular for one stroke, unknown last', () => {
		const chars = [
			row(1, 'a', { s: 12 }),
			row(2, 'b', { s: 1 }),
			row(3, 'c', { s: 2 }),
			row(4, 'd'),
			row(5, 'e', { s: 2 }),
			row(6, 'f', { s: 0 })
		];
		const sections = buildSections(chars, 'strokes');
		expect(labels(sections)).toEqual(['1 stroke', '2 strokes', '12 strokes', 'Stroke count unknown']);
		expect(glyphs(bySection(sections, '2 strokes'))).toEqual(['c', 'e']);
		expect(glyphs(bySection(sections, 'Stroke count unknown'))).toEqual(['d', 'f']);
	});
});

describe('buildSections: zh common', () => {
	it('applies b=1 → level 1, b=2 → level 2, else t=1 → other standard, else other', () => {
		const chars = [
			row(1, '的', { b: 1, t: 1 }),
			row(2, '亍', { b: 2, t: 1 }),
			row(3, '叕', { b: 2 }),
			row(4, '昇', { t: 1 }),
			row(5, '兙'),
			row(6, '一', { b: 1 }),
			row(7, '㐀', { b: 3, t: 0 })
		];
		const sections = buildSections(chars, 'common');
		expect(labels(sections)).toEqual([
			'GB2312 level 1 (common)',
			'GB2312 level 2',
			'Other standard characters',
			'Other characters in the dictionary'
		]);
		expect(glyphs(bySection(sections, 'GB2312 level 1 (common)'))).toEqual(['的', '一']);
		expect(glyphs(bySection(sections, 'GB2312 level 2'))).toEqual(['亍', '叕']);
		expect(glyphs(bySection(sections, 'Other standard characters'))).toEqual(['昇']);
		expect(glyphs(bySection(sections, 'Other characters in the dictionary'))).toEqual(['兙', '㐀']);
	});
});

describe('buildSections: zh HK grade', () => {
	it('orders primary grades 1–6 then No grade', () => {
		const chars = [row(1, 'a', { h: 6 }), row(2, 'b', { h: 1 }), row(3, 'c'), row(4, 'd', { h: 7 })];
		const sections = buildSections(chars, 'hkgrade');
		expect(labels(sections)).toEqual([
			'Primary grade 1 (Hong Kong)',
			'Primary grade 6 (Hong Kong)',
			'No grade'
		]);
		expect(glyphs(bySection(sections, 'No grade'))).toEqual(['c', 'd']);
	});
});

describe('buildSections: scheme', () => {
	const members: SchemeLevelMembers[] = [
		{ levelId: 11, name: 'HSK 1', chars: new Set(['你', '好']) },
		{ levelId: 12, name: 'HSK 2', chars: new Set(['银', '好', '愛']) }
	];

	it('keys sections by level id so levels with equal names stay apart', () => {
		const twins: SchemeLevelMembers[] = [
			{ levelId: 1, name: 'Core', chars: new Set(['你']) },
			{ levelId: 2, name: 'Core', chars: new Set(['好']) }
		];
		const sections = buildSections([row(1, '好'), row(2, '你')], 'scheme:5', twins);
		expect(sections.map((s) => [s.id, s.label, glyphs(s)])).toEqual([
			['level-1', 'Core', ['你']],
			['level-2', 'Core', ['好']]
		]);
	});

	it('uses the member list order, then Not in this scheme', () => {
		const chars = [row(1, '银'), row(2, '你'), row(3, '好'), row(4, '龘')];
		const sections = buildSections(chars, 'scheme:3', members);
		expect(labels(sections)).toEqual(['HSK 1', 'HSK 2', 'Not in this scheme']);
		expect(glyphs(bySection(sections, 'HSK 1'))).toEqual(['你', '好']);
		expect(glyphs(bySection(sections, 'HSK 2'))).toEqual(['银']);
		expect(glyphs(bySection(sections, 'Not in this scheme'))).toEqual(['龘']);
	});

	it('matches a variant form when the glyph itself is not a member', () => {
		const sections = buildSections([row(1, '爱', { v: ['愛'] })], 'scheme:3', members);
		expect(glyphs(bySection(sections, 'HSK 2'))).toEqual(['爱']);
	});

	it('puts everything under Not in this scheme without members', () => {
		const sections = buildSections([row(1, '你')], 'scheme:3');
		expect(labels(sections)).toEqual(['Not in this scheme']);
	});
});

describe('buildSections: property checks', () => {
	for (const seed of [1, 7, 42, 1234, 99999]) {
		it(`every char lands in exactly one section for every key (seed ${seed})`, () => {
			const rand = prng(seed);
			const chars = randomChars(rand, 400);
			const members: SchemeLevelMembers[] = [
				{ levelId: 1, name: 'A', chars: new Set(chars.filter(() => rand() < 0.2).map((c) => c.c)) },
				{ levelId: 2, name: 'B', chars: new Set(chars.filter(() => rand() < 0.2).map((c) => c.c)) }
			];
			const keys: GroupKey[] = [...ALL_FIXED_KEYS, 'scheme:1'];
			for (const key of keys) {
				const sections = buildSections(chars, key, members);
				const seen = sections.flatMap((s) => s.chars.map((c) => c.i));
				expect(seen.length, key).toBe(chars.length);
				expect(new Set(seen).size, key).toBe(chars.length);
				expect(sections.every((s) => s.chars.length > 0), key).toBe(true);
				for (const section of sections) {
					const order = section.chars.map((c) => c.i);
					expect([...order].sort((a, b) => a - b), key).toEqual(order);
				}
			}
		});
	}
});

describe('cellStates and masteryGlyphs', () => {
	it('lists every glyph including variants, once each', () => {
		const chars = [row(1, '爱', { v: ['愛'] }), row(2, '人'), row(3, '愛', { v: ['爱'] })];
		expect(masteryGlyphs(chars)).toEqual(['爱', '愛', '人']);
	});

	it('lights the simplified cell from a card written with the traditional form', () => {
		const chars = [row(1, '爱', { v: ['愛'] })];
		const map = new Map([
			['爱', mastery(0)],
			['愛', mastery(85, 2)]
		]);
		const [cell] = cellStates(chars, map);
		expect(cell.score).toBe(85);
		expect(cell.stage).toBe('learned');
		expect(cell.reviewedCards).toBe(2);
		expect(cell.char).toBe(chars[0]);
	});

	it('takes the maximum, not the sum, over the character and its variants', () => {
		const chars = [row(1, '爱', { v: ['愛', '㤅'] })];
		const map = new Map([
			['爱', mastery(40, 3)],
			['愛', mastery(45, 1)],
			['㤅', mastery(10, 1)]
		]);
		const [cell] = cellStates(chars, map);
		expect(cell.score).toBe(45);
		expect(cell.stage).toBe('learning');
		expect(cell.reviewedCards).toBe(1);
	});

	it('treats a glyph missing from the mastery map as unknown', () => {
		const [cell] = cellStates([row(1, '龘')], new Map());
		expect(cell).toMatchObject({ score: 0, stage: 'unknown', reviewedCards: 0 });
	});

	it('property: score is the max of the per-glyph scores', () => {
		const rand = prng(5);
		const chars = randomChars(rand, 300);
		const map = new Map<string, CharMastery>();
		for (const glyph of masteryGlyphs(chars)) {
			if (rand() < 0.5) map.set(glyph, mastery(Math.floor(rand() * 101)));
		}
		const cells = cellStates(chars, map);
		expect(cells).toHaveLength(chars.length);
		cells.forEach((cell, index) => {
			const forms = [chars[index].c, ...(chars[index].v ?? [])];
			const expected = Math.max(...forms.map((f) => map.get(f)?.score ?? 0));
			expect(cell.score).toBe(expected);
			expect(cell.stage).toBe(stageOf(expected));
		});
	});
});

function cell(c: string, score: number, extra: Partial<CharRow> = {}): CellState {
	return { char: row(0, c, extra), score, stage: stageOf(score), reviewedCards: score > 0 ? 1 : 0 };
}

describe('sectionStats', () => {
	it('counts learned at the threshold and every stage', () => {
		const cells = [cell('a', 0), cell('b', 10), cell('c', 30), cell('d', 79), cell('e', 80), cell('f', 100)];
		expect(MASTERY_THRESHOLD).toBe(80);
		expect(MASTERY_THRESHOLD).toBe(MASTERY_SOURCE);
		expect(stageOf(MASTERY_SOURCE)).toBe('learned');
		expect(stageOf(MASTERY_SOURCE - 1)).toBe('mature');
		expect(sectionStats(cells)).toEqual({
			total: 6,
			learned: 2,
			byStage: { unknown: 1, fresh: 1, learning: 1, mature: 1, learned: 2 }
		});
	});

	it('returns zeros for an empty section', () => {
		expect(sectionStats([])).toEqual({
			total: 0,
			learned: 0,
			byStage: { unknown: 0, fresh: 0, learning: 0, mature: 0, learned: 0 }
		});
	});

	it('property: totals equal the section sizes and the stage counts add up', () => {
		const rand = prng(11);
		const chars = randomChars(rand, 500);
		const map = new Map<string, CharMastery>();
		for (const glyph of masteryGlyphs(chars)) map.set(glyph, mastery(Math.floor(rand() * 101)));
		const cells = cellStates(chars, map);
		const byId = new Map(cells.map((c) => [c.char.i, c]));
		for (const key of ALL_FIXED_KEYS) {
			let overall = 0;
			for (const section of buildSections(chars, key)) {
				const stats = sectionStats(section.chars.map((c) => byId.get(c.i)!));
				expect(stats.total).toBe(section.chars.length);
				const stageSum = Object.values(stats.byStage).reduce((a, b) => a + b, 0);
				expect(stageSum).toBe(stats.total);
				expect(stats.learned).toBe(stats.byStage.learned);
				overall += stats.total;
			}
			expect(overall).toBe(chars.length);
		}
	});
});

describe('filterCells', () => {
	const cells = [
		cell('学', 0, { r: 'ガク', m: 'study, learning' }),
		cell('爱', 30, { r: 'ài', m: 'Love', v: ['愛'] }),
		cell('水', 90, { r: 'スイ', m: 'water' }),
		cell('火', 60, { r: 'カ', m: 'fire' }),
		cell('人', 5)
	];
	const glyphsOf = (list: CellState[]) => list.map((c) => c.char.c);

	it('filters by stage', () => {
		expect(glyphsOf(filterCells(cells, 'all', ''))).toEqual(['学', '爱', '水', '火', '人']);
		expect(glyphsOf(filterCells(cells, 'not-started', ''))).toEqual(['学']);
		expect(glyphsOf(filterCells(cells, 'learning', ''))).toEqual(['爱', '火', '人']);
		expect(glyphsOf(filterCells(cells, 'learned', ''))).toEqual(['水']);
	});

	it('searches the glyph, a variant, the reading and the gloss case-insensitively', () => {
		expect(glyphsOf(filterCells(cells, 'all', '水'))).toEqual(['水']);
		expect(glyphsOf(filterCells(cells, 'all', '愛'))).toEqual(['爱']);
		expect(glyphsOf(filterCells(cells, 'all', 'がく'))).toEqual(['学']);
		expect(glyphsOf(filterCells(cells, 'all', 'ガク'))).toEqual(['学']);
		expect(glyphsOf(filterCells(cells, 'all', 'love'))).toEqual(['爱']);
		expect(glyphsOf(filterCells(cells, 'all', '  WAT '))).toEqual(['水']);
		expect(glyphsOf(filterCells(cells, 'all', 'ài'))).toEqual(['爱']);
	});

	it('normalises the query and the fields with NFKC', () => {
		// Half-width katakana and full-width Latin fold to their NFKC forms.
		expect(glyphsOf(filterCells(cells, 'all', 'ｶﾞｸ'))).toEqual(['学']);
		expect(glyphsOf(filterCells(cells, 'all', 'ＦＩＲＥ'))).toEqual(['火']);
		// A decomposed accent matches the precomposed reading.
		expect(glyphsOf(filterCells(cells, 'all', 'ài'))).toEqual(['爱']);
	});

	it('combines the stage filter and the query', () => {
		expect(glyphsOf(filterCells(cells, 'learned', 'fire'))).toEqual([]);
		expect(glyphsOf(filterCells(cells, 'learning', 'fire'))).toEqual(['火']);
	});

	it('finds toneless pinyin and folds tone marks in the query too', () => {
		const zh = [cell('好', 0, { r: 'hǎo', m: 'good' }), cell('女', 0, { r: 'nǚ', m: 'woman' })];
		expect(glyphsOf(filterCells(zh, 'all', 'hao'))).toEqual(['好']);
		expect(glyphsOf(filterCells(zh, 'all', 'HÁO'))).toEqual(['好']);
		expect(glyphsOf(filterCells(zh, 'all', 'nu'))).toEqual(['女']);
	});

	it('folds hiragana to katakana on both sides but keeps the dakuten', () => {
		const ja = [cell('日', 0, { r: 'ニチ' }), cell('学', 0, { r: 'ガク' }), cell('角', 0, { r: 'かく' })];
		expect(glyphsOf(filterCells(ja, 'all', 'にち'))).toEqual(['日']);
		expect(glyphsOf(filterCells(ja, 'all', 'カク'))).toEqual(['角']);
		expect(glyphsOf(filterCells(ja, 'all', 'がく'))).toEqual(['学']);
	});

	it('folds each character once, however many queries run', () => {
		const many = Array.from({ length: 50 }, (_, n) => ({
			char: row(n, String.fromCodePoint(0x4e00 + n), { r: 'ニチ', m: 'day', v: ['x'] }),
			score: 0,
			stage: stageOf(0),
			reviewedCards: 0
		}));
		const spy = vi.spyOn(String.prototype, 'normalize');
		try {
			filterCells(many, 'all', 'd');
			const afterFirst = spy.mock.calls.length;
			const queries = ['da', 'day', 'mo', 'moon', 'にち'];
			for (const q of queries) filterCells(many, 'all', q);
			// Later queries normalise only the query itself, never the 50 rows again.
			expect(spy.mock.calls.length - afterFirst).toBeLessThanOrEqual(queries.length * 3);
		} finally {
			spy.mockRestore();
		}
	});
});

describe('scheme sections', () => {
	it('the lowest level wins when built into sections', () => {
		const levels: SchemeLevelMembers[] = [
			{ levelId: 1, name: '1', chars: new Set(['你', '好']) },
			{ levelId: 2, name: '2', chars: new Set(['好', '看']) }
		];
		const sections = buildSections([row(1, '好'), row(2, '看')], 'scheme:1', levels);
		expect(sections.map((s) => [s.label, glyphs(s)])).toEqual([
			['1', ['好']],
			['2', ['看']]
		]);
	});
});

describe('dataGap', () => {
	function fill(count: number, withField: number, field: Partial<CharRow>): CharRow[] {
		return Array.from({ length: count }, (_, n) => row(n, String(n), n < withField ? field : {}));
	}

	it('is true when at least 90 % lack the grouping field', () => {
		expect(dataGap(fill(100, 10, { g: 1 }), 'grade')).toBe(true);
		expect(dataGap(fill(100, 11, { g: 1 }), 'grade')).toBe(false);
		expect(dataGap(fill(100, 50, { f: 9 }), 'freq')).toBe(false);
		expect(dataGap(fill(100, 5, { s: 3 }), 'strokes')).toBe(true);
		expect(dataGap(fill(100, 5, { h: 3 }), 'hkgrade')).toBe(true);
	});

	it('counts either the standard-list or the GB2312 field for common', () => {
		expect(dataGap(fill(100, 20, { t: 1 }), 'common')).toBe(false);
		expect(dataGap(fill(100, 20, { b: 2 }), 'common')).toBe(false);
		expect(dataGap(fill(100, 3, { b: 1 }), 'common')).toBe(true);
	});

	it('looks only at the chosen grouping field', () => {
		expect(dataGap(fill(100, 100, { s: 3 }), 'grade')).toBe(true);
	});

	it('is false for an empty list and for scheme groupings', () => {
		expect(dataGap([], 'grade')).toBe(false);
		expect(dataGap(fill(100, 0, {}), 'scheme:2')).toBe(false);
	});
});
