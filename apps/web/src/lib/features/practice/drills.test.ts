import { describe, expect, it } from 'vitest';
import { DRILL_IDS, validDrillId } from '$lib/studycore/drills';
import { memoryStorage } from '$lib/testing/context';
import { DEV_DRILLS_KEY, DRILLS, availableDrills, devDrills } from './drills';

describe('the drill registry', () => {
	it('offers exactly the registered drills, each a valid id with its own words', () => {
		expect(DRILLS.map((d) => d.id)).toEqual([...DRILL_IDS]);
		for (const d of DRILLS) {
			expect(validDrillId(d.id)).toBe(true);
			expect(d.title).not.toBe('');
			expect(d.description).not.toBe('');
		}
	});

	it('adds the sample drill only behind the developer flag', () => {
		const store = memoryStorage();
		expect(devDrills(store)).toEqual([]);
		store.setItem(DEV_DRILLS_KEY, 'sample');
		expect(devDrills(store).map((d) => d.id)).toEqual(['sample']);
		store.setItem(DEV_DRILLS_KEY, 'something-else');
		expect(devDrills(store)).toEqual([]);
		expect(devDrills(null)).toEqual([]);
		const throwing = { getItem: () => { throw new Error('denied'); } } as unknown as Storage;
		expect(devDrills(throwing)).toEqual([]);
	});

	it('keeps the drills that apply to the language', () => {
		const store = memoryStorage();
		store.setItem(DEV_DRILLS_KEY, 'sample');
		expect(availableDrills('ja', store).map((d) => d.id)).toEqual([...DRILLS.filter((d) => d.appliesTo('ja')).map((d) => d.id), 'sample']);
		expect(availableDrills('ja', memoryStorage()).map((d) => d.id)).toEqual(DRILLS.filter((d) => d.appliesTo('ja')).map((d) => d.id));
	});
});
