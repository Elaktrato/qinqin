import { describe, expect, it, vi } from 'vitest';
import type { Entry, SearchHit } from '$lib/api/types';
import { loadCharacterInfo, loadWordInfo } from './lessonData';
import { word } from './testing/course';

const entry = (id: number, gloss: string): Entry => ({ id, senses: gloss ? [{ gloss }] : [] }) as unknown as Entry;

describe('lesson data (#222)', () => {
	it('loadWordInfo: each word with the short gloss of its entry; a failed or empty entry has none', async () => {
		const fetchEntry = vi.fn(async (id: number) => {
			if (id === 2) throw new TypeError('offline');
			return entry(id, id === 3 ? '' : 'hello; hi');
		});
		const info = await loadWordInfo([word('a', 1, 'ā'), word('b', 2), word('c', 3), word('a', 1, 'ā')], fetchEntry);
		expect([...info.values()]).toEqual([
			{ key: 'a', form: 'a', reading: 'ā', entryId: 1, gloss: 'hello' },
			{ key: 'b', form: 'b', reading: '', entryId: 2, gloss: null },
			{ key: 'c', form: 'c', reading: '', entryId: 3, gloss: null }
		]);
		expect(fetchEntry).toHaveBeenCalledTimes(3);
	});

	it('loadCharacterInfo: the character entry a search finds, with its first reading and gloss; none when absent', async () => {
		const hit = { id: 9, kind: 'character', written: '好', readings: [{ type: 'pinyin', value: 'hǎo', plain: 'hao', ord: 0 }], glosses: [{ dictionaryId: 1, gloss: 'good; well' }] } as unknown as SearchHit;
		const searchFn = vi.fn(async (_lang: string, q: string) => (q === '好' ? [{ ...hit, written: '好好', kind: 'word' } as SearchHit, hit] : []));
		const info = await loadCharacterInfo('zh', ['好', '谢'], searchFn);
		expect([...info.entries()]).toEqual([['好', { key: '好', form: '好', reading: 'hǎo', entryId: 9, gloss: 'good' }]]);
		expect(searchFn).toHaveBeenCalledWith('zh', '好', { kind: 'character' });
	});
});
