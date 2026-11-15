import { describe, expect, it } from 'vitest';
import { studyDay } from '../../time/studyDay';
import { AUTOSAVE_MS, MAX_REVIEW_CHARS, codePoints, journalEventDue } from './entryDraft';

const UTC = studyDay([]);
const TOKYO = studyDay([{ zone: 'Asia/Tokyo', from: null }]);

describe('journalEventDue', () => {
	const day1 = new Date('2026-11-13T10:00:00Z');

	it('is due on the first change of the day, then not again', () => {
		const sent = new Map<string, string>();
		expect(journalEventDue('A', true, day1, sent, UTC.dayOf)).toBe(true);
		expect(journalEventDue('A', true, new Date('2026-11-13T23:59:00Z'), sent, UTC.dayOf)).toBe(false);
	});

	it('is due again the next UTC day', () => {
		const sent = new Map<string, string>();
		journalEventDue('A', true, day1, sent, UTC.dayOf);
		expect(journalEventDue('A', true, new Date('2026-11-14T00:01:00Z'), sent, UTC.dayOf)).toBe(true);
	});

	it('is never due for unchanged text and does not record it', () => {
		const sent = new Map<string, string>();
		expect(journalEventDue('A', false, day1, sent, UTC.dayOf)).toBe(false);
		expect(sent.size).toBe(0);
		expect(journalEventDue('A', true, day1, sent, UTC.dayOf)).toBe(true);
	});

	it('is due once per local day: Tokyo midnight falls inside one UTC day', () => {
		const sent = new Map<string, string>();
		expect(journalEventDue('A', true, new Date('2026-11-13T14:00:00Z'), sent, TOKYO.dayOf)).toBe(true); // 23:00 on the 13th
		expect(journalEventDue('A', true, new Date('2026-11-13T14:50:00Z'), sent, TOKYO.dayOf)).toBe(false);
		expect(journalEventDue('A', true, new Date('2026-11-13T15:05:00Z'), sent, TOKYO.dayOf)).toBe(true); // 00:05 on the 14th
		expect(journalEventDue('A', true, new Date('2026-11-13T20:00:00Z'), sent, TOKYO.dayOf)).toBe(false);
	});

	it('tracks entries separately', () => {
		const sent = new Map<string, string>();
		journalEventDue('A', true, day1, sent, UTC.dayOf);
		expect(journalEventDue('B', true, day1, sent, UTC.dayOf)).toBe(true);
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
