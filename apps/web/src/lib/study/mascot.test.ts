import { describe, expect, it } from 'vitest';

import { mascotState } from './mascot';

describe('mascotState', () => {
	it('picks the stage by level', () => {
		const stage = (level: number) => mascotState({ level, streak: 0, todayDone: false }).stage;
		expect([1, 4, 5, 9, 10, 19, 20, 99].map(stage)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
	});

	it('is sleepy when today is not done and a streak is at risk', () => {
		expect(mascotState({ level: 1, streak: 3, todayDone: false }).mood).toBe('sleepy');
		expect(mascotState({ level: 1, streak: 40, todayDone: false }).mood).toBe('sleepy');
	});

	it('is happy with no streak or a short one', () => {
		expect(mascotState({ level: 1, streak: 0, todayDone: false }).mood).toBe('happy');
		expect(mascotState({ level: 1, streak: 0, todayDone: true }).mood).toBe('happy');
		expect(mascotState({ level: 1, streak: 6, todayDone: true }).mood).toBe('happy');
	});

	it('is proud at 7 and cheering at 30 once today is done', () => {
		expect(mascotState({ level: 1, streak: 7, todayDone: true }).mood).toBe('proud');
		expect(mascotState({ level: 1, streak: 29, todayDone: true }).mood).toBe('proud');
		expect(mascotState({ level: 1, streak: 30, todayDone: true }).mood).toBe('cheering');
	});

	it('builds the asset path', () => {
		expect(mascotState({ level: 12, streak: 7, todayDone: true }).assetPath).toBe(
			'/mascot/3-proud.svg'
		);
	});
});
