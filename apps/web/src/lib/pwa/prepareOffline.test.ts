import { describe, expect, it, vi } from 'vitest';
import { STUDY_PULL_COLLECTIONS } from '../study/sync/pull';
import classifyFixtureRoutes from './sw/routes.fixture.json';
import { classify } from './sw/classify';
import { defaultSetup } from '../study/setup';
import { DEFAULT_W } from '../study/fsrs/params';
import { UTC_CONTEXT, type StudyContext } from '../study/studyContext';
import type { ReviewEvent, StudyCard, StudyCardKind } from '../study/types';
import { STUDY_COLLECTIONS } from '../study/rows';
import { firstPageUrl, nextPageUrl } from '../sync/pager';
import { fullLogPath } from '$lib/events';
import { entryPath } from '../api/entries';
import { strokeUrl } from '../study/strokeData';
import {
	OFFLINE_API_PATHS,
	PREPARE_THROTTLE_MS,
	planOffline,
	prepareOffline,
	clearReceipts,
	readReceipt,
	receiptKey,
	type PrepareDeps
} from './prepareOffline';
import * as build from '$lib/testing/study';

// The first page of the study pull the web makes (v=2, store.ts).
const SYNC_PULL_PATH = firstPageUrl({ collections: STUDY_PULL_COLLECTIONS, workspace: 3, tombstones: true });

const now = new Date('2026-03-01T12:00:00Z');

function card(id: string, kind: StudyCardKind, entryId: number, written = '学习', createdAt = '2026-01-01T00:00:00.000Z'): StudyCard {
	return build.card({ id, kind, entryId, written, createdAt });
}

const vocab = [1, 2, 3, 4, 5, 6].map((n) => card(`v${n}`, 'vocab', n, '学习', `2026-01-0${n}T00:00:00.000Z`));

const base = {
	cards: vocab,
	reviews: [] as ReviewEvent[],
	deckIds: ['general'],
	kinds: ['vocab'] as StudyCardKind[],
	newLimit: 2,
	reviewLimit: 100,
	now,
	w: DEFAULT_W,
	language: 'zh',
	ctx: UTC_CONTEXT
};

describe('planOffline', () => {
	it("is today's queue plus the next new cards, unique", () => {
		const plan = planOffline(base, { extraNew: 2, maxEntries: 500, studyAllExtra: 0 });
		expect(plan.entryIds).toEqual([1, 2, 3, 4]);
	});

	it('daily limits apply to the extra new cards too (the same rule as online)', () => {
		const limited: StudyContext = { ...UTC_CONTEXT, limits: { workspace: { new: 1 }, decks: {}, existingDecks: null } };
		expect(planOffline({ ...base, ctx: limited }, { extraNew: 50, maxEntries: 500, studyAllExtra: 0 }).entryIds).toEqual([1]);
	});

	it('a vacation day prepares nothing', () => {
		const vacation: StudyContext = { ...UTC_CONTEXT, vacationToday: true };
		expect(planOffline({ ...base, ctx: vacation }).entryIds).toEqual([]);
	});

	it('then prepares what Study all would add, past the daily limits, at most studyAllExtra entries (#175 review)', () => {
		const limited: StudyContext = { ...UTC_CONTEXT, limits: { workspace: { new: 1 }, decks: {}, existingDecks: null } };
		expect(planOffline({ ...base, ctx: limited }, { extraNew: 0, maxEntries: 500 }).entryIds).toEqual([1, 2, 3, 4, 5, 6]);
		expect(planOffline({ ...base, ctx: limited }, { extraNew: 0, maxEntries: 500, studyAllExtra: 2 }).entryIds).toEqual([1, 2, 3]);
		expect(planOffline({ ...base, ctx: limited }, { extraNew: 0, maxEntries: 2, studyAllExtra: 50 }).entryIds).toEqual([1, 2]);
	});

	it('caps the entries', () => {
		expect(planOffline(base, { extraNew: 50, maxEntries: 3 }).entryIds).toEqual([1, 2, 3]);
	});

	it('never plans companions (they are not studied offline)', () => {
		const plan = planOffline({ ...base, kinds: ['vocab', 'sentence'] }, { extraNew: 50, maxEntries: 500 });
		// vocab cards only: sentence companions would be virtual items
		expect(plan.entryIds.every((id) => id >= 1 && id <= 6)).toBe(true);
	});

	it('collects the characters of writing cards for stroke data', () => {
		const withWriting = { ...base, cards: [...vocab, card('w9', 'writing', 9, '猫咪')], kinds: ['vocab', 'writing'] as StudyCardKind[], newLimit: 20 };
		const plan = planOffline(withWriting, { extraNew: 0, maxEntries: 500 });
		expect(plan.chars.sort()).toEqual(['咪', '猫']);
	});
});

describe('the URLs prepared are the URLs the pages request', () => {
	it('every shell API path is cacheable by the worker', () => {
		const ctx = { origin: 'https://x.test', shellUrls: new Set<string>() };
		for (const path of OFFLINE_API_PATHS) {
			const req = { method: 'GET', url: `https://x.test${path}`, mode: 'cors', headers: { get: () => 'Bearer t' } };
			expect(classify(req, ctx), path).toBe('api');
		}
		expect(classify({ method: 'GET', url: `https://x.test${SYNC_PULL_PATH}`, mode: 'cors', headers: { get: () => 'Bearer t' } }, ctx)).toBe('api');
		// The study pull the offline copy holds names every typed study collection.
		const named = new URL(SYNC_PULL_PATH, 'https://x.test').searchParams.get('collections')?.split(',') ?? [];
		expect([...named].sort()).toEqual(['rows', ...STUDY_COLLECTIONS].sort());
		expect(classify({ method: 'GET', url: `https://x.test${fullLogPath(3)}`, mode: 'cors', headers: { get: () => 'Bearer t' } }, ctx)).toBe('api');
		expect(classify({ method: 'GET', url: `https://x.test${entryPath(12)}`, mode: 'cors', headers: { get: () => 'Bearer t' } }, ctx)).toBe('api');
		expect(classify({ method: 'GET', url: `https://x.test${strokeUrl('猫')}`, mode: 'cors', headers: { get: () => null } }, ctx)).toBe('hanzi');
	});

	it('the shell API paths exist in the server route table', () => {
		const patterns = new Set(classifyFixtureRoutes.map((r) => r.pattern));
		for (const path of OFFLINE_API_PATHS) expect(patterns.has(`GET ${path}`), path).toBe(true);
	});
});

describe('prepareOffline', () => {
	function memoryStorage(): Storage {
		const data = new Map<string, string>();
		return {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v),
			removeItem: (k: string) => void data.delete(k),
			clear: () => data.clear(),
			key: (i: number) => [...data.keys()][i] ?? null,
			get length() {
				return data.size;
			}
		} as Storage;
	}

	function makeDeps(over: Partial<PrepareDeps> = {}): PrepareDeps & { calls: string[]; active: { now: number; max: number } } {
		const calls: string[] = [];
		const active = { now: 0, max: 0 };
		const track = async (url: string) => {
			calls.push(url);
			active.now++;
			active.max = Math.max(active.max, active.now);
			await new Promise((r) => setTimeout(r, 1));
			active.now--;
		};
		return {
			calls,
			active,
			userId: 1,
			loadHistory: async () => ({ decks: [], cards: vocab, fsrs: undefined, reviews: [], merged: 0 }) as never,
			setup: async () => ({ ...defaultSetup(), decks: ['general'], newLimit: 2 }),
			language: 'zh',
			contextFor: () => UTC_CONTEXT,
			weights: () => DEFAULT_W,
			fetchEntry: (id) => track(entryPath(id)),
			fetchStroke: (ch) => track(strokeUrl(ch)),
			fetchApi: (path) => track(path),
			storage: memoryStorage(),
			now: () => now.getTime(),
			canPrepare: () => true,
			partition: async () => 'qinqin-api-v1-aaa',
			isCached: async () => false,
			pullPages: () => 1,
			extraNew: 2,
			studyAllExtra: 0,
			onPrepared: () => {},
			...over
		};
	}

	it('fetches the shell API set and every planned entry, two at a time', async () => {
		const deps = makeDeps();
		const result = await prepareOffline(7, deps);
		expect(result.status).toBe('prepared');
		for (const path of OFFLINE_API_PATHS) expect(deps.calls).toContain(path);
		expect(deps.calls.filter((c) => c.startsWith('/api/entries/')).sort()).toEqual([1, 2, 3, 4].map((n) => entryPath(n)).sort());
		expect(deps.active.max).toBeLessThanOrEqual(2);
	});

	it('prepares the opt-in kinds the decks switch on, as the study modal selects them', async () => {
		// Word 9 was learned (Easy, not due); its reverse card is new. General switches reverse on, and
		// the saved setup is the default one (Vocab, opt-in kinds as the decks say).
		const learned = card('c-vocab-9', 'vocab', 9, '本', '2026-01-01T00:00:00.000Z');
		const reverse = card('c-reverse-9', 'reverse', 9, '本', '2026-01-02T00:00:00.000Z');
		const history = build.history({
			cards: [learned, reverse],
			reviews: [build.review({ cardId: 'c-vocab-9', ts: '2026-02-27T10:00:00Z', grade: 4 })],
			deckSettings: { general: { deckId: 'general', cardTypes: ['reverse'], extra: {} } }
		});
		const deps = makeDeps({ loadHistory: async () => history, setup: async () => defaultSetup() });
		expect((await prepareOffline(7, deps)).status).toBe('prepared');
		expect(deps.calls).toContain(entryPath(9));

		// Unchecked in the saved setup: not prepared.
		const off = makeDeps({ loadHistory: async () => history, setup: async () => ({ ...defaultSetup(), unchecked: ['reverse'] }) });
		await prepareOffline(7, off);
		expect(off.calls).not.toContain(entryPath(9));
	});

	it('prepares the decks of the saved setup: "all" is every deck, a list only its decks', async () => {
		const inDeck = { ...card('c-vocab-21', 'vocab', 21, '山', '2026-01-01T00:00:00.000Z'), deckIds: ['d1'] };
		const history = build.history({ decks: [{ id: 'd1', name: 'Hills', createdAt: '2026-01-01T00:00:00Z' }], cards: [inDeck] });
		const all = makeDeps({ loadHistory: async () => history, setup: async () => defaultSetup() });
		await prepareOffline(7, all);
		expect(all.calls).toContain(entryPath(21));
		const general = makeDeps({ loadHistory: async () => history, setup: async () => ({ ...defaultSetup(), decks: ['general'] }) });
		await prepareOffline(7, general);
		expect(general.calls).not.toContain(entryPath(21));
	});

	it('warms every page of the current workspace round through the study read and counts the pages', async () => {
		const pages: number[] = [];
		const loadHistory = vi.fn(async (ws: number) => {
			pages.push(ws);
			return { decks: [], cards: vocab, fsrs: undefined, reviews: [], merged: 0 } as never;
		});
		const deps = makeDeps({ loadHistory, pullPages: (ws) => (ws === 7 ? 3 : 0) });
		await prepareOffline(7, deps);
		expect(pages).toEqual([7]);
		expect(JSON.parse(deps.storage!.getItem(receiptKey(1, 7)) as string).pages).toBe(3);
	});

	it('the v2 first page and its continuation of a workspace round are what the worker keeps', () => {
		const ctx = { origin: 'https://x.test', shellUrls: new Set<string>() };
		const headers = { get: () => 'Bearer t' };
		for (const url of [firstPageUrl({ collections: STUDY_PULL_COLLECTIONS, workspace: 7 }), nextPageUrl('p2.abc')]) {
			expect(classify({ method: 'GET', url: `https://x.test${url}`, mode: 'cors', headers }, ctx), url).toBe('api');
		}
	});

	it('is throttled for 30 minutes, and then does not even download the history first', async () => {
		const deps = makeDeps();
		await prepareOffline(7, deps);
		const first = deps.calls.length;
		const loadHistory = vi.fn(deps.loadHistory);
		const soon = { ...deps, loadHistory, now: () => now.getTime() + PREPARE_THROTTLE_MS - 1000 };
		expect((await prepareOffline(7, soon)).status).toBe('skipped');
		expect(loadHistory).not.toHaveBeenCalled();
		expect(deps.calls.length).toBe(first);
		expect((await prepareOffline(7, { ...deps, loadHistory, now: () => now.getTime() + PREPARE_THROTTLE_MS + 1 })).status).toBe('prepared');
		expect(loadHistory).toHaveBeenCalledTimes(1);
	});

	it('a receipt of another credential partition is worth nothing: it prepares again', async () => {
		const deps = makeDeps();
		await prepareOffline(7, deps);
		const next = { ...deps, partition: async () => 'qinqin-api-v1-bbb' };
		expect((await prepareOffline(7, next)).status).toBe('prepared');
	});

	it('no partition (not signed in) prepares nothing', async () => {
		const deps = makeDeps({ partition: async () => null });
		expect((await prepareOffline(7, deps)).status).toBe('skipped');
		expect(deps.calls).toEqual([]);
	});

	it('skips entries that are already saved', async () => {
		const deps = makeDeps({ isCached: async (path) => path === entryPath(1) || path === entryPath(2) });
		await prepareOffline(7, deps);
		expect(deps.calls.filter((c) => c.startsWith('/api/entries/')).sort()).toEqual([entryPath(3), entryPath(4)]);
	});

	it('readReceipt shows nothing for a receipt of another partition', async () => {
		const deps = makeDeps();
		await prepareOffline(7, deps);
		expect(readReceipt(deps.storage, 1, 7, 'qinqin-api-v1-aaa')?.cards).toBe(4);
		expect(readReceipt(deps.storage, 1, 7, 'qinqin-api-v1-other')).toBeNull();
		expect(readReceipt(deps.storage, 1, 7, null)).toBeNull();
	});

	it('clearReceipts removes them all', async () => {
		const deps = makeDeps();
		await prepareOffline(7, deps);
		deps.storage!.setItem('qinqin.study.pending.v2', '[]');
		clearReceipts(deps.storage);
		expect(deps.storage!.getItem(receiptKey(1, 7))).toBeNull();
		expect(deps.storage!.getItem('qinqin.study.pending.v2')).toBe('[]');
	});

	it('receipts are per user and workspace', async () => {
		const deps = makeDeps();
		await prepareOffline(7, deps);
		expect(deps.storage!.getItem(receiptKey(1, 7))).not.toBeNull();
		expect(deps.storage!.getItem(receiptKey(2, 7))).toBeNull();
		expect((await prepareOffline(7, { ...deps, userId: 2 })).status).toBe('prepared');
	});

	it('does nothing when it must not (no controlling worker, offline, data saver)', async () => {
		const deps = makeDeps({ canPrepare: () => false });
		expect((await prepareOffline(7, deps)).status).toBe('skipped');
		expect(deps.calls).toEqual([]);
	});

	it('stops quietly when the connection drops, and keeps no receipt', async () => {
		const deps = makeDeps({
			fetchEntry: vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		});
		const result = await prepareOffline(7, deps);
		expect(result.status).toBe('failed');
		expect(deps.storage!.getItem(receiptKey(1, 7))).toBeNull();
	});

	it('reports what was saved', async () => {
		const onPrepared = vi.fn();
		await prepareOffline(7, makeDeps({ onPrepared }));
		expect(onPrepared).toHaveBeenCalledWith({ workspaceId: 7, cards: 4, at: now.toISOString() });
	});
});
