import { testContext, type TestContext } from '$lib/testing/context';
// #174: every study write names its workspace. Start a write while its pull
// is held back, switch the selected workspace, let the pull answer: the pull
// asked for the original workspace and every pushed row carries it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	addCard,
	deleteCards,
	dropSiblingCards,
	moveCards,
	restoreCards,
	skipKind,
	unskipKind
} from './commands/cards';
import {
	createDeck,
	deleteDeck,
	renameDeck,
	saveDeckCardTypes,
	saveDeckCardTypesForDecks,
	saveDeckNewOrder
} from './commands/decks';
import { loadStudyData } from './data';
import { saveDeckLimits, saveWorkspaceLimits } from './commands/settings';
import { STUDY_COLLECTIONS } from './rows';
import type { StudyCard } from './types';
import { endSession } from '../session/sessionEnd';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

// Every test starts a session of its own: the study cache holds nothing.
beforeEach(() => endSession('signOut'));

const A = 7;
const B = 9;
const D1 = '01JDECK0000000000000000001';
const D2 = '01JDECK0000000000000000002';
const meta = { version: 1, updatedAt: '2026-11-12T10:00:00Z', deletedAt: null };
const cardRow = (id: string, kind: string, entryId: number, deckIds: string[], skipKinds: string[] = []) => ({
	workspaceId: A, id, kind, entryId, written: null, entryKind: null, sentenceId: null, skipKinds, deckIds,
	createdAt: '2026-11-10T08:00:00Z', extra: {}, ...meta
});
const deckRow = (id: string) => ({ workspaceId: A, id, name: id, createdAt: '2026-11-10T08:00:00Z', source: null, extra: {}, ...meta });

function page(workspace: number) {
	const own = workspace === A;
	return {
		format: 2, instanceId: '01JD8Z3Q4M5N6P7R8S9T0V1W2X', until: '2026-11-12T10:00:00Z',
		scope: { workspaces: [{ id: A, language: 'zh' }, { id: B, language: 'zh' }], languages: ['zh'], catalogue: '"k"' },
		restarted: [],
		collections: {
			pluginStates: [], pluginData: [],
			cards: own ? [cardRow('c-vocab-5', 'vocab', 5, [D1], ['tone']), cardRow('c-sentence-5', 'sentence', 5, [D1])] : [],
			decks: own ? [deckRow(D1), deckRow(D2)] : [],
			deckSettings: own ? [{ workspaceId: A, deckId: D1, cardTypes: [], newOrder: null, extra: {}, ...meta }] : [],
			limits: own ? [{ workspaceId: A, deckId: D1, new: { limit: 3 }, reviews: null, extra: {}, ...meta }] : [],
			fsrsSets: [], fsrsActive: []
		},
		more: false, next: null, cursor: 'c2.x'
	};
}

let release: (() => void) | null = null;
const pulled: string[] = [];
const pushed: Record<string, Record<string, unknown>[]>[] = [];

function select(id: number): void {
	ctx.session.workspaces.set({ list: [], current: { id, language: 'zh', name: '', settings: {}, updatedAt: '2026-01-01T00:00:00Z' } });
}

beforeEach(() => {
	pulled.length = 0;
	pushed.length = 0;
	select(A);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: unknown, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith('/api/sync/pull')) {
				pulled.push(url);
				// The first pull of a write waits until the test switched workspace.
				if (release === null && pulled.length === 1) await new Promise<void>((r) => (release = r));
				return Response.json(page(Number(new URLSearchParams(url.split('?')[1]).get('workspace'))));
			}
			if (url === '/api/sync/push') {
				const body = JSON.parse(String(init?.body)) as Record<string, Record<string, unknown>[]>;
				pushed.push(body);
				const n = Object.values(body).reduce((s, l) => s + l.length, 0);
				return Response.json({ eventsAccepted: 0, eventDuplicates: 0, dataAccepted: n, dataSkipped: 0, dataRefused: 0 });
			}
			if (url.startsWith('/api/events')) return Response.json({ events: [], more: false, next: null });
			return new Response('unexpected', { status: 500 });
		})
	);
});

afterEach(() => {
	release = null;
	vi.unstubAllGlobals();
	ctx.session.workspaces.set({ list: [], current: null });
});

/** Runs `write`, switches to B while its first pull waits, and checks where everything went. */
async function survivesSwitch(write: () => Promise<unknown>, opts: { pulls?: boolean } = {}): Promise<void> {
	const done = write();
	if (opts.pulls !== false) {
		await vi.waitFor(() => expect(release).not.toBeNull());
		select(B);
		release?.();
	} else {
		select(B);
	}
	await done;
	for (const url of pulled) expect(url).toContain(`workspace=${A}`);
	const rows = pushed.flatMap((body) => STUDY_COLLECTIONS.flatMap((c) => body[c] ?? []));
	expect(rows.length).toBeGreaterThan(0);
	for (const row of rows) expect(row.workspaceId).toBe(A);
}

const removed: StudyCard = { id: 'c-writing-5', kind: 'writing', entryId: 5, deckIds: [D1], createdAt: '2026-11-10T08:00:00Z' };

describe('a workspace switch during a study write (#174)', () => {
	describe('decks', () => {
		it('createDeck', () => survivesSwitch(() => createDeck(A, 'New'), { pulls: false }));
		it('renameDeck', () => survivesSwitch(() => renameDeck(A, D1, 'Renamed')));
		it('deleteDeck', () => survivesSwitch(() => deleteDeck(A, D1)));
	});
	describe('cards', () => {
		it('deleteCards', () => survivesSwitch(() => deleteCards(A, ['c-sentence-5'])));
		it('restoreCards', () => survivesSwitch(() => restoreCards(A, [removed])));
		it('moveCards', () => survivesSwitch(() => moveCards(A, ['c-vocab-5'], D2)));
	});
	describe('word switches', () => {
		it('skipKind', () => survivesSwitch(() => skipKind(A, 5, 'writing')));
		it('unskipKind', () => survivesSwitch(() => unskipKind(A, 5, 'tone')));
		it('dropSiblingCards', () => survivesSwitch(() => dropSiblingCards(A, ['c-sentence-5'])));
	});
	describe('deck settings', () => {
		it('saveDeckCardTypes', () => survivesSwitch(() => saveDeckCardTypes(A, D1, ['reverse'])));
		it('saveDeckCardTypesForDecks', () => survivesSwitch(() => saveDeckCardTypesForDecks(A, [D1, D2], 'cloze', true)));
		it('saveDeckNewOrder', () => survivesSwitch(() => saveDeckNewOrder(A, D1, { by: 'frequency' })));
	});
	describe('limits', () => {
		it('saveWorkspaceLimits', () => survivesSwitch(() => saveWorkspaceLimits(A, { new: 4 })));
		it('saveDeckLimits', () => survivesSwitch(() => saveDeckLimits(A, D1, { new: 6 })));
	});
	describe('cards added', () => {
		it('addCard', () => survivesSwitch(() => addCard(A, 6)));
	});

	it('a write refuses a missing or invalid workspace before any request', async () => {
		for (const bad of [0, -1, 1.5, Number.NaN]) {
			await expect(createDeck(bad, 'x')).rejects.toThrow(/workspace/);
			await expect(addCard(bad, 6)).rejects.toThrow(/workspace/);
		}
		await expect(loadStudyData(0)).rejects.toThrow(/workspace/);
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each(['./data.ts', './cache.ts', './commands/write.ts', './commands/decks.ts', './commands/cards.ts', './commands/settings.ts', './commands/keyed.ts'])(
		'%s never reads the selected workspace itself',
		(file) => {
			const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
			expect(source).not.toMatch(/from ["'](\.\.\/)+workspaces["']/);
			expect(source).not.toContain('requireWorkspaceId');
		}
	);
});
