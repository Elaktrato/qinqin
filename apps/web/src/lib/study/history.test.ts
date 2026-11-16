import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { invalidateWorkspaceEvents, loadWorkspaceEvents, postEvents } from '../events';
import { workspaces } from '../workspaces';
import { STUDY_HISTORY_TTL_MS, invalidateStudyHistory, loadStudyHistory } from './history';
import { addCard, loadStudyData, saveVacation } from './store';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const card = {
	pluginId: 'qinqin-flashcards',
	key: 'card:c1',
	workspaceId: 7,
	data: { id: 'c1', kind: 'vocab', entryId: 42, deckIds: ['general'], createdAt: '2026-01-01T00:00:00Z' },
	deletedAt: null
};

const review = {
	id: 'r1',
	workspaceId: 7,
	device: 'web',
	ts: '2026-01-02T00:00:00Z',
	type: 'review',
	payload: { cardId: 'c1', mode: 'vocab', grade: 'good' }
};

function calls(prefix: string): number {
	return vi
		.mocked(fetch)
		.mock.calls.filter(([url, init]) => String(url).startsWith(prefix) && (init?.method ?? 'GET') === 'GET')
		.length;
}

function event(type: string, workspaceId = 7) {
	return { id: `x-${type}`, workspaceId, device: 'web', ts: '2026-01-03T00:00:00Z', type, payload: null };
}

describe('loadStudyHistory', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (init?.method === 'PUT') return jsonResponse({ version: 1 });
				if (init?.method === 'POST') return jsonResponse({ accepted: 1, duplicates: 0 });
				if (url.startsWith('/api/sync/pull')) return jsonResponse({ pluginData: [card] });
				if (url.startsWith('/api/events?')) return jsonResponse([review]);
				return jsonResponse({}, 404);
			})
		);
		workspaces.set({
			list: [],
			current: { id: 7, language: 'zh', name: '', settings: {}, updatedAt: '' }
		});
		invalidateStudyHistory();
		invalidateWorkspaceEvents();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('answers what loadStudyData answers', async () => {
		expect(await loadStudyHistory(7)).toEqual(await loadStudyData(7));
	});

	it('shares one sync pull and one log read between widgets', async () => {
		const [a, b] = await Promise.all([loadStudyHistory(7), loadStudyHistory(7), loadWorkspaceEvents(7)]);
		await loadStudyHistory(7);

		expect(a).toBe(b);
		expect(calls('/api/sync/pull')).toBe(1);
		expect(calls('/api/events?')).toBe(1);
	});

	it('loads again after the TTL', async () => {
		vi.useFakeTimers({ now: new Date('2026-05-01T00:00:00Z'), toFake: ['Date'] });
		await loadStudyHistory(7);
		vi.setSystemTime(Date.now() + STUDY_HISTORY_TTL_MS);
		await loadStudyHistory(7);

		expect(calls('/api/sync/pull')).toBe(2);
	});

	it('keeps workspaces apart', async () => {
		const seven = await loadStudyHistory(7);
		const eight = await loadStudyHistory(8);

		expect(seven.cards).toHaveLength(1);
		expect(eight.cards).toHaveLength(0);
		expect(eight.reviews).toHaveLength(0);
		expect(calls('/api/sync/pull')).toBe(2);
	});

	it('a vacation write drops the cached history of every workspace', async () => {
		await loadStudyHistory(7);
		await loadStudyHistory(8);
		await saveVacation({ version: 1, id: 'A', start: '2026-12-01', end: null, scope: 'all', createdDay: '2026-11-15', createdAt: '2026-11-15T08:00:00Z' });
		await loadStudyHistory(7);
		await loadStudyHistory(8);

		expect(calls('/api/sync/pull')).toBe(4);
	});

	it('force reads the pull and the log again', async () => {
		await loadStudyHistory(7);
		await loadStudyHistory(7, { force: true });

		expect(calls('/api/sync/pull')).toBe(2);
		expect(calls('/api/events?')).toBe(2);
	});

	it('does not cache a failed load', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'down' }, 500));
		await expect(loadStudyHistory(7)).rejects.toThrow();
		expect((await loadStudyHistory(7)).cards).toHaveLength(1);
	});

	it('a study-data write drops the cached history', async () => {
		await loadStudyHistory(7);
		await addCard(43);
		const pulls = calls('/api/sync/pull');
		await loadStudyHistory(7);

		expect(calls('/api/sync/pull')).toBe(pulls + 1);
	});

	it.each(['review', 'read'])('a posted %s event drops the cached history', async (type) => {
		await loadStudyHistory(7);
		await postEvents([event(type)]);
		await loadStudyHistory(7);

		expect(calls('/api/sync/pull')).toBe(2);
		expect(calls('/api/events?')).toBe(2);
	});

	it('a posted session event keeps the cached history', async () => {
		await loadStudyHistory(7);
		await postEvents([event('session')]);
		await loadStudyHistory(7);

		expect(calls('/api/sync/pull')).toBe(1);
	});

	it('a review in another workspace keeps this one cached', async () => {
		await loadStudyHistory(7);
		await postEvents([event('review', 8)]);
		await loadStudyHistory(7);

		expect(calls('/api/sync/pull')).toBe(1);
	});
});
