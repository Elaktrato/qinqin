import { describe, expect, it } from 'vitest';
import { allSystems, systemById, systemsFor } from './packs';
import { composeSyllable, decompose, INITIALS, MEDIALS } from './hangul';
import { romanSyllable } from './hangul';

describe('the script data', () => {
	it('has the four systems, each with unique ids and glyphs', () => {
		expect(allSystems().map((s) => s.id)).toEqual(['hiragana', 'katakana', 'hangul', 'cyrillic']);
		for (const s of allSystems()) {
			expect(new Set(s.items.map((i) => i.id)).size).toBe(s.items.length);
			expect(new Set(s.items.map((i) => i.glyph)).size).toBe(s.items.length);
			for (const i of s.items) {
				expect(s.groups).toContain(i.group);
				expect(i.roman).not.toBe('');
				expect(i.sounds).toContain(i.roman);
			}
		}
	});

	it('has the standard kana charts', () => {
		const h = systemById('hiragana')!;
		const count = (g: string) => h.items.filter((i) => i.group === g).length;
		expect([count('basic'), count('dakuten'), count('handakuten'), count('combo')]).toEqual([46, 20, 5, 33]);
	});

	it('mirrors hiragana as katakana, item by item', () => {
		const h = systemById('hiragana')!.items;
		const k = systemById('katakana')!.items;
		expect(k).toHaveLength(h.length);
		h.forEach((item, n) => {
			expect(k[n].roman).toBe(item.roman);
			expect(k[n].group).toBe(item.group);
			expect([...k[n].glyph].length).toBe([...item.glyph].length);
			expect(k[n].glyph).not.toBe(item.glyph);
		});
		expect(k[0].glyph).toBe('ア');
		expect(k.find((i) => i.roman === 'kya')!.glyph).toBe('キャ');
	});

	it('has 24 basic jamo and 16 more, each with a key', () => {
		const g = systemById('hangul')!;
		expect(g.items.filter((i) => i.group === 'consonant' || i.group === 'vowel')).toHaveLength(24);
		expect(g.items).toHaveLength(40);
		for (const i of g.items) {
			expect(i.key).toBeTruthy();
			expect(decompose(i.sound)).not.toBeNull();
		}
	});

	it('has the 33 Russian letters, with the Latin look-alikes marked', () => {
		const c = systemById('cyrillic')!;
		expect(c.items).toHaveLength(33);
		expect(c.items.filter((i) => i.lookalike).map((i) => i.glyph).sort()).toEqual(['В', 'Н', 'Р', 'С', 'У', 'Х']);
		expect(c.items.find((i) => i.glyph === 'Д')!.lower).toBe('д');
	});

	it('romanises every Hangul example word syllable by syllable, as written', () => {
		for (const w of systemById('hangul')!.words) {
			const parts = [...w.text].map((ch) => romanSyllable(ch));
			expect(parts.every((p) => p !== null), w.text).toBe(true);
		}
		// every word is built only from blocks the learner can compose
		expect(composeSyllable(INITIALS[0], MEDIALS[0])).toBe('가');
	});

	it('uses only the letters of its own system in example words', () => {
		for (const s of allSystems()) {
			const glyphs = new Set(s.items.flatMap((i) => [i.glyph, i.lower ?? i.glyph]));
			expect(s.words.length).toBeGreaterThanOrEqual(20);
			if (s.id === 'hangul') continue;
			for (const w of s.words) {
				for (const ch of w.text) expect(glyphs.has(ch) || glyphs.has(ch.toUpperCase()) || [...glyphs].some((g) => [...g].includes(ch)), `${s.id}:${w.text}:${ch}`).toBe(true);
			}
		}
	});

	it('picks systems by the profile list, in its order, and skips unknown ones', () => {
		expect(systemsFor(['hiragana', 'katakana']).map((s) => s.id)).toEqual(['hiragana', 'katakana']);
		expect(systemsFor(['klingon', 'hangul']).map((s) => s.id)).toEqual(['hangul']);
		expect(systemsFor([])).toEqual([]);
	});
});
