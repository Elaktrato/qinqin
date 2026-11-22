import { describe, expect, it } from 'vitest';
import { buildExercises, clozeParts, convertLesson, firstTry } from './exercises';
import type { Example, Lesson } from './types';

function example(id: string, over: Partial<Example> = {}): Example {
	return {
		id,
		text: '我是学生。',
		reading: '',
		translation: 'I am a student.',
		focus: '是',
		distractors: ['很', '在'],
		...over
	};
}

function lesson(examples: Example[]): Lesson {
	return {
		id: 'shi',
		level: 'a1-1',
		title: 't',
		summary: 's',
		pattern: [],
		body: ['b'],
		examples
	};
}

describe('clozeParts', () => {
	it('blanks only the first occurrence', () => {
		expect(clozeParts('是不是学生是', '是')).toEqual({ before: '', after: '不是学生是' });
	});
	it('returns null when focus is empty or missing', () => {
		expect(clozeParts('我是学生', '')).toBeNull();
		expect(clozeParts('我是学生', '吗')).toBeNull();
	});
});

describe('buildExercises', () => {
	const four = lesson([1, 2, 3, 4].map((n) => example(`shi-${n}`)));

	it('makes a cloze and an order per example', () => {
		const ex = buildExercises(four, 'seed');
		expect(ex).toHaveLength(8);
		expect(ex.slice(0, 4).every((e) => e.kind === 'cloze')).toBe(true);
		expect(ex.slice(4).every((e) => e.kind === 'order')).toBe(true);
	});

	it('has no cloze for an example with one distractor or no focus', () => {
		const l = lesson([
			example('a', { distractors: ['很'] }),
			example('b', { focus: '', distractors: [] })
		]);
		const ex = buildExercises(l, 'seed');
		expect(ex.filter((e) => e.kind === 'cloze')).toHaveLength(0);
		expect(ex.filter((e) => e.kind === 'order')).toHaveLength(2);
	});

	it('skips the order exercise for a noOrder example but keeps its cloze', () => {
		const l = lesson([example('a', { noOrder: true }), example('b')]);
		const ex = buildExercises(l, 'seed');
		expect(ex.filter((e) => e.kind === 'cloze')).toHaveLength(2);
		const orders = ex.filter((e) => e.kind === 'order');
		expect(orders).toHaveLength(1);
		expect(orders[0].example.id).toBe('b');
	});

	it('choices hold focus and distractors, stable per seed', () => {
		const a = buildExercises(four, 'x')[0];
		const b = buildExercises(four, 'x')[0];
		if (a.kind !== 'cloze' || b.kind !== 'cloze') throw new Error('expected cloze');
		expect([...a.choices].sort()).toEqual(['是', '很', '在'].sort());
		expect(a.choices).toEqual(b.choices);
	});

	it('orders examples by seed deterministically', () => {
		const ids = (s: string) =>
			buildExercises(four, s)
				.slice(4)
				.map((e) => e.example.id);
		expect(ids('q')).toEqual(ids('q'));
		expect([...ids('q')].sort()).toEqual(['shi-1', 'shi-2', 'shi-3', 'shi-4']);
	});
});

describe('convertLesson', () => {
	it('converts focus and distractors with the text so the gap is found', () => {
		const l = lesson([
			example('ge-1', { text: '这个人', focus: '个', distractors: ['的', '很'] })
		]);
		const out = convertLesson(l, (s) => s.replaceAll('个', '個'));
		const ex = out.examples[0];
		expect(ex.text).toBe('这個人');
		expect(ex.focus).toBe('個');
		expect(clozeParts(ex.text, ex.focus)).toEqual({ before: '这', after: '人' });
		expect(l.examples[0].focus).toBe('个');
	});
	it('leaves the reading alone', () => {
		const l = lesson([example('a', { reading: 'wǒ shì' })]);
		expect(convertLesson(l, () => 'X').examples[0].reading).toBe('wǒ shì');
	});
});

describe('convertLesson text', () => {
	it('converts title, summary, pattern and body too', () => {
		const l = { ...lesson([example('a')]), title: '个', summary: '个s', pattern: ['A + 个'], body: ['个 text'] };
		const out = convertLesson(l, (s) => s.replaceAll('个', '個'));
		expect(out.title).toBe('個');
		expect(out.summary).toBe('個s');
		expect(out.pattern).toEqual(['A + 個']);
		expect(out.body).toEqual(['個 text']);
	});
});

describe('firstTry', () => {
	it('is right only without wrong checks or giving up', () => {
		expect(firstTry({ wrongChecks: 0, gaveUp: false })).toBe(true);
		expect(firstTry({ wrongChecks: 1, gaveUp: false })).toBe(false);
		expect(firstTry({ wrongChecks: 0, gaveUp: true })).toBe(false);
	});
});

describe('buildExercises order', () => {
	it('never puts the word order of an example right after its own cloze', () => {
		const l = lesson([1, 2, 3, 4].map((n) => example(`shi-${n}`)));
		for (let i = 0; i < 40; i++) {
			const ex = buildExercises(l, `seed${i}`);
			const lastCloze = ex[3].example.id;
			expect(ex[4].kind).toBe('order');
			expect(ex[4].example.id).not.toBe(lastCloze);
			expect(ex.slice(4).map((e) => e.example.id).sort()).toEqual(['shi-1', 'shi-2', 'shi-3', 'shi-4']);
		}
	});
	it('keeps a single-example lesson working', () => {
		expect(buildExercises(lesson([example('a')]), 's')).toHaveLength(2);
	});
});
