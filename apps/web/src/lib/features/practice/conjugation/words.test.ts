// The route's answer (docs/contracts/conjugation/words.json) read defensively, and the calls in chunks of 500.
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../../../../../docs/contracts/conjugation/words.json';
import { WORDS_CHUNK, loadConjugationWords, parseWords } from './words';

describe('the conjugation words (POST /api/drills/conjugation/words)', () => {
	it('reads the contract answer', () => {
		const words = parseWords({ words: fixture.words.map((w, i) => ({ id: i + 1, ...w })) });
		expect(words.map((w) => w.written)).toEqual(fixture.words.map((w) => w.written));
		const taberu = words.find((w) => w.written === '食べる')!;
		expect(taberu.class).toBe('v1');
		expect(taberu.forms['polite-past'][0]).toEqual({ written: '食べました', reading: 'たべました', romaji: 'tabemashita' });
		expect(taberu.forms.potential.map((a) => a.written)).toEqual(['食べられる', '食べれる']);
		expect(taberu.families).toContain('te-form');
	});

	it('drops what it cannot read', () => {
		const good = { id: 1, class: 'v1', written: '見る', reading: 'みる', readings: [], families: ['past'], forms: { past: [{ written: '見た', reading: 'みた', romaji: 'mita' }] } };
		expect(parseWords(null)).toEqual([]);
		expect(parseWords({ words: 'x' })).toEqual([]);
		expect(parseWords({ words: [good, { ...good, id: 'x' }, { ...good, id: 2, forms: { past: [{ written: 1 }] } }, { ...good, id: 3, families: 'past' }] }).map((w) => w.id)).toEqual([1, 2]);
		expect(parseWords({ words: [{ ...good, id: 2, forms: { past: [{ written: 1 }] } }] })[0].forms).toEqual({});
	});

	it('asks in chunks of 500 and keys the words by entry id', async () => {
		const api = vi.fn(async (_path: string, opts: { body: { ids: number[] } }) => ({
			words: opts.body.ids.slice(0, 1).map((id) => ({ id, class: 'v1', written: 'w', reading: 'わ', readings: [], families: [], forms: {} }))
		}));
		const ids = Array.from({ length: WORDS_CHUNK + 1 }, (_, i) => i + 1);
		const words = await loadConjugationWords(api as never, ids);
		expect(api).toHaveBeenCalledTimes(2);
		expect(api.mock.calls[0][0]).toBe('/api/drills/conjugation/words');
		expect(api.mock.calls[1][1].body.ids).toEqual([WORDS_CHUNK + 1]);
		expect([...words.keys()]).toEqual([1, WORDS_CHUNK + 1]);
		expect(await loadConjugationWords(api as never, [])).toEqual(new Map());
		expect(api).toHaveBeenCalledTimes(2);
	});
});
