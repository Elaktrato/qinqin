import { describe, expect, it, vi } from 'vitest';
import type { Entry, SearchHit } from '$lib/api/types';
import type { DisplayLesson } from '$lib/features/grammar/lessonData';
import { courseKnownIndex, loadCharacterInfo, loadGrammarItems, loadWordInfo } from './lessonData';
import { history } from '$lib/testing/study';
import { IDENTITY_CLOCK } from '$lib/studycore/studyClock';
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

	it('loadGrammarItems: the gap exercises of each available point; a missing or failing lesson gives none', async () => {
		const lesson = {
			id: 'shi',
			examples: [
				{ id: 'e1', text: '我是学生。', reading: '', translation: 'I am a student.', focus: '是', distractors: ['有', '在'] },
				{ id: 'e2', text: '他很好。', reading: '', translation: 'He is well.', focus: '', distractors: [] }
			]
		};
		const load = vi.fn(async (pack: string, id: string) => {
			if (id === 'gone') return null;
			if (id === 'boom') throw new TypeError('offline');
			return { lesson, view: { pack: { language: 'zh' } }, textLang: 'zh-Hans' } as unknown as DisplayLesson;
		});
		const items = await loadGrammarItems(['g:shi', 'g:gone', 'g:boom', 'bad'], load);
		expect([...items.keys()]).toEqual(['g:shi']);
		const [item] = items.get('g:shi')!;
		expect(item).toMatchObject({ id: 'e1', before: '我', after: '学生。', answer: '是', translation: 'I am a student.' });
		expect([...item.choices].sort()).toEqual(['在', '是', '有']);
		expect(load).toHaveBeenCalledTimes(3);
	});

	it('courseKnownIndex: the shared predicate index over the history (marks, carded words)', () => {
		const index = courseKnownIndex(history({ known: [5], cards: [{ id: 'c1', kind: 'vocab', entryId: 6, deckIds: [], createdAt: '' }] as never }), IDENTITY_CLOCK);
		expect(index.marks.has(5)).toBe(true);
		expect(index.carded.has(6)).toBe(true);
	});
});
