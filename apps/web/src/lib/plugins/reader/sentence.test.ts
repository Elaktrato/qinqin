import { describe, expect, it, vi } from 'vitest';
import {
	SENTENCE_MAX,
	bookSentence,
	normalizeSentence,
	resolveBookSentence,
	sentenceAround,
	type SentenceApi
} from './sentence';

/** Code-point offsets of `word` (its first occurrence at or after `from`) in `text`. */
function span(text: string, word: string, from = 0): [number, number] {
	const cps = Array.from(text);
	const target = Array.from(word);
	for (let i = from; i + target.length <= cps.length; i++) {
		if (target.every((ch, k) => cps[i + k] === ch)) return [i, i + target.length];
	}
	throw new Error(`${word} not in ${text}`);
}

function around(text: string, word: string, from = 0): string {
	return sentenceAround(text, ...span(text, word, from));
}

describe('sentenceAround', () => {
	it('cuts a Japanese paragraph at 。', () => {
		const p = '彼は駅に行った。それから二人は歩き出した。';
		expect(around(p, '駅')).toBe('彼は駅に行った。');
		expect(around(p, '歩き')).toBe('それから二人は歩き出した。');
	});

	it('keeps a quotation followed by narration in one sentence', () => {
		const p = '「行こう。」と彼は言った。それから歩いた。';
		expect(around(p, '言った')).toBe('「行こう。」と彼は言った。');
		expect(around(p, '行こう')).toBe('「行こう。」と彼は言った。');
		expect(around(p, '歩いた')).toBe('それから歩いた。');
	});

	it('keeps the closing bracket with its sentence between two lines of dialogue', () => {
		const p = '「おはよう。」「元気？」';
		expect(around(p, 'おはよう')).toBe('「おはよう。」');
		expect(around(p, '元気')).toBe('「元気？」');
	});

	it('keeps 』 and ） after the full stop', () => {
		const p = '彼は言った。『さようなら。』（終わり。）次の日。';
		expect(around(p, 'さようなら')).toBe('『さようなら。』');
		expect(around(p, '終わり')).toBe('（終わり。）');
		expect(around(p, '次')).toBe('次の日。');
	});

	it('cuts Chinese at 。 ？ ！ and keeps a quoted sentence with its narration', () => {
		const p = '我学习中文。你呢？他说：“我也学。”然后走了！';
		expect(around(p, '中文')).toBe('我学习中文。');
		expect(around(p, '你')).toBe('你呢？');
		expect(around(p, '也')).toBe('他说：“我也学。”然后走了！');
	});

	it('treats a run of terminators as one boundary', () => {
		const p = '本当？！うそ……行かないで！';
		expect(around(p, '本当')).toBe('本当？！');
		expect(around(p, 'うそ')).toBe('うそ……');
		expect(around(p, '行か')).toBe('行かないで！');
	});

	it('cuts Latin text at . ! ? followed by a space (Mr. splits: a known limitation)', () => {
		const p = 'Mr. Smith went home. He slept! Was it 3.5 hours?';
		expect(around(p, 'Smith')).toBe('Smith went home.');
		expect(around(p, 'slept')).toBe('He slept!');
		expect(around(p, 'hours')).toBe('Was it 3.5 hours?');
	});

	it('returns the whole paragraph without punctuation', () => {
		expect(around('春はあけぼの', 'あけぼの')).toBe('春はあけぼの');
	});

	it('handles a word at the very end of the paragraph', () => {
		const p = '最初の文。最後に食べた';
		expect(around(p, '食べた')).toBe('最後に食べた');
		const n = Array.from(p).length;
		expect(sentenceAround(p, n, n)).toBe('最後に食べた');
		expect(sentenceAround(p, n + 5, n + 9)).toBe('最後に食べた');
	});

	it('trims whitespace and ideographic spaces', () => {
		expect(around('　彼は来た。　次は僕だ。 ', '僕')).toBe('次は僕だ。');
	});

	it('caps a very long sentence at 200 code points around the word', () => {
		const p = 'あ'.repeat(300) + '猫' + 'い'.repeat(300) + '。';
		const [start, end] = span(p, '猫');
		const cut = sentenceAround(p, start, end);
		expect(Array.from(cut)).toHaveLength(SENTENCE_MAX);
		expect(cut).toContain('猫');
		// Roughly centred on the word.
		const at = Array.from(cut).indexOf('猫');
		expect(at).toBeGreaterThan(80);
		expect(at).toBeLessThan(120);
	});

	it('keeps the cap inside the sentence near its edges', () => {
		const p = '前。' + '猫' + 'あ'.repeat(400) + '。後。';
		const cut = around(p, '猫');
		expect(cut.startsWith('猫')).toBe(true);
		expect(Array.from(cut)).toHaveLength(SENTENCE_MAX);

		const q = '前。' + 'あ'.repeat(400) + '犬。';
		const end = around(q, '犬');
		expect(end.endsWith('犬。')).toBe(true);
		expect(Array.from(end)).toHaveLength(SENTENCE_MAX);
	});

	it('counts astral characters as one code point', () => {
		const p = '𠮷野家で食べた。𠮷は字だ。';
		expect(sentenceAround(p, 8, 9)).toBe('𠮷は字だ。');
		expect(sentenceAround(p, 4, 6)).toBe('𠮷野家で食べた。');
		expect(sentenceAround(p, 0, 1)).toBe('𠮷野家で食べた。');
	});

	it('is empty for an empty paragraph', () => {
		expect(sentenceAround('', 0, 0)).toBe('');
	});
});

describe('bookSentence', () => {
	it('is the sentence around the word', () => {
		const p = '我学习中文。你呢？';
		expect(bookSentence(p, ...span(p, '中文'))).toBe('我学习中文。');
	});

	it('is empty when the sentence is only the word (a heading, a one-word line)', () => {
		expect(bookSentence('第一章', 0, 3)).toBe('');
		expect(bookSentence('　猫　', 1, 2)).toBe('');
	});
});

describe('normalizeSentence', () => {
	it('collapses and trims whitespace', () => {
		expect(normalizeSentence('  我\n 学习\t中文。 ')).toBe('我 学习 中文。');
		expect(normalizeSentence('　猫だ。　')).toBe('猫だ。');
	});
});

describe('resolveBookSentence', () => {
	function fakeApi(sentences: { id: number; hanzi: string }[] = []) {
		return {
			getEntry: vi.fn(async (_id: number) => ({ sentences })),
			addSentence: vi.fn(async (_id: number, _hanzi: string) => ({ id: 99 }))
		} satisfies SentenceApi;
	}

	it('reuses an identical sentence of the entry instead of posting a duplicate', async () => {
		const api = fakeApi([
			{ id: 3, hanzi: '别的。' },
			{ id: 5, hanzi: '我学习 中文。' }
		]);
		expect(await resolveBookSentence(api, 42, '我学习  中文。')).toEqual({ sentenceId: 5, failed: false });
		expect(api.getEntry).toHaveBeenCalledWith(42);
		expect(api.addSentence).not.toHaveBeenCalled();
	});

	it('posts the sentence text when the entry does not have it', async () => {
		const api = fakeApi([{ id: 3, hanzi: '别的。' }]);
		expect(await resolveBookSentence(api, 42, '我学习中文。')).toEqual({ sentenceId: 99, failed: false });
		expect(api.addSentence).toHaveBeenCalledWith(42, '我学习中文。');
	});

	it('still posts when reading the entry fails', async () => {
		const api = fakeApi();
		api.getEntry.mockRejectedValueOnce(new Error('offline'));
		expect(await resolveBookSentence(api, 42, '我学习中文。')).toEqual({ sentenceId: 99, failed: false });
	});

	it('reports a failed post without an id, never throwing', async () => {
		const api = fakeApi();
		api.addSentence.mockRejectedValueOnce(new Error('400'));
		expect(await resolveBookSentence(api, 42, '我学习中文。')).toEqual({
			sentenceId: undefined,
			failed: true
		});
	});

	it('does nothing for an empty sentence', async () => {
		const api = fakeApi();
		expect(await resolveBookSentence(api, 42, '  ')).toEqual({ sentenceId: undefined, failed: false });
		expect(api.getEntry).not.toHaveBeenCalled();
		expect(api.addSentence).not.toHaveBeenCalled();
	});
});
