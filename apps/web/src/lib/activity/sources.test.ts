import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/events/activity.json';
import { DRILL_IDS } from '$lib/studycore/drills';
import { DRILL_WORDS } from './sources';
import { ACTIVITY_SOURCES, LOG_CHANGING_TYPES, activityLabel, activityText, changesLog } from './sources';

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
		expect([...LOG_CHANGING_TYPES]).toEqual(['review', 'read', 'journal', 'script', 'grammar', ...DRILL_IDS.map((id) => `drill.${id}`)]);
	});

	it('every registered drill is a count source of Practice, worded from the catalogue', () => {
		for (const id of DRILL_IDS) {
			expect(ACTIVITY_SOURCES).toContainEqual({ type: `drill.${id}`, feature: 'practice', unit: 'count' });
			expect(activityLabel({ type: `drill.${id}` })).not.toBe(`drill.${id}`);
		}
	});

	it("a registered drill's words are literal catalogue keys, one pair per registered drill (#180)", () => {
		expect(Object.keys(DRILL_WORDS)).toEqual([...DRILL_IDS]);
		expect(activityLabel({ type: 'drill.tone-pairs' })).toBe('Tone pairs');
		expect(activityText({ type: 'drill.tone-pairs' }, 2, '2')).toBe('2 tone-pair answers');
		expect(activityText({ type: 'drill.tone-pairs' }, 1, '1')).toBe('1 tone-pair answer');
	});

	it('every drill answer changes what the log readers show, a registered drill or not', () => {
		expect(changesLog('review')).toBe(true);
		expect(changesLog('grammar')).toBe(true);
		expect(changesLog('drill.tone-pairs')).toBe(true);
		expect(changesLog('drill.sample')).toBe(true);
		expect(changesLog('drill.weakest')).toBe(false);
		expect(changesLog('lookup')).toBe(false);
	});

	it('word themselves from the catalogue; an unknown type shows its id', () => {
		expect(activityLabel({ type: 'review' })).toBe('Flashcard reviews');
		expect(activityLabel({ type: 'drill' })).toBe('drill');
		expect(activityText({ type: 'journal' }, 1, '1')).toBe('1 journal entry');
		expect(activityText({ type: 'read' }, 7, '7')).toBe('7 minutes of reading');
		expect(activityLabel({ type: 'grammar' })).toBe('Grammar lessons');
		expect(activityText({ type: 'grammar' }, 1, '1')).toBe('1 grammar lesson');
		expect(activityText({ type: 'grammar' }, 3, '3')).toBe('3 grammar lessons');
		expect(activityText({ type: 'drill' }, 2, '2')).toBe('2 drill');
	});
});
