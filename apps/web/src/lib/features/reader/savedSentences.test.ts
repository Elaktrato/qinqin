import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../../../../docs/contracts/reader/saved-sentences.json';
import type { StudyCard } from '$lib/studycore/types';
import {
	autoSaveApplies,
	normalizeSentence,
	planSentenceSave,
	sameSentence,
	saveBookSentence,
	SENTENCE_SPACE,
	type SaveDeps
} from './savedSentences';

describe('saved sentences (contract reader/saved-sentences.json)', () => {
	it('is version 1 of its rule', () => {
		expect(fixture.version).toBe(1);
		expect(fixture.rule).toBe('reader/saved-sentences');
	});

	it('uses exactly the listed whitespace', () => {
		expect([...SENTENCE_SPACE].sort()).toEqual([...fixture.whitespace].sort());
		for (let cp = 0; cp <= 0xffff; cp++) {
			if (cp >= 0xd800 && cp <= 0xdfff) continue;
			const ch = String.fromCodePoint(cp);
			const folded = normalizeSentence(`a${ch}b`) === 'a b';
			expect(folded, `U+${cp.toString(16)}`).toBe(fixture.whitespace.includes(ch));
		}
	});

	for (const c of fixture.normalize) {
		it(`normalize: ${c.name}`, () => expect(normalizeSentence(c.text)).toBe(c.want));
	}

	for (const c of fixture.same) {
		it(`same: ${c.name}`, () => expect(sameSentence(c.sentences, c.text)?.id ?? null).toBe(c.want));
	}

	for (const c of fixture.plan) {
		it(`plan: ${c.name}`, () => {
			const plan = planSentenceSave({
				entryId: c.entryId,
				entryKind: c.entryKind,
				text: c.text,
				sentences: c.sentences,
				cards: c.cards as StudyCard[]
			});
			expect(plan).toEqual(c.want);
		});
	}

	for (const c of fixture.auto) {
		it(`auto: ${c.name}`, () => {
			expect(
				autoSaveApplies({
					settings: c.settings as Record<string, unknown> | null,
					first: c.first,
					paragraph: c.paragraph,
					entryKind: c.entryKind,
					inStudyAtOpen: c.inStudyAtOpen
				})
			).toBe(c.want);
		});
	}
});

describe('saveBookSentence', () => {
	const vocab: StudyCard = { id: 'v', kind: 'vocab', entryId: 7, written: '学习', deckIds: ['d1'], createdAt: '2026-11-01T00:00:00Z' };

	function deps(over: Partial<SaveDeps> = {}): SaveDeps {
		return {
			cards: vi.fn(async () => [vocab]),
			getEntry: vi.fn(async () => ({ sentences: [{ id: 1, hanzi: '我喜欢学习。' }] })),
			addSentence: vi.fn(async () => ({ id: 9 })),
			addCard: vi.fn(async () => undefined),
			...over
		};
	}

	it('posts a new sentence, then adds its card in the word decks', async () => {
		const d = deps();
		const out = await saveBookSentence(d, { workspaceId: 3, entryId: 7, entryKind: 'word', text: ' 他在学习。' });
		expect(out).toEqual({ outcome: 'saved', sentenceId: 9 });
		expect(d.addSentence).toHaveBeenCalledWith(7, '他在学习。');
		expect(d.addCard).toHaveBeenCalledWith(3, 7, { kind: 'sentence', sentenceId: 9, deckIds: ['d1'], written: '学习' });
	});

	it('adds a card on an existing sentence without posting', async () => {
		const d = deps();
		const out = await saveBookSentence(d, { workspaceId: 3, entryId: 7, entryKind: 'word', text: '我喜欢学习。' });
		expect(out).toEqual({ outcome: 'saved', sentenceId: 1 });
		expect(d.addSentence).not.toHaveBeenCalled();
		expect(d.addCard).toHaveBeenCalledOnce();
	});

	it('writes nothing for an already saved sentence', async () => {
		const d = deps({
			cards: vi.fn(async () => [vocab, { ...vocab, id: 's', kind: 'sentence' as const, sentenceId: 1 }])
		});
		const out = await saveBookSentence(d, { workspaceId: 3, entryId: 7, entryKind: 'word', text: '我喜欢学习。' });
		expect(out).toEqual({ outcome: 'already', sentenceId: 1 });
		expect(d.addSentence).not.toHaveBeenCalled();
		expect(d.addCard).not.toHaveBeenCalled();
	});

	it('saves without a card when the word skips sentence cards', async () => {
		const d = deps({ cards: vi.fn(async () => [{ ...vocab, skipKinds: ['sentence' as const] }]) });
		const out = await saveBookSentence(d, { workspaceId: 3, entryId: 7, entryKind: 'word', text: '他在学习。' });
		expect(out).toEqual({ outcome: 'savedNoCard', sentenceId: 9 });
		expect(d.addCard).not.toHaveBeenCalled();
	});

	it('answers none for a word not in study and asks for nothing more', async () => {
		const d = deps({ cards: vi.fn(async () => []) });
		const out = await saveBookSentence(d, { workspaceId: 3, entryId: 7, entryKind: 'word', text: '他在学习。' });
		expect(out).toEqual({ outcome: 'none' });
		expect(d.getEntry).not.toHaveBeenCalled();
	});

	const source = { bookId: 5, chapter: 2, paragraph: 4, start: 10, end: 12 };

	it('posts the source with a new sentence (#280)', async () => {
		const d = deps();
		await saveBookSentence(d, { workspaceId: 3, entryId: 7, entryKind: 'word', text: '他在学习。', source });
		expect(d.addSentence).toHaveBeenCalledWith(7, '他在学习。', source);
	});

	it('gives an own sentence without a source the source (the server adopts it)', async () => {
		const d = deps({ getEntry: vi.fn(async () => ({ sentences: [{ id: 1, hanzi: '我喜欢学习。', userId: 4 }] })) });
		const out = await saveBookSentence(d, { workspaceId: 3, entryId: 7, entryKind: 'word', text: '我喜欢学习。', source });
		expect(out).toEqual({ outcome: 'saved', sentenceId: 1 });
		expect(d.addSentence).toHaveBeenCalledWith(7, '我喜欢学习。', source);
	});

	it('leaves pack sentences and sourced ones alone', async () => {
		for (const s of [
			{ id: 1, hanzi: '我喜欢学习。', userId: null },
			{ id: 1, hanzi: '我喜欢学习。', userId: 4, source: { kind: 'book', bookId: 6, title: 'B', chapter: 0, paragraph: 0, start: 0, end: 1 } }
		]) {
			const d = deps({ getEntry: vi.fn(async () => ({ sentences: [s] })) });
			await saveBookSentence(d, { workspaceId: 3, entryId: 7, entryKind: 'word', text: '我喜欢学习。', source });
			expect(d.addSentence).not.toHaveBeenCalled();
		}
	});

	it('a failed source adoption does not fail the save', async () => {
		const d = deps({
			getEntry: vi.fn(async () => ({ sentences: [{ id: 1, hanzi: '我喜欢学习。', userId: 4 }] })),
			addSentence: vi.fn(async () => Promise.reject(new Error('422')))
		});
		const out = await saveBookSentence(d, { workspaceId: 3, entryId: 7, entryKind: 'word', text: '我喜欢学习。', source });
		expect(out).toEqual({ outcome: 'saved', sentenceId: 1 });
	});

	it('a failed post throws (the caller reports it)', async () => {
		const d = deps({ addSentence: vi.fn(async () => Promise.reject(new Error('offline'))) });
		await expect(saveBookSentence(d, { workspaceId: 3, entryId: 7, entryKind: 'word', text: '他在学习。' })).rejects.toThrow('offline');
		expect(d.addCard).not.toHaveBeenCalled();
	});
});
