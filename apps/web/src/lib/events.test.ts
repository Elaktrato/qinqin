import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import {
	WORKSPACE_EVENTS_TTL_MS,
	invalidateWorkspaceEvents,
	loadWorkspaceEvents,
	onEventLogChange,
	postEvents,
	record,
	recordSessionOnce,
	recordSessionWhenSettled,
	sinceDaysAgo
} from './events';
import { studyDay } from './time/studyDay';

function fakeStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function sentEvents(response = jsonResponse({ accepted: 1, duplicates: 0 })) {
	vi.mocked(fetch).mockResolvedValue(response);
}

function lastBatch(): { events: Record<string, unknown>[] } {
	const calls = vi.mocked(fetch).mock.calls;
	const [, init] = calls[calls.length - 1];
	return JSON.parse(String(init?.body));
}

describe('record', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
		sentEvents();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('posts one event in the batch envelope', async () => {
		await record('view', 7, { entryId: 42 });

		const [call] = vi.mocked(fetch).mock.calls;
		expect(String(call[0])).toBe('/api/events/batch');
		expect(call[1]?.method).toBe('POST');

		const body = lastBatch();
		expect(body.events).toHaveLength(1);
		expect(body.events[0]).toMatchObject({
			workspaceId: 7,
			device: 'web',
			type: 'view',
			payload: { entryId: 42 }
		});
	});

	it('generates a ULID id and an RFC 3339 timestamp', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-03-15T08:30:00Z'));

		await record('session', 3);

		const event = lastBatch().events[0];
		expect(event.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(event.ts).toBe('2026-03-15T08:30:00.000Z');
		expect(new Date(String(event.ts)).toISOString()).toBe(event.ts);
	});

	it('normalizes an omitted payload to JSON null', async () => {
		await record('session', 3);

		expect(lastBatch().events[0].payload).toBeNull();
	});

	it('never rejects when the request fails', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.mocked(fetch).mockRejectedValue(new Error('offline'));

		await expect(record('lookup', 1, { query: '漢' })).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalled();

		warn.mockRestore();
	});

	it('never rejects on a non-2xx response', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		sentEvents(new Response('server exploded', { status: 500 }));

		await expect(record('lookup', 1, { query: '漢' })).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalled();

		warn.mockRestore();
	});
});

describe('recordSessionOnce', () => {
	const DAY_ONE = new Date('2026-03-15T08:00:00Z');
	const DAY_TWO = new Date('2026-03-16T08:00:00Z');

	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
		sentEvents();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(DAY_ONE);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('records at most one session per workspace per UTC day', () => {
		recordSessionOnce(5);
		recordSessionOnce(5);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(lastBatch().events[0]).toMatchObject({ type: 'session', workspaceId: 5 });
		expect(localStorage.getItem('qinqin.session.5.2026-03-15')).toBe('1');
	});

	it('keys the receipt by the learner day: 15:30Z is already the next day in Tokyo', () => {
		const tokyo = studyDay([{ zone: 'Asia/Tokyo', from: null }]);
		vi.setSystemTime(new Date('2026-03-15T14:00:00Z')); // 23:00 on the 15th in Tokyo
		recordSessionOnce(5, tokyo);
		vi.setSystemTime(new Date('2026-03-15T15:30:00Z')); // 00:30 on the 16th
		recordSessionOnce(5, tokyo);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(localStorage.getItem('qinqin.session.5.2026-03-15')).toBe('1');
		expect(localStorage.getItem('qinqin.session.5.2026-03-16')).toBe('1');
		recordSessionOnce(5, tokyo); // same learner day: no third event
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('treats workspaces independently', () => {
		recordSessionOnce(5);
		recordSessionOnce(6);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(localStorage.getItem('qinqin.session.5.2026-03-15')).toBe('1');
		expect(localStorage.getItem('qinqin.session.6.2026-03-15')).toBe('1');
	});

	it('records again on the next UTC day', () => {
		recordSessionOnce(5);
		vi.setSystemTime(DAY_TWO);
		recordSessionOnce(5);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(localStorage.getItem('qinqin.session.5.2026-03-16')).toBe('1');
	});

	it('still records when storage is unavailable', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			}
		});

		recordSessionOnce(5);

		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

describe('recordSessionWhenSettled', () => {
	it("keys the receipt by the loaded zone, not the provisional browser zone", async () => {
		vi.stubGlobal('localStorage', fakeStorage());
		localStorage.setItem('qinqin.token', 'tok');
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-03-15T22:30:00Z')); // 23:30 on the 15th in Berlin, 07:30 on the 16th in Tokyo
		vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
			timeZone: 'Europe/Berlin'
		} as Intl.ResolvedDateTimeFormatOptions);
		let release!: (r: Response) => void;
		const fetchMock = vi.fn((url: string) =>
			String(url).includes('time-zone')
				? new Promise<Response>((r) => (release = r))
				: Promise.resolve(new Response('{}'))
		);
		vi.stubGlobal('fetch', fetchMock);
		const { syncStudyDayUser, clearStudyDay } = await import('./time/zone');
		clearStudyDay();
		void syncStudyDayUser(9);
		const done = recordSessionWhenSettled(5);
		await Promise.resolve();
		expect(localStorage.getItem('qinqin.session.5.2026-03-15')).toBeNull();
		release(new Response(JSON.stringify({ zone: 'Asia/Tokyo', history: [{ zone: 'Asia/Tokyo', from: null }] })));
		await done;
		expect(localStorage.getItem('qinqin.session.5.2026-03-16')).toBe('1');
		expect(localStorage.getItem('qinqin.session.5.2026-03-15')).toBeNull();
		clearStudyDay();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});
});

describe('sinceDaysAgo', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns an RFC 3339 instant the given number of days back', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));

		expect(sinceDaysAgo(91)).toBe('2025-12-14T12:00:00.000Z');
		expect(new Date(sinceDaysAgo(0)).toISOString()).toBe('2026-03-15T12:00:00.000Z');
	});
});

describe('loadWorkspaceEvents', () => {
	const log = [{ id: 'e1', workspaceId: 7, device: 'web', ts: '2026-01-01T00:00:00Z', type: 'review', payload: null }];

	function logReads(): string[] {
		return vi
			.mocked(fetch)
			.mock.calls.map(([url]) => String(url))
			.filter((url) => url.startsWith('/api/events?'));
	}

	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) =>
				String(input).startsWith('/api/events?')
					? jsonResponse(log)
					: jsonResponse({ accepted: 1, duplicates: 0 })
			)
		);
		invalidateWorkspaceEvents();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('reads the full log of the workspace once for concurrent and repeated callers', async () => {
		const [a, b] = await Promise.all([loadWorkspaceEvents(7), loadWorkspaceEvents(7)]);
		await loadWorkspaceEvents(7);

		expect(a).toBe(b);
		expect(a).toEqual(log);
		expect(logReads()).toEqual(['/api/events?since=1970-01-01T00:00:00Z&workspace=7']);
	});

	it('reads again after the TTL', async () => {
		vi.useFakeTimers({ now: new Date('2026-05-01T00:00:00Z'), toFake: ['Date'] });
		await loadWorkspaceEvents(7);
		vi.setSystemTime(Date.now() + WORKSPACE_EVENTS_TTL_MS);
		await loadWorkspaceEvents(7);

		expect(logReads()).toHaveLength(2);
	});

	it('force reads again', async () => {
		await loadWorkspaceEvents(7);
		await loadWorkspaceEvents(7, { force: true });

		expect(logReads()).toHaveLength(2);
	});

	it('keeps workspaces apart', async () => {
		await loadWorkspaceEvents(7);
		await loadWorkspaceEvents(8);
		await loadWorkspaceEvents(7);

		expect(logReads()).toEqual([
			'/api/events?since=1970-01-01T00:00:00Z&workspace=7',
			'/api/events?since=1970-01-01T00:00:00Z&workspace=8'
		]);
	});

	it('does not cache a failed read', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'down' }, 500));
		await expect(loadWorkspaceEvents(7)).rejects.toThrow();
		expect(await loadWorkspaceEvents(7)).toEqual(log);
		expect(logReads()).toHaveLength(2);
	});

	it.each(['review', 'read'])('a posted %s event drops the cached log of its workspace', async (type) => {
		const changed = vi.fn();
		const off = onEventLogChange(changed);
		await loadWorkspaceEvents(7);
		await loadWorkspaceEvents(8);
		await postEvents([{ id: 'x', workspaceId: 7, device: 'web', ts: '2026-01-01T00:00:00Z', type, payload: null }]);
		await loadWorkspaceEvents(7);
		await loadWorkspaceEvents(8);
		off();

		expect(logReads()).toHaveLength(3);
		expect(changed).toHaveBeenCalledWith(7);
		expect(changed).toHaveBeenCalledTimes(1);
	});

	it.each(['session', 'view', 'lookup'])('a posted %s event keeps the cached log', async (type) => {
		await loadWorkspaceEvents(7);
		await postEvents([{ id: 'x', workspaceId: 7, device: 'web', ts: '2026-01-01T00:00:00Z', type, payload: null }]);
		await loadWorkspaceEvents(7);

		expect(logReads()).toHaveLength(1);
	});

	it('a failed post of a review still drops the cached log (it may have landed)', async () => {
		await loadWorkspaceEvents(7);
		vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network'));
		await expect(
			postEvents([{ id: 'x', workspaceId: 7, device: 'web', ts: '2026-01-01T00:00:00Z', type: 'review', payload: null }])
		).rejects.toThrow();
		await loadWorkspaceEvents(7);

		expect(logReads()).toHaveLength(2);
	});
});
