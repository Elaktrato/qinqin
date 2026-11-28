// docs/contracts/notebook/notebook.json: the mistake notebook (#227), decoded through the study history (historyOf).

import { describe, expect, it } from 'vitest';

import fixture from '../../../../../docs/contracts/notebook/notebook.json';
import type { StudyEvent } from '$lib/events';
import { notebookPayload } from '$lib/events/eventPayloads';
import { historyOf } from './readModel';
import {
	DEFAULT_DRILL_GROUP,
	DRILL_GROUPS,
	LEAVE_AFTER,
	MAX_MARK_ITEM_LENGTH,
	NOTEBOOK_EVENT,
	NOTEBOOK_GROUPS,
	PASS_PERCENT,
	notebookItems,
	notebookOutcomes,
	parseNotebookMark
} from './notebook';
import type { StudyCard } from './types';

interface Case {
	name: string;
	cards?: unknown[];
	events: unknown[];
	expect: unknown[];
}

function history(c: Case) {
	const cards = (c.cards ?? fixture.cards) as StudyCard[];
	return historyOf(1, { decks: [], cards: cards.map((card) => ({ ...card, deckIds: [...card.deckIds] })) }, c.events as StudyEvent[]);
}

describe('notebook contract', () => {
	it('constants', () => {
		expect(NOTEBOOK_EVENT).toBe(fixture.constants.eventType);
		expect(LEAVE_AFTER).toBe(fixture.constants.leaveAfter);
		expect(PASS_PERCENT).toBe(fixture.constants.passPercent);
		expect(MAX_MARK_ITEM_LENGTH).toBe(fixture.constants.maxItemLength);
		expect([...NOTEBOOK_GROUPS]).toEqual(fixture.constants.groups);
		expect({ ...DRILL_GROUPS }).toEqual(fixture.constants.drillGroups);
		expect(DEFAULT_DRILL_GROUP).toBe(fixture.constants.defaultDrillGroup);
	});

	for (const c of fixture.build) {
		it(`build: ${c.name}`, () => {
			const input = c.input as { action: 'remove'; item: string } | { action: 'clear' };
			// Member order is part of the shape.
			expect(JSON.stringify(notebookPayload(input))).toBe(JSON.stringify(c.payload));
		});
	}

	for (const c of fixture.parse) {
		it(`parse: ${c.name}`, () => {
			const parsed = parseNotebookMark(c.event as StudyEvent);
			if (c.mark === null) expect(parsed).toBeNull();
			else expect(parsed === null ? null : { action: parsed.action, ...(parsed.action === 'remove' ? { item: parsed.item } : {}) }).toEqual(c.mark);
		});
	}

	for (const c of fixture.outcomes as Case[]) {
		it(`outcomes: ${c.name}`, () => {
			expect(notebookOutcomes(history(c)).map((o) => ({ id: o.id, item: o.item, outcome: o.wrong ? 'wrong' : 'right' }))).toEqual(c.expect);
		});
	}

	for (const c of fixture.notebook as Case[]) {
		it(`notebook: ${c.name}`, () => {
			expect(notebookItems(history(c))).toEqual(c.expect);
		});
	}
});
