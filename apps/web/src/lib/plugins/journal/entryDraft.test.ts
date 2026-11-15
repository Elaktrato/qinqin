import { describe, expect, it } from 'vitest';
import { AUTOSAVE_MS, MAX_REVIEW_CHARS, codePoints, journalEvent, journalEventDue } from './entryDraft';

describe('journalEventDue', () => {
	const day1 = new Date('2026-11-13T10:00:00Z');

	it('is due on the first change of the day, then not again', () => {
		const sent = new Map<string, string>();
		expect(journalEventDue('A', true, day1, sent)).toBe(true);
		expect(journalEventDue('A', true, new Date('2026-11-13T23:59:00Z'), sent)).toBe(false);
	});

	it('is due again the next UTC day', () => {
		const sent = new Map<string, string>();
		journalEventDue('A', true, day1, sent);
		expect(journalEventDue('A', true, new Date('2026-11-14T00:01:00Z'), sent)).toBe(true);
	});

	it('is never due for unchanged text and does not record it', () => {
		const sent = new Map<string, string>();
		expect(journalEventDue('A', false, day1, sent)).toBe(false);
		expect(sent.size).toBe(0);
		expect(journalEventDue('A', true, day1, sent)).toBe(true);
	});

	it('tracks entries separately', () => {
		const sent = new Map<string, string>();
		journalEventDue('A', true, day1, sent);
		expect(journalEventDue('B', true, day1, sent)).toBe(true);
	});
});

describe('journalEvent', () => {
	it('builds a journal study event', () => {
		const now = new Date('2026-11-13T10:00:00Z');
		const e = journalEvent(7, 'A', now);
		expect(e).toMatchObject({
			workspaceId: 7,
			device: 'web',
			ts: now.toISOString(),
			type: 'journal',
			payload: { entryId: 'A' }
		});
		expect(e.id).toMatch(/^[0-9A-Z]{26}$/);
	});
});

describe('limits', () => {
	it('counts code points', () => {
		expect(codePoints('😀a')).toBe(2);
		expect(codePoints('')).toBe(0);
		expect(MAX_REVIEW_CHARS).toBe(5000);
		expect(AUTOSAVE_MS).toBe(1500);
	});
});
