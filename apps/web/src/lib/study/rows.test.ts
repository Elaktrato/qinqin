import { describe, expect, it } from 'vitest';

import rowsFixture from '../../../../../docs/contracts/study/rows.json';
import lwwFixture from '../../../../../docs/contracts/study/lww.json';
import codecFixture from '../../../../../docs/contracts/study/legacy-codec.json';
import {
	STUDY_COLLECTIONS,
	activeOf,
	activeRow,
	bodyOf,
	cardOf,
	cardRow,
	deckOf,
	deckRow,
	identityOf,
	legacyFamily,
	limitsOf,
	limitsRow,
	parseRow,
	sameBody,
	serializeRow,
	setOf,
	setRow,
	settingsOf,
	settingsRow,
	studyKey,
	type CardRow,
	type DeckRow,
	type DeckSettingsRow,
	type FsrsActiveRow,
	type FsrsSetRow,
	type LimitsRow,
	type StudyCollection
} from './rows';

interface RowsCase {
	name: string;
	collection: StudyCollection;
	valid: boolean;
	row: Record<string, unknown>;
}

interface LwwCase {
	name: string;
	collection: StudyCollection;
	stored: { row: Record<string, unknown>; modifiedAt: string; deletedAt: string | null } | null;
	push: { updatedAt: string; deletedAt?: string; row: Record<string, unknown> };
	expect: 'applied' | 'skipped' | 'unchanged';
	storedAfter: { row: Record<string, unknown> } | null;
}

const meta = { workspaceId: 7, version: 1, updatedAt: '2026-11-12T10:00:00Z', deletedAt: null };

describe('study rows contract (docs/contracts/study/rows.json)', () => {
	it('names the six collections in wire order', () => {
		expect(STUDY_COLLECTIONS).toEqual(rowsFixture.collections);
	});

	for (const c of rowsFixture.cases as RowsCase[]) {
		it(`${c.collection}: ${c.name}`, () => {
			const parsed = parseRow(c.collection, structuredClone(c.row));
			if (!c.valid) {
				expect(parsed).toBeNull();
				return;
			}
			expect(parsed).not.toBeNull();
			// Encoding back gives the fixture row as JSON values.
			expect(JSON.parse(JSON.stringify(serializeRow(parsed!)))).toEqual(c.row);
			const identity = (rowsFixture.identity as Record<string, string>)[c.collection];
			const want = identity === '' ? '' : ((c.row[identity] as string | null) ?? '');
			expect(identityOf(c.collection, parsed!)).toBe(want);
		});
	}

	it('never parses a row of an unknown collection', () => {
		expect(parseRow('card' as StudyCollection, (rowsFixture.cases as RowsCase[])[0].row)).toBeNull();
	});

	it('drops extra members a set typed member shadows (the server does too)', () => {
		const row = parseRow('cards', {
			...(rowsFixture.cases as RowsCase[])[0].row,
			extra: { kind: 'tone', written: 'kept while written is null', color: 'red' }
		}) as CardRow;
		expect(row.extra).toEqual({ written: 'kept while written is null', color: 'red' });
	});

	it('puts skipKinds in kind order', () => {
		const row = parseRow('cards', {
			...(rowsFixture.cases as RowsCase[])[0].row,
			skipKinds: ['tone', 'sentence']
		}) as CardRow;
		expect(row.skipKinds).toEqual(['sentence', 'tone']);
	});

	it('accepts a push row without version and deletedAt', () => {
		const { version: _v, deletedAt: _d, ...row } = (rowsFixture.cases as RowsCase[])[0].row;
		void _v;
		void _d;
		expect(parseRow('cards', row)).not.toBeNull();
	});
});

describe('lww.json row bodies', () => {
	for (const c of lwwFixture.cases as LwwCase[]) {
		it(`${c.collection}: ${c.name}`, () => {
			const bodies = [c.push.row, c.stored?.row, c.storedAfter?.row].filter(
				(b): b is Record<string, unknown> => b !== undefined
			);
			for (const body of bodies) {
				expect(parseRow(c.collection, { ...body, ...meta })).not.toBeNull();
			}
		});
	}

	it('sameBody finds the equal-content skips', () => {
		for (const c of lwwFixture.cases as LwwCase[]) {
			if (c.stored === null || c.stored.deletedAt !== null || c.push.deletedAt !== undefined) continue;
			const stored = parseRow(c.collection, { ...c.stored.row, ...meta })!;
			const pushed = parseRow(c.collection, { ...c.push.row, ...meta })!;
			// The server writes nothing for equal content ("unchanged", counted accepted).
			const equalSkip = c.expect === 'unchanged';
			expect(sameBody(stored, pushed), c.name).toBe(equalSkip);
		}
	});
});

describe('typed rows <-> study shapes', () => {
	const card = (rowsFixture.cases as RowsCase[]).find((c) => c.name === 'every optional member set')!;

	it('cardOf keeps only set members and cardRow writes every key', () => {
		const row = parseRow('cards', card.row) as CardRow;
		const study = cardOf(row);
		expect(study).toEqual({
			id: 'c-vocab-1201',
			kind: 'vocab',
			entryId: 1201,
			written: '你好',
			entryKind: 'character',
			skipKinds: ['writing', 'tone'],
			deckIds: ['general', '01JDECK0000000000000000001'],
			createdAt: '2026-11-10T08:00:00Z'
		});
		expect(cardRow(study)).toEqual(bodyOf(row));
		const bare = cardOf(parseRow('cards', (rowsFixture.cases as RowsCase[])[0].row) as CardRow);
		expect(bare).toEqual({
			id: 'c-vocab-1201',
			kind: 'vocab',
			entryId: 1201,
			deckIds: ['general'],
			createdAt: '2026-11-10T08:00:00Z'
		});
		expect(cardRow(bare, { color: 'red' })).toMatchObject({ written: null, sentenceId: null, extra: { color: 'red' } });
	});

	it('extra passes through unchanged', () => {
		const withExtra = (rowsFixture.cases as RowsCase[]).find((c) => c.name.startsWith('extra members'))!;
		const row = parseRow('cards', withExtra.row) as CardRow;
		expect(row.extra).toEqual(withExtra.row.extra);
		expect(cardRow(cardOf(row), row.extra)).toEqual(bodyOf(row));
	});

	it('decks round-trip with every source variant', () => {
		for (const c of (rowsFixture.cases as RowsCase[]).filter((x) => x.collection === 'decks' && x.valid)) {
			const row = parseRow('decks', c.row) as DeckRow;
			expect(deckRow(deckOf(row), row.extra)).toEqual(bodyOf(row));
		}
	});

	it('deck settings keep their order and an unreadable one in extra', () => {
		for (const c of (rowsFixture.cases as RowsCase[]).filter((x) => x.collection === 'deckSettings' && x.valid)) {
			const row = parseRow('deckSettings', c.row) as DeckSettingsRow;
			const settings = settingsOf(row);
			expect(settings.extra).toEqual(row.extra);
			expect(settingsRow(settings)).toEqual(bodyOf(row));
		}
	});

	it('limitsOf maps null / {limit: null} / {limit: n} to absent / null / n', () => {
		const at = (n: unknown, r: unknown) =>
			parseRow('limits', { ...meta, deckId: null, new: n, reviews: r, extra: {} }) as LimitsRow;
		expect(limitsOf(at(null, null))).toEqual({});
		expect(limitsOf(at({ limit: null }, null))).toEqual({ new: null });
		expect(limitsOf(at({ limit: 0 }, { limit: 9999 }))).toEqual({ new: 0, reviews: 9999 });
		expect(limitsRow(null, {})).toEqual({ deckId: null, new: null, reviews: null, extra: {} });
		expect(limitsRow('general', { new: null, reviews: 5 })).toEqual({
			deckId: 'general',
			new: { limit: null },
			reviews: { limit: 5 },
			extra: {}
		});
	});

	it('FSRS sets: usable sets read, an unusable one is null; the active row', () => {
		for (const c of (rowsFixture.cases as RowsCase[]).filter((x) => x.collection === 'fsrsSets' && x.valid)) {
			const row = parseRow('fsrsSets', c.row) as FsrsSetRow;
			const set = setOf(row);
			expect(set).not.toBeNull();
			expect(setRow(set!, row.extra)).toEqual(bodyOf(row));
		}
		const valid = (rowsFixture.cases as RowsCase[]).find((x) => x.collection === 'fsrsSets' && x.valid)!;
		const wild = parseRow('fsrsSets', { ...valid.row, w: Array(21).fill(1000) }) as FsrsSetRow;
		expect(wild).not.toBeNull();
		expect(setOf(wild)).toBeNull();
		expect(activeRow('S1', '2026-11-12T10:00:00Z')).toEqual({ setId: 'S1', changedAt: '2026-11-12T10:00:00Z', extra: {} });
		expect(activeOf(parseRow('fsrsActive', { ...meta, setId: null, changedAt: null, extra: {} }) as FsrsActiveRow)).toEqual({
			setId: null,
			changedAt: null
		});
	});

	it('studyKey and legacyFamily', () => {
		expect(studyKey('cards', 'c-vocab-1')).toBe('cards:c-vocab-1');
		expect(studyKey('fsrsActive', '')).toBe('fsrsActive:');
		expect(legacyFamily('card:x')).toBe('cards');
		expect(legacyFamily('deck:x')).toBe('decks');
		expect(legacyFamily('deckcfg:general')).toBe('deckSettings');
		expect(legacyFamily('limits:workspace')).toBe('limits');
		expect(legacyFamily('limits:deck:general')).toBe('limits');
		expect(legacyFamily('fsrs:set:x')).toBe('fsrsSets');
		expect(legacyFamily('fsrs:active')).toBe('fsrsActive');
		expect(legacyFamily('known:5')).toBeNull();
		expect(legacyFamily('goals:workspace')).toBeNull();
		expect(legacyFamily('vacation:x')).toBeNull();
		for (const f of codecFixture.families) expect(legacyFamily(f.key), f.key).toBe(f.collection);
	});
});
