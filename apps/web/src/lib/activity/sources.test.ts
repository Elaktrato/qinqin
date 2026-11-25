import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/events/activity.json';
import { ACTIVITY_SOURCES, LOG_CHANGING_TYPES, activityLabel, activityText } from './sources';

// docs/contracts/events/activity.json `rules` is the server's core table
// (server/internal/stats/rules.go): the client's fallback list follows it.
describe('the activity sources', () => {
	it('are the rules of the core table, in its order', () => {
		expect(ACTIVITY_SOURCES).toEqual(
			fixture.rules.map((r) => ({
				type: r.type,
				feature: r.rule.feature,
				unit: 'measure' in r.rule && r.rule.measure?.field === 'seconds' ? 'seconds' : 'count'
			}))
		);
		expect([...LOG_CHANGING_TYPES]).toEqual(['review', 'read', 'journal', 'script']);
	});

	it('word themselves from the catalogue; an unknown type shows its id', () => {
		expect(activityLabel({ type: 'review' })).toBe('Flashcard reviews');
		expect(activityLabel({ type: 'drill' })).toBe('drill');
		expect(activityText({ type: 'journal' }, 1, '1')).toBe('1 journal entry');
		expect(activityText({ type: 'read' }, 7, '7')).toBe('7 minutes of reading');
		expect(activityText({ type: 'drill' }, 2, '2')).toBe('2 drill');
	});
});
