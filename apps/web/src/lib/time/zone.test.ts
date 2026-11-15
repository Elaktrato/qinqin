import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import {
	browserZone,
	changeZone,
	clearStudyDay,
	currentStudyDay,
	ensureStudyDay,
	onStudyDayChange
} from './zone';

const store = new Map<string, string>();
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const calls = () =>
	vi.mocked(fetch).mock.calls.map(([url, init]) => ({
		url: String(url),
		method: (init as RequestInit | undefined)?.method ?? 'GET',
		body: (init as RequestInit | undefined)?.body as string | undefined
	}));

beforeEach(() => {
	store.clear();
	store.set('qinqin.token', 'tok');
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	});
	vi.stubGlobal('fetch', vi.fn());
	clearStudyDay();
});
afterEach(() => {
	clearStudyDay();
	vi.unstubAllGlobals();
});

describe('ensureStudyDay', () => {
	it('sends the browser zone once, with ifUnset, when the server has none', async () => {
		vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
			timeZone: 'Asia/Tokyo'
		} as Intl.ResolvedDateTimeFormatOptions);
		vi.mocked(fetch)
			.mockResolvedValueOnce(json({ zone: null, history: [] }))
			.mockResolvedValueOnce(json({ zone: 'Asia/Tokyo', history: [{ zone: 'Asia/Tokyo', from: null }] }));
		const day = await ensureStudyDay(1);
		expect(calls().map((c) => `${c.method} ${c.url}`)).toEqual([
			'GET /api/me/time-zone',
			'PUT /api/me/time-zone'
		]);
		expect(JSON.parse(calls()[1].body!)).toEqual({ zone: 'Asia/Tokyo', ifUnset: true });
		expect(day.zone).toBe('Asia/Tokyo');
		expect(day.dayOf(Date.parse('2026-11-15T15:30:00Z'))).toBe('2026-11-16');
		expect(JSON.parse(store.get('qinqin.studyDay.1')!)).toEqual([{ zone: 'Asia/Tokyo', from: null }]);
		vi.restoreAllMocks();
	});

	it('does not PUT when the server already has a history, even if the browser differs', async () => {
		vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
			timeZone: 'Asia/Tokyo'
		} as Intl.ResolvedDateTimeFormatOptions);
		vi.mocked(fetch).mockResolvedValueOnce(
			json({ zone: 'Europe/Berlin', history: [{ zone: 'Europe/Berlin', from: null }] })
		);
		const day = await ensureStudyDay(1);
		expect(calls()).toHaveLength(1);
		expect(day.zone).toBe('Europe/Berlin');
		vi.restoreAllMocks();
	});

	it("does not use user A's cached copy for user B", async () => {
		store.set('qinqin.studyDay.1', JSON.stringify([{ zone: 'Asia/Tokyo', from: null }]));
		vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
		const b = await ensureStudyDay(2);
		expect(b.zone).not.toBe('Asia/Tokyo');
	});

	it('starts offline from the cached copy', async () => {
		store.set('qinqin.studyDay.1', JSON.stringify([{ zone: 'Asia/Tokyo', from: null }]));
		vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
		const day = await ensureStudyDay(1);
		expect(day.zone).toBe('Asia/Tokyo');
		expect(currentStudyDay().zone).toBe('Asia/Tokyo');
	});

	it('ignores a corrupt cache', async () => {
		for (const bad of ['not json', '[]', '{"zone":1}', '[{"zone":1,"from":null}]', '[{"zone":"UTC","from":"2026-01-01T00:00:00Z"}]']) {
			store.set('qinqin.studyDay.1', bad);
			vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
			clearStudyDay();
			store.set('qinqin.studyDay.1', bad);
			const day = await ensureStudyDay(1);
			expect(['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone]).toContain(day.zone);
		}
	});

	it('survives blocked storage', async () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		});
		vi.mocked(fetch).mockResolvedValueOnce(
			json({ zone: 'Asia/Tokyo', history: [{ zone: 'Asia/Tokyo', from: null }] })
		);
		expect((await ensureStudyDay(1)).zone).toBe('Asia/Tokyo');
	});

	it('does not send an unusable browser zone', async () => {
		vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
			timeZone: 'Etc/Unknown'
		} as Intl.ResolvedDateTimeFormatOptions);
		vi.mocked(fetch).mockResolvedValueOnce(json({ zone: null, history: [] }));
		const day = await ensureStudyDay(1);
		expect(calls()).toHaveLength(1);
		expect(day.zone).toBe('UTC');
		vi.restoreAllMocks();
	});
});

describe('changeZone, listeners and logout', () => {
	it('puts the zone, caches it and tells listeners', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json({ zone: null, history: [] }));
		await ensureStudyDay(1);
		const seen: string[] = [];
		const off = onStudyDayChange((d) => seen.push(d.zone));
		const next = [
			{ zone: 'Europe/Berlin', from: null },
			{ zone: 'Asia/Tokyo', from: '2026-11-10T12:00:00Z' }
		];
		vi.mocked(fetch).mockResolvedValueOnce(json({ zone: 'Asia/Tokyo', history: next }));
		const day = await changeZone('Asia/Tokyo');
		expect(JSON.parse(calls().at(-1)!.body!)).toEqual({ zone: 'Asia/Tokyo' });
		expect(day.zone).toBe('Asia/Tokyo');
		expect(seen).toEqual(['Asia/Tokyo']);
		expect(JSON.parse(store.get('qinqin.studyDay.1')!)).toEqual(next);
		off();
		vi.mocked(fetch).mockResolvedValueOnce(json({ zone: 'Asia/Tokyo', history: next }));
		await changeZone('Asia/Tokyo');
		expect(seen).toHaveLength(1);
	});

	it('a failed change rejects and keeps the rule', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			json({ zone: 'Asia/Tokyo', history: [{ zone: 'Asia/Tokyo', from: null }] })
		);
		await ensureStudyDay(1);
		vi.mocked(fetch).mockResolvedValueOnce(
			json({ error: 'unknown_time_zone', message: 'unknown time zone' }, 400)
		);
		await expect(changeZone('Mars/Base')).rejects.toThrow();
		expect(currentStudyDay().zone).toBe('Asia/Tokyo');
	});

	it('logout clears memory and the stored copy', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			json({ zone: 'Asia/Tokyo', history: [{ zone: 'Asia/Tokyo', from: null }] })
		);
		await ensureStudyDay(1);
		expect(store.has('qinqin.studyDay.1')).toBe(true);
		clearStudyDay();
		expect(store.has('qinqin.studyDay.1')).toBe(false);
		expect(currentStudyDay().zone).not.toBe('Asia/Tokyo');
	});
});

describe('browserZone', () => {
	it('returns null for an unknown or unusable zone', () => {
		expect(browserZone(() => 'Etc/Unknown')).toBeNull();
		expect(browserZone(() => 'Mars/Base')).toBeNull();
		expect(browserZone(() => undefined)).toBeNull();
		expect(
			browserZone(() => {
				throw new Error('x');
			})
		).toBeNull();
		expect(browserZone(() => 'Europe/Berlin')).toBe('Europe/Berlin');
	});
});
