import { describe, expect, it } from 'vitest';
import type { EntryCharacter } from '$lib/api/types';
import { characterMeta, levelLabel } from './characterMeta';

function character(over: Partial<EntryCharacter> = {}): EntryCharacter {
	return {
		id: 1,
		written: '勤',
		reading: null,
		gloss: '',
		radical: null,
		strokes: 0,
		levels: [],
		...over
	};
}

describe('characterMeta (#104)', () => {
	it('says radical, strokes and level when all are known', () => {
		expect(
			characterMeta(
				character({
					radical: { id: 9, written: '力' },
					strokes: 13,
					levels: [{ scheme: 'HSK', level: '5' }]
				})
			)
		).toBe('Radical 力 · 13 strokes · HSK 5');
	});

	it('omits an unknown stroke count instead of printing 0', () => {
		expect(characterMeta(character({ radical: { id: 9, written: '大' } }))).toBe('Radical 大');
		expect(characterMeta(character({ strokes: 8 }))).toBe('8 strokes');
	});

	it('shows the level alone when no meta part is known', () => {
		expect(characterMeta(character({ levels: [{ scheme: 'HSK', level: '3' }] }))).toBe('HSK 3');
	});

	it('is empty without any known part', () => {
		expect(characterMeta(character())).toBe('');
		expect(levelLabel(undefined)).toBe('');
	});
});
