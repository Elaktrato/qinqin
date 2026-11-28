// Checking a typed answer (IME output, kana or kanji) and the choices of a question.
import { describe, expect, it } from 'vitest';
import { checkTyped, normaliseAnswer, produceChoices, recogniseChoices, shownAnswer } from './check';
import type { ConjugationWord } from './words';

const a = (written: string, reading: string) => ({ written, reading, romaji: '' });
const taberu: ConjugationWord = {
	id: 1,
	class: 'v1',
	written: '食べる',
	reading: 'たべる',
	readings: [],
	families: ['polite', 'past', 'potential', 'passive', 'causative'],
	forms: {
		polite: [a('食べます', 'たべます')],
		past: [a('食べた', 'たべた')],
		'past-negative': [a('食べなかった', 'たべなかった')],
		potential: [a('食べられる', 'たべられる'), a('食べれる', 'たべれる')],
		passive: [a('食べられる', 'たべられる')],
		causative: [a('食べさせる', 'たべさせる')]
	}
};
const seq = (...values: number[]) => {
	let i = 0;
	return () => values[i++ % values.length];
};

describe('checking a typed answer', () => {
	it('normalises the IME output: width, spaces, katakana', () => {
		expect(normaliseAnswer(' タベマシタ ')).toBe('たべました');
		expect(normaliseAnswer('食べ　ました')).toBe('食べました');
		expect(normaliseAnswer('ｶﾞｯｺｳ')).toBe('がっこう');
	});

	it('accepts the canonical answer and the alternatives, in kanji or in kana', () => {
		expect(checkTyped('食べられる', taberu.forms.potential)).toBe('canonical');
		expect(checkTyped('たべられる', taberu.forms.potential)).toBe('canonical');
		expect(checkTyped('食べれる', taberu.forms.potential)).toBe('accepted');
		expect(checkTyped('タベレル', taberu.forms.potential)).toBe('accepted');
		expect(checkTyped('食べれる', taberu.forms.passive)).toBe('wrong');
		expect(checkTyped('', taberu.forms.past)).toBe('wrong');
		expect(checkTyped('たべた。', taberu.forms.past)).toBe('canonical');
	});

	it('shows the canonical answer', () => {
		expect(shownAnswer(taberu.forms.past)).toEqual(a('食べた', 'たべた'));
	});
});

describe('the choices', () => {
	it('produce: the answer and three forms that are not right too (never another spelling of it)', () => {
		const choices = produceChoices(taberu, 'potential', seq(0));
		expect(choices).toHaveLength(4);
		expect(choices).toContain('食べられる');
		expect(new Set(choices).size).toBe(4);
		expect(choices).not.toContain('食べれる');
	});

	it('recognise: every form whose answer is the shown one is right, and none of them is a wrong choice', () => {
		const { options, right } = recogniseChoices(taberu, 'potential', seq(0));
		expect(right).toEqual(['potential', 'passive']);
		expect(options).toContain('potential');
		expect(options).not.toContain('passive');
		expect(options).toHaveLength(4);
		const past = recogniseChoices(taberu, 'past', seq(0.9));
		expect(past.right).toEqual(['past']);
		expect(past.options).toContain('past');
	});

	it('works with fewer forms than four', () => {
		const word = { ...taberu, forms: { past: taberu.forms.past, polite: taberu.forms.polite } };
		expect(produceChoices(word, 'past', seq(0)).sort()).toEqual(['食べた', '食べます'].sort());
		expect(recogniseChoices(word, 'past', seq(0)).options.sort()).toEqual(['past', 'polite']);
	});
});
