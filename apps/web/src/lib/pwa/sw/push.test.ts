import { describe, expect, it, vi } from 'vitest';
import { onNotificationClick, onPush, parsePushPayload, safeRoute, type ClientLike, type PushEv, type ClickEv } from './push';
import type { PushTexts } from './pushTexts';

const ORIGIN = 'https://qinqin.example';

describe('safeRoute', () => {
	it('keeps a route that starts with a single slash', () => {
		expect(safeRoute('/study')).toBe('/study');
		expect(safeRoute('/settings?tab=notifications')).toBe('/settings?tab=notifications');
	});
	it.each([['//evil.example'], ['https://evil.example/study'], ['study'], ['\\\\evil'], ['/\\evil'], [''], [null], [7], [undefined], ['/a\nb']])(
		'%s becomes /study',
		(route) => expect(safeRoute(route)).toBe('/study')
	);
});

describe('parsePushPayload', () => {
	const data = (json: () => unknown) => ({ json });
	it('reads the documented payload', () => {
		expect(parsePushPayload(data(() => ({ v: 1, kind: 'due', count: 15, route: '/study' })))).toEqual({ kind: 'due', count: 15, route: '/study' });
		expect(parsePushPayload(data(() => ({ v: 1, kind: 'goal', count: null, route: '/study' })))).toEqual({ kind: 'goal', count: null, route: '/study' });
	});
	it('is generic for no data, malformed JSON, a non-object or an unknown kind', () => {
		const generic = { kind: 'generic', count: null, route: '/study' };
		expect(parsePushPayload(null)).toEqual(generic);
		expect(parsePushPayload(data(() => { throw new SyntaxError('bad'); }))).toEqual(generic);
		expect(parsePushPayload(data(() => 'x'))).toEqual(generic);
		expect(parsePushPayload(data(() => ({ kind: 'party', count: 1 })))).toEqual(generic);
	});
	it('drops a count that is no non-negative integer and a hostile route', () => {
		expect(parsePushPayload(data(() => ({ kind: 'due', count: -3, route: '//x' })))).toEqual({ kind: 'due', count: null, route: '/study' });
		expect(parsePushPayload(data(() => ({ kind: 'due', count: 2.5 })))).toMatchObject({ count: null });
	});
});

function pushEvent(data: PushEv['data']): { ev: PushEv; waited: Promise<unknown>[] } {
	const waited: Promise<unknown>[] = [];
	return { ev: { data, waitUntil: (p) => void waited.push(p) }, waited };
}

describe('onPush', () => {
	const texts: PushTexts = { locale: 'en', messages: {} };
	it('shows a notification with the tag of its kind, the formatted text and the route', async () => {
		const show = vi.fn(async () => undefined);
		const { ev, waited } = pushEvent({ json: () => ({ v: 1, kind: 'due', count: 15, route: '/study' }) });
		onPush(ev, { show, texts: async () => texts });
		await Promise.all(waited);
		expect(show).toHaveBeenCalledWith('Time to study', expect.objectContaining({ body: '15 cards are due.', tag: 'due', data: { route: '/study' } }));
	});
	it('uses the stored texts', async () => {
		const show = vi.fn(async () => undefined);
		const { ev, waited } = pushEvent({ json: () => ({ kind: 'streak', count: 1 }) });
		onPush(ev, { show, texts: async () => ({ locale: 'en', messages: { 'settings.reminders.notify.streak.title': 'Serie halten' } }) });
		await Promise.all(waited);
		expect(show).toHaveBeenCalledWith('Serie halten', expect.objectContaining({ tag: 'streak', body: '1 day in a row. Study today to keep it.' }));
	});
	it('a malformed payload still shows a generic notification and never throws', async () => {
		const show = vi.fn(async () => undefined);
		const { ev, waited } = pushEvent({ json: () => { throw new Error('x'); } });
		expect(() => onPush(ev, { show, texts: async () => null })).not.toThrow();
		await Promise.all(waited);
		expect(show).toHaveBeenCalledWith('qinqin', expect.objectContaining({ tag: 'generic', data: { route: '/study' } }));
	});
	it('shows a generic notification even when the text lookup fails', async () => {
		const show = vi.fn(async () => undefined);
		const { ev, waited } = pushEvent(null);
		onPush(ev, { show, texts: async () => { throw new Error('cache'); } });
		await Promise.all(waited);
		expect(show).toHaveBeenCalledTimes(1);
	});
});

function client(url: string, over: Partial<ClientLike> = {}): ClientLike & { focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> } {
	return { url, focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined), ...over } as never;
}

function click(route: unknown): { ev: ClickEv; closed: () => boolean; waited: Promise<unknown>[] } {
	let closed = false;
	const waited: Promise<unknown>[] = [];
	return {
		ev: { notification: { close: () => (closed = true), data: route === undefined ? undefined : { route } }, waitUntil: (p) => void waited.push(p) },
		closed: () => closed,
		waited
	};
}

describe('onNotificationClick', () => {
	it('closes it, focuses an open window and navigates it to the route', async () => {
		const a = client(`${ORIGIN}/`);
		const matchAll = vi.fn(async () => [a]);
		const openWindow = vi.fn(async () => null);
		const { ev, closed, waited } = click('/study');
		onNotificationClick(ev, { clients: { matchAll, openWindow }, origin: ORIGIN });
		await Promise.all(waited);
		expect(closed()).toBe(true);
		expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
		expect(a.focus).toHaveBeenCalled();
		expect(a.navigate).toHaveBeenCalledWith(`${ORIGIN}/study`);
		expect(openWindow).not.toHaveBeenCalled();
	});
	it('does not navigate a window that already shows the route', async () => {
		const a = client(`${ORIGIN}/study`);
		const { ev, waited } = click('/study');
		onNotificationClick(ev, { clients: { matchAll: async () => [a], openWindow: vi.fn() }, origin: ORIGIN });
		await Promise.all(waited);
		expect(a.focus).toHaveBeenCalled();
		expect(a.navigate).not.toHaveBeenCalled();
	});
	it('opens a window when none is open', async () => {
		const openWindow = vi.fn(async () => null);
		const { ev, waited } = click('/study');
		onNotificationClick(ev, { clients: { matchAll: async () => [], openWindow }, origin: ORIGIN });
		await Promise.all(waited);
		expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/study`);
	});
	it('a hostile or missing route is /study', async () => {
		for (const route of ['//evil.example', 'https://evil.example', undefined]) {
			const openWindow = vi.fn(async () => null);
			const { ev, waited } = click(route);
			onNotificationClick(ev, { clients: { matchAll: async () => [], openWindow }, origin: ORIGIN });
			await Promise.all(waited);
			expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/study`);
		}
	});
	it('falls back to focusing when the window cannot navigate', async () => {
		const a = client(`${ORIGIN}/`, { navigate: undefined });
		const { ev, waited } = click('/study');
		onNotificationClick(ev, { clients: { matchAll: async () => [a], openWindow: vi.fn() }, origin: ORIGIN });
		await expect(Promise.all(waited)).resolves.toBeDefined();
		expect(a.focus).toHaveBeenCalled();
	});
});
