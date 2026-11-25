import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanSharedText, lookupHref, routeHref, startIncoming } from './incoming';

const win = window as unknown as { Capacitor?: unknown };
afterEach(() => {
	delete win.Capacitor;
});

describe('cleanSharedText', () => {
	it('is plain text: control characters and markup-looking input stay inert text, whitespace collapses', () => {
		expect(cleanSharedText('  你好\n\n世界\u0000 ')).toBe('你好 世界');
		expect(cleanSharedText('<b>x</b>')).toBe('<b>x</b>');
		expect(cleanSharedText('   ')).toBeNull();
		expect(cleanSharedText(undefined)).toBeNull();
		expect(cleanSharedText(42 as unknown as string)).toBeNull();
	});

	it('is capped at 200 characters without splitting a surrogate pair', () => {
		const s = cleanSharedText('x'.repeat(199) + '😀tail');
		expect(s).toBe('x'.repeat(199));
		expect(cleanSharedText('y'.repeat(900))?.length).toBe(200);
	});
});

describe('lookupHref and routeHref', () => {
	it('builds an encoded search address', () => {
		expect(lookupHref('你好 世界&x=1')).toBe('/search?q=' + encodeURIComponent('你好 世界&x=1'));
		expect(lookupHref('')).toBeNull();
	});

	it('accepts only in-app paths', () => {
		expect(routeHref('/study')).toBe('/study');
		expect(routeHref('/search?q=%E4%BD%A0')).toBe('/search?q=%E4%BD%A0');
		for (const bad of ['//evil.example', 'https://evil.example', 'javascript:1', 'study', '/\\evil', '/a\nb', '/api/me', '/api', '', null, 7, '/x/../api/me', '/..', '/%2e%2e/api', '/%2E/api', '/./api/me', '/x%5Capi', '/a\\b', '///x', ' /study']) {
			expect(routeHref(bad as unknown as string), String(bad)).toBeNull();
		}
	});
});

describe('startIncoming', () => {
	const fake = (batches: { kind: string; value: string }[][]) => {
		let listener: (() => void) | undefined;
		const takeIncoming = vi.fn(async () => ({ items: batches.shift() ?? [] }));
		const addListener = vi.fn(async (_: string, l: () => void) => {
			listener = l;
			return { remove: vi.fn(async () => undefined) };
		});
		win.Capacitor = { isNativePlatform: () => true, Plugins: { QinqinShare: { takeIncoming, addListener } } };
		return { takeIncoming, arrive: () => listener?.() };
	};

	it('does nothing in a normal browser', () => {
		const open = vi.fn();
		const h = startIncoming({ ready: () => true, open });
		h.poke();
		h.stop();
		expect(open).not.toHaveBeenCalled();
	});

	it('queues until the app is ready, then opens the lookup once', async () => {
		const shell = fake([[{ kind: 'text', value: '你好' }]]);
		let ready = false;
		const open = vi.fn();
		const h = startIncoming({ ready: () => ready, open });
		await vi.waitFor(() => expect(shell.takeIncoming).toHaveBeenCalled());
		await Promise.resolve();
		expect(open).not.toHaveBeenCalled();
		ready = true;
		h.poke();
		expect(open).toHaveBeenCalledOnce();
		expect(open).toHaveBeenCalledWith('/search?q=' + encodeURIComponent('你好'));
		h.poke();
		expect(open).toHaveBeenCalledOnce();
	});

	it('a warm start (the incoming event) is taken and opened when ready', async () => {
		const shell = fake([[], [{ kind: 'route', value: '/study' }]]);
		const open = vi.fn();
		startIncoming({ ready: () => true, open });
		await vi.waitFor(() => expect(shell.takeIncoming).toHaveBeenCalledTimes(1));
		shell.arrive();
		await vi.waitFor(() => expect(open).toHaveBeenCalledWith('/study'));
	});

	it('drops items that do not validate and keeps only the newest of several', async () => {
		fake([[{ kind: 'route', value: '//evil.example' }, { kind: 'text', value: '  ' }, { kind: 'text', value: 'one' }, { kind: 'text', value: 'two' }]]);
		const open = vi.fn();
		startIncoming({ ready: () => true, open });
		await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
		expect(open).toHaveBeenCalledWith('/search?q=two');
	});
});
