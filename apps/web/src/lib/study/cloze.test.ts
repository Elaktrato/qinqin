import { describe, expect, it } from 'vitest';

import fixture from '../../../../../docs/contracts/cards/cloze.json';
import {
	acceptedClozeAnswers,
	blankSpans,
	clozeMode,
	clozeCandidates,
	clozePrompt,
	eligibleSentences,
	normalizeAnswer,
	pickDistractors,
	resolveClozeShowing,
	sentenceForShowing,
	suggestClozeGrade,
	type ClozePart
} from './cloze';

interface Case {
	name: string;
	cardId: string;
	entry: { id: number; written: string; forms?: { text: string }[] };
	sentences: { id: number; hanzi: string }[];
	matchesBySentence: Record<string, { start: number; end: number; entries: { id: number }[] }[]>;
	reviews: number;
	eligibleIds: number[];
	shownId: number | null;
	spans: [number, number][];
	before: ClozePart[];
	after: ClozePart[];
	answer: string;
}

describe('cloze contract', () => {
	for (const c of fixture.cases as unknown as Case[]) {
		it(c.name, () => {
			const spansOf = (s: { id: number; hanzi: string }) =>
				blankSpans(s.hanzi, c.entry, c.matchesBySentence[String(s.id)] ?? []);
			const eligible = eligibleSentences(clozeCandidates(c.sentences), spansOf);
			expect(eligible.map((s) => s.id)).toEqual(c.eligibleIds);
			const showing = resolveClozeShowing({
				entry: c.entry,
				sentences: c.sentences,
				matchesOf: (s) => c.matchesBySentence[String(s.id)] ?? [],
				recorded: c.reviews
			});
			expect(showing?.sentence.id ?? null).toBe(c.shownId);
			const shown = sentenceForShowing(eligible, c.reviews);
			expect(shown?.id ?? null).toBe(c.shownId);
			if (shown === null) return;
			const spans = spansOf(shown);
			expect(spans.map((s) => [s.start, s.end])).toEqual(c.spans);
			const prompt = clozePrompt(shown.hanzi, spans);
			expect(prompt.before).toEqual(c.before);
			expect(prompt.after).toEqual(c.after);
			expect(prompt.answer).toBe(c.answer);
		});
	}
});

describe('blankSpans', () => {
	it('drops overlapping and out-of-range segmenter spans', () => {
		const matches = [
			{ start: 1, end: 3, entries: [{ id: 1 }] },
			{ start: 2, end: 4, entries: [{ id: 1 }] },
			{ start: 9, end: 20, entries: [{ id: 1 }] }
		];
		expect(blankSpans('我喜欢茶', { id: 1, written: '喜欢' }, matches)).toEqual([{ start: 1, end: 3 }]);
	});
});

describe('normalizeAnswer and accepted answers', () => {
	it('normalises NFC and removes whitespace', () => {
		expect(normalizeAnswer(' 食 べ る　')).toBe('食べる');
		expect(normalizeAnswer('é')).toBe('é');
	});

	it('folds full-width and half-width forms an IME produces (NFKC), case and edge punctuation', () => {
		expect(normalizeAnswer('ＡＢＣ１２３')).toBe('abc123');
		expect(normalizeAnswer('ｶﾀｶﾅ')).toBe('カタカナ');
		expect(normalizeAnswer('食べる。')).toBe('食べる');
		expect(normalizeAnswer('「食べる」')).toBe('食べる');
		expect(normalizeAnswer('Hello!')).toBe('hello');
		expect(normalizeAnswer('ｷﾞﾀｰ')).toBe(normalizeAnswer('ギター'));
	});

	it('keeps the script and the long vowel mark: hiragana and katakana are different answers', () => {
		expect(normalizeAnswer('コーヒー')).not.toBe(normalizeAnswer('こーひー'));
		expect(normalizeAnswer('コーヒー')).toBe('コーヒー');
	});

	it('accepts the surface; a written/form surface also accepts the other forms and variants', () => {
		const entry = { written: '食べる', forms: [{ text: '食べます' }], variants: [{ written: '喰べる' }] };
		expect([...acceptedClozeAnswers('食べます', entry)].sort()).toEqual(
			['食べる', '食べます', '喰べる'].sort()
		);
		expect([...acceptedClozeAnswers('食べました', entry)]).toEqual(['食べました']);
	});
});

describe('pickDistractors', () => {
	const input = {
		answer: '喜欢',
		sentence: '我喜欢茶，苹果很好。',
		candidates: ['喜欢', '苹果', '朋友', '学习', '电', '工作', '朋友'],
		seed: 'c-cloze-1:0'
	};

	it('returns up to 3, same length first, never the answer or a string in the sentence', () => {
		const out = pickDistractors(input);
		expect(out).toHaveLength(3);
		expect(out).not.toContain('喜欢');
		expect(out).not.toContain('苹果');
		expect(new Set(out).size).toBe(3);
		expect(out.every((c) => [...c].length === 2)).toBe(true);
	});

	it('is deterministic for a seed and input order', () => {
		expect(pickDistractors(input)).toEqual(pickDistractors({ ...input, candidates: [...input.candidates].reverse() }));
	});

	it('falls back to other lengths when too few match, and may return fewer than 3', () => {
		const out = pickDistractors({ ...input, candidates: ['电', '朋友', '喜欢'] });
		expect(out.sort()).toEqual(['朋友', '电'].sort());
	});
});

describe('clozeMode', () => {
	const base = { tier: 0 as const, answer: '食べる', entryForms: ['食べる', '食べます'], distractors: ['a', 'b', 'c'] };
	it('chooses at tier 0 with 3 distractors for an uninflected answer', () => {
		expect(clozeMode(base)).toBe('choose');
	});
	it('types for higher tiers, inflected answers or fewer than 3 distractors', () => {
		expect(clozeMode({ ...base, tier: 1 })).toBe('type');
		expect(clozeMode({ ...base, answer: '食べました' })).toBe('type');
		expect(clozeMode({ ...base, distractors: ['a', 'b'] })).toBe('type');
	});
});

describe('suggestClozeGrade', () => {
	it('is Good for a right answer and Again otherwise, never Easy', () => {
		expect(suggestClozeGrade({ correct: true, gaveUp: false })).toBe(3);
		expect(suggestClozeGrade({ correct: false, gaveUp: false })).toBe(1);
		expect(suggestClozeGrade({ correct: false, gaveUp: true })).toBe(1);
		expect(suggestClozeGrade({ correct: true, gaveUp: true })).toBe(1);
	});
});

describe('sentenceForShowing', () => {
	it('is null without eligible sentences', () => {
		expect(sentenceForShowing([], 3)).toBeNull();
	});
});

describe('resolveClozeShowing', () => {
	const entry = { id: 1, written: '喜欢' };
	const sentences = [
		{ id: 11, hanzi: '我喜欢茶。' },
		{ id: 12, hanzi: '今天很好。' },
		{ id: 15, hanzi: '他喜欢猫。' }
	];
	const input = { entry, sentences, matchesOf: () => [] };

	it('rotates by recorded reviews over the eligible sentences', () => {
		expect(resolveClozeShowing({ ...input, recorded: 0 })?.sentence.id).toBe(11);
		expect(resolveClozeShowing({ ...input, recorded: 1 })?.sentence.id).toBe(15);
		expect(resolveClozeShowing({ ...input, recorded: 2 })?.sentence.id).toBe(11);
	});

	it('a fixed sentence (an Again re-show) wins while it is still eligible', () => {
		expect(resolveClozeShowing({ ...input, recorded: 0, fixedSentenceId: 15 })?.sentence.id).toBe(15);
		expect(resolveClozeShowing({ ...input, recorded: 1, fixedSentenceId: 12 })?.sentence.id).toBe(15);
	});

	it('returns the prompt and null when nothing is eligible', () => {
		const shown = resolveClozeShowing({ ...input, recorded: 0 })!;
		expect(shown.prompt).toEqual({ before: ['我'], after: ['茶。'], answer: '喜欢' });
		expect(resolveClozeShowing({ ...input, sentences: [sentences[1]], recorded: 0 })).toBeNull();
	});
});

describe('clozeCandidates', () => {
	it('keeps the first 8 non-blank sentences in order', () => {
		const list = [{ id: 0, hanzi: ' ' }, ...Array.from({ length: 10 }, (_, i) => ({ id: i + 1, hanzi: 'x' }))];
		expect(clozeCandidates(list).map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});
});

describe('literal fallback and longer matches', () => {
	it('skips an occurrence inside a strictly longer match, keeps one inside an equal-length match', () => {
		const entry = { id: 7, written: '日本' };
		expect(blankSpans('日本語を話す', entry, [{ start: 0, end: 3, entries: [{ id: 8 }] }])).toEqual([]);
		expect(blankSpans('日本語を話す', entry, [{ start: 0, end: 2, entries: [{ id: 9 }] }])).toEqual([{ start: 0, end: 2 }]);
	});
});

describe('extra gaps keep their own surface', () => {
	it('records each later span text on its gap', () => {
		const prompt = clozePrompt('食べて、食べた。', [
			{ start: 0, end: 2 },
			{ start: 4, end: 6 }
		]);
		expect(prompt.answer).toBe('食べ');
		expect(prompt.after).toEqual(['て、', { gap: true, answer: '食べ' }, 'た。']);
		const other = clozePrompt('食べて、食べた。', [
			{ start: 0, end: 3 },
			{ start: 4, end: 7 }
		]);
		expect(other.after[1]).toEqual({ gap: true, answer: '食べた' });
	});
});
