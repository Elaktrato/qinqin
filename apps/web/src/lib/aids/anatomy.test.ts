import { describe, expect, it, vi } from 'vitest';
import { MAX_PARTS, anatomyOf, loadAnatomy, meaningIndex } from './anatomy';

const chars = { 語: ['言', '口', '吾', '五', '二'], 明: ['日', '月'], 木: ['木'], 一: [] as string[] };
const meanings = new Map([
	['言', 'say'],
	['口', 'mouth'],
	['日', 'sun']
]);

describe('anatomyOf', () => {
	it('lists the parts of a character in the pack order with their meanings', () => {
		const parts = anatomyOf('語', chars, meanings);
		expect(parts.map((p) => p.glyph)).toEqual(['言', '口', '吾', '五', '二']);
		expect(parts[0]).toEqual({ glyph: '言', meaning: 'say', isRadical: false });
		expect(parts[2].meaning).toBeNull();
	});

	it('marks the part that is the character\'s radical', () => {
		expect(anatomyOf('語', chars, meanings, '言').map((p) => p.isRadical)).toEqual([true, false, false, false, false]);
	});

	it('leaves out the character itself and has nothing for a character with no parts or none in the pack', () => {
		expect(anatomyOf('木', chars, meanings)).toEqual([]);
		expect(anatomyOf('一', chars, meanings)).toEqual([]);
		expect(anatomyOf('猫', chars, meanings)).toEqual([]);
	});

	it('shows at most MAX_PARTS parts, each once', () => {
		const many = { 字: ['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] };
		const parts = anatomyOf('字', many, new Map());
		expect(parts).toHaveLength(MAX_PARTS);
		expect(new Set(parts.map((p) => p.glyph)).size).toBe(MAX_PARTS);
	});

	it('works on the first character of a longer string only when given one character', () => {
		expect(anatomyOf('明日', chars, meanings)).toEqual([]);
	});
});

describe('meaningIndex', () => {
	it('maps a character to its first gloss and ignores rows without one', () => {
		const index = meaningIndex([
			{ c: '日', m: 'sun' },
			{ c: '月' },
			{ c: '口', m: '' }
		]);
		expect(index.get('日')).toBe('sun');
		expect(index.has('月')).toBe(false);
		expect(index.has('口')).toBe(false);
	});
});

describe('loadAnatomy', () => {
	it('combines the components and the character universe', async () => {
		const parts = await loadAnatomy('明', {
			components: async () => ({ chars }),
			universe: async () => [{ c: '日', m: 'sun' }]
		});
		expect(parts).toEqual([
			{ glyph: '日', meaning: 'sun', isRadical: false },
			{ glyph: '月', meaning: null, isRadical: false }
		]);
	});

	it('shows the parts without meanings when the character list fails, and nothing when the components fail', async () => {
		const failing = vi.fn(async () => {
			throw new Error('down');
		});
		const withoutMeanings = await loadAnatomy('明', { components: async () => ({ chars }), universe: failing });
		expect(withoutMeanings.map((p) => p.meaning)).toEqual([null, null]);
		expect(await loadAnatomy('明', { components: failing, universe: async () => [] })).toEqual([]);
	});
});
