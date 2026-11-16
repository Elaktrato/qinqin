import { describe, expect, it } from 'vitest';
import rowsFixture from '../../../../../docs/contracts/notes/note-rows.json';
import textFixture from '../../../../../docs/contracts/notes/note-text.json';
import {
	NOTE_CFG_KEY,
	NOTE_MAX_CHARS,
	NOTE_PREFIX,
	noteChars,
	noteKey,
	normalizeNoteText,
	notesByEntry,
	parseNote,
	parseNoteCfg,
	serializeNote,
	serializeNoteCfg
} from './notes';

interface RowCase {
	name: string;
	op: 'note' | 'cfg';
	input: { key: string; data: unknown; deletedAt: string | null };
	expect: unknown;
}

describe('docs/contracts/notes/note-rows.json', () => {
	it('is the notes/rows fixture', () => {
		expect(rowsFixture.version).toBe(1);
		expect(rowsFixture.rule).toBe('notes/rows');
		expect(rowsFixture.cases.length).toBeGreaterThan(20);
	});

	it.each((rowsFixture.cases as RowCase[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
		// A tombstone is absent before parsing: the SDK and the sync layer drop deleted rows.
		const live = c.input.deletedAt === null;
		if (c.op === 'note') {
			expect(live ? parseNote(c.input.key, c.input.data) : null).toEqual(c.expect);
		} else {
			expect(parseNoteCfg(live ? c.input.data : null)).toEqual(c.expect);
		}
	});
});

describe('docs/contracts/notes/note-text.json', () => {
	it('is the notes/text fixture with the cap', () => {
		expect(textFixture.rule).toBe('notes/text');
		expect(textFixture.maxChars).toBe(NOTE_MAX_CHARS);
		expect(NOTE_MAX_CHARS).toBe(2000);
	});

	it.each(textFixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
		expect(normalizeNoteText(c.input)).toEqual(c.expect);
	});
});

describe('note keys', () => {
	it('builds note:<id> for positive integers only', () => {
		expect(NOTE_PREFIX).toBe('note:');
		expect(NOTE_CFG_KEY).toBe('notecfg');
		expect(noteKey(1201)).toBe('note:1201');
		for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => noteKey(bad)).toThrow();
		}
	});

	it('counts code points', () => {
		expect(noteChars('马😀a')).toBe(3);
		expect(noteChars('')).toBe(0);
	});
});

describe('serializeNote', () => {
	it('writes version, entryId and text', () => {
		expect(serializeNote(5, 'hi')).toEqual({ version: 1, entryId: 5, text: 'hi' });
	});

	it('keeps the unknown members of the previous row and lets ours win', () => {
		const previous = parseNote('note:5', {
			version: 1,
			entryId: 5,
			text: 'old',
			attachments: [{ id: 'a' }]
		});
		const out = serializeNote(5, 'new', previous);
		expect(out).toEqual({ attachments: [{ id: 'a' }], version: 1, entryId: 5, text: 'new' });
		expect(parseNote('note:5', out)).toEqual({ entryId: 5, text: 'new', extra: { attachments: [{ id: 'a' }] } });
	});

	it('round-trips through parseNote', () => {
		expect(parseNote('note:9', serializeNote(9, 'a\nb'))).toEqual({ entryId: 9, text: 'a\nb', extra: {} });
	});
});

describe('notecfg', () => {
	it('serializes and keeps unknown members', () => {
		expect(serializeNoteCfg(false)).toEqual({ version: 1, onAnswer: false });
		const prev = parseNoteCfg({ version: 1, onAnswer: true, later: 'x' });
		expect(serializeNoteCfg(false, prev)).toEqual({ later: 'x', version: 1, onAnswer: false });
		expect(parseNoteCfg(serializeNoteCfg(false, prev))).toEqual({ onAnswer: false, extra: { later: 'x' } });
	});
});

describe('notesByEntry', () => {
	it('maps entry ids to text and skips other keys and invalid rows', () => {
		const map = notesByEntry([
			{ key: 'note:1', data: { version: 1, entryId: 1, text: 'one' } },
			{ key: 'note:2', data: { version: 1, entryId: 3, text: 'mismatch' } },
			{ key: 'note:4', data: { version: 2, entryId: 4, text: 'future' } },
			{ key: 'notecfg', data: { version: 1, onAnswer: false } },
			{ key: 'home-layout', data: { version: 1, entryId: 5, text: 'not a note' } },
			{ key: 'note:6', data: JSON.stringify({ version: 1, entryId: 6, text: 'six' }) }
		]);
		expect([...map.entries()]).toEqual([
			[1, 'one'],
			[6, 'six']
		]);
	});
});
