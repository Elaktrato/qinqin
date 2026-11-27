import { describe, expect, it } from 'vitest';
import list from '../../../../../docs/contracts/topics/topics.json';
import en from '$lib/i18n/messages/en.json';
import { TOPIC_IDS, TOPIC_NAMES, isTopicId } from './topics';

describe('topics (docs/contracts/topics/topics.json)', () => {
	it('has the contract list in its order', () => {
		expect(list.rule).toBe('topics/list');
		expect([...TOPIC_IDS]).toEqual(list.topics.map((t) => t.id));
	});

	it('names every topic from the catalogue', () => {
		for (const id of TOPIC_IDS) {
			expect(TOPIC_NAMES[id]).toBe((en as Record<string, string>)[`topics.name.${id}`]);
			expect(TOPIC_NAMES[id].length).toBeGreaterThan(0);
		}
	});

	it('tells a known id from one of a newer list', () => {
		expect(isTopicId('food')).toBe(true);
		expect(isTopicId('beverages')).toBe(false);
	});
});
