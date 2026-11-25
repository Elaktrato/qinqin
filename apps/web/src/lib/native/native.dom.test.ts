import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissTop, registerDismissable } from '$lib/ui/dismissStack';
import { pressEscape } from './back';
import { startBars } from './bars';
import { canChangeServer, changeServer, isShell, startNative } from './index';
import { plugin } from './shell';

type Win = { Capacitor?: unknown };
const win = window as unknown as Win;

afterEach(() => {
	delete win.Capacitor;
	document.documentElement.removeAttribute('style');
});

function fakeShell() {
	let backListener: ((e: { canGoBack: boolean }) => void) | undefined;
	const App = {
		addListener: vi.fn(async (_: string, l: (e: { canGoBack: boolean }) => void) => {
			backListener = l;
			return { remove: vi.fn(async () => undefined) };
		}),
		minimizeApp: vi.fn(async () => undefined),
		exitApp: vi.fn(async () => undefined)
	};
	const QinqinShell = { clearServer: vi.fn(async () => undefined), setBars: vi.fn(async () => undefined) };
	win.Capacitor = { isNativePlatform: () => true, Plugins: { App, QinqinShell } };
	return { App, QinqinShell, press: (canGoBack: boolean) => backListener?.({ canGoBack }) };
}

describe('in a normal browser', () => {
	it('is not the shell and every call does nothing', async () => {
		expect(isShell()).toBe(false);
		expect(canChangeServer()).toBe(false);
		expect(plugin('App')).toBeNull();
		const stop = startNative();
		stop();
		await expect(changeServer()).resolves.toBeUndefined();
	});

	it('a Capacitor global that is not native (the web build of Capacitor) is not the shell either', () => {
		win.Capacitor = { isNativePlatform: () => false, Plugins: { App: {} } };
		expect(isShell()).toBe(false);
		expect(plugin('App')).toBeNull();
	});
});

describe('in the shell', () => {
	it('back closes an overlay first, then goes back, then minimises', async () => {
		const shell = fakeShell();
		const closed = vi.fn();
		const stop = startNative();
		await vi.waitFor(() => expect(shell.App.addListener).toHaveBeenCalledWith('backButton', expect.any(Function)));
		const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);

		const off = registerDismissable(closed);
		shell.press(true);
		expect(closed).toHaveBeenCalledOnce();
		expect(back).not.toHaveBeenCalled();
		off();

		shell.press(true);
		expect(back).toHaveBeenCalledOnce();
		expect(shell.App.minimizeApp).not.toHaveBeenCalled();

		shell.press(false);
		expect(shell.App.minimizeApp).toHaveBeenCalledOnce();
		stop();
		back.mockRestore();
	});

	it('an Escape-closable overlay outside the registry is closed by the back button', async () => {
		const shell = fakeShell();
		startNative();
		await vi.waitFor(() => expect(shell.App.addListener).toHaveBeenCalled());
		const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') e.preventDefault();
		};
		window.addEventListener('keydown', onKey);
		shell.press(true);
		expect(back).not.toHaveBeenCalled();
		window.removeEventListener('keydown', onKey);
		shell.press(true);
		expect(back).toHaveBeenCalledOnce();
		back.mockRestore();
	});

	it('changeServer asks the shell to forget the address', async () => {
		const shell = fakeShell();
		expect(canChangeServer()).toBe(true);
		await changeServer();
		expect(shell.QinqinShell.clearServer).toHaveBeenCalledOnce();
	});

	it('paints the bars from --chrome at the start and when the theme changes', async () => {
		const shell = fakeShell();
		const root = document.documentElement;
		root.style.setProperty('--chrome', '#e3f4fa');
		const stop = startNative();
		expect(shell.QinqinShell.setBars).toHaveBeenLastCalledWith({ background: '#e3f4fa', darkIcons: true });
		root.style.setProperty('--chrome', '#201533');
		await vi.waitFor(() => expect(shell.QinqinShell.setBars).toHaveBeenLastCalledWith({ background: '#201533', darkIcons: false }));
		stop();
	});
});

describe('startBars', () => {
	it('applies only when the style changes', () => {
		const root = document.documentElement;
		root.style.setProperty('--chrome', '#ffffff');
		const apply = vi.fn();
		let fire = () => undefined as void;
		const stop = startBars({ root, apply, watch: (_r, on) => ((fire = on), () => undefined) });
		fire();
		fire();
		expect(apply).toHaveBeenCalledOnce();
		root.style.setProperty('--chrome', '#000000');
		fire();
		expect(apply).toHaveBeenCalledTimes(2);
		stop();
	});

	it('applies nothing while the colour is unknown', () => {
		const apply = vi.fn();
		startBars({ root: document.documentElement, apply, watch: () => () => undefined });
		expect(apply).not.toHaveBeenCalled();
	});
});

describe('pressEscape', () => {
	it('reports whether a listener handled the key', () => {
		expect(pressEscape(document)).toBe(false);
		const onKey = (e: KeyboardEvent) => e.preventDefault();
		document.addEventListener('keydown', onKey);
		expect(pressEscape(document)).toBe(true);
		document.removeEventListener('keydown', onKey);
	});
	it('leaves the dismiss stack alone', () => {
		expect(dismissTop()).toBe(false);
	});
});
