import { describe, expect, it, vi } from 'vitest';
import { PracticeRound } from './round.svelte';

const entries = [
	{ drill: 'sample', item: { key: 'a' } },
	{ drill: 'sample', item: { key: 'b' } }
];

describe('PracticeRound', () => {
	it('asks each entry once, records each answer once, then is done', async () => {
		const record = vi.fn(async () => true);
		const round = new PracticeRound(entries, record);
		expect(round.current?.item.key).toBe('a');
		expect(round.position).toEqual({ n: 1, of: 2 });
		expect(round.answered).toBe(false);

		await round.answer({ mode: 'self', grade: 3 });
		await round.answer({ mode: 'self', grade: 1 });
		expect(record).toHaveBeenCalledTimes(1);
		expect(record).toHaveBeenCalledWith(entries[0], { mode: 'self', grade: 3 });
		expect(round.answered).toBe(true);

		round.next();
		expect(round.current?.item.key).toBe('b');
		expect(round.answered).toBe(false);
		round.next();
		expect(round.current?.item.key).toBe('b');

		await round.answer({ mode: 'self', grade: 1 });
		round.next();
		expect(round.done).toBe(true);
		expect(round.current).toBeNull();
		expect(round.result).toEqual({ right: 1, total: 2, missed: [entries[1]] });
	});

	it('says when an answer was not kept (its workspace is gone)', async () => {
		const round = new PracticeRound(entries, async () => false);
		await round.answer({ mode: 'self', grade: 3 });
		expect(round.notSaved).toBe(true);
		expect(round.answered).toBe(true);
	});

	it('an empty round is done at once', () => {
		const round = new PracticeRound([], async () => true);
		expect(round.done).toBe(true);
		expect(round.result).toEqual({ right: 0, total: 0, missed: [] });
	});
});
