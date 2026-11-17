import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListedTheme, ThemesAnswer } from '$lib/api/themes';
import { LAST_TOKENS_KEY, loadLastTokens } from './apply';
import { FALLBACK_THEMES } from './fallback';
import { createThemeStore, type ThemeStoreDeps } from './store.svelte';
import type { Theme } from './types';

function listed(theme: Theme, packId = 'catppuccin'): ListedTheme {
	return { ...theme, family: theme.family ?? '', packId, builtin: true };
}

const latte = listed(FALLBACK_THEMES[0]);
const mocha = listed(FALLBACK_THEMES[1]);
const nord: ListedTheme = {
	...listed(FALLBACK_THEMES[1], 'nord'),
	id: 'nord',
	name: 'Nord',
	family: '',
	colors: { ...FALLBACK_THEMES[1].colors, panel: '#2e3440', chrome: '#242933' },
	accents: { frost: '#88c0d0', glacier: '#81a1c1' },
	defaultAccent: 'frost'
};
const answer: ThemesAnswer = { themes: [latte, mocha, nord], packs: [] };

function memoryStorage(): Storage {
	const m = new Map<string, string>();
	return {
		get length() {
			return m.size;
		},
		clear: () => m.clear(),
		getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
		key: (i) => [...m.keys()][i] ?? null,
		removeItem: (k) => void m.delete(k),
		setItem: (k, v) => void m.set(k, String(v))
	};
}

function fakeMedia(initial: boolean) {
	let listener: ((e: { matches: boolean }) => void) | null = null;
	const mq = {
		matches: initial,
		addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => (listener = fn),
		removeEventListener: () => (listener = null)
	};
	return {
		mq: mq as unknown as MediaQueryList,
		flip(matches: boolean) {
			mq.matches = matches;
			listener?.({ matches });
		}
	};
}

const root = document.documentElement;
const panel = () => root.style.getPropertyValue('--panel');
const accent = () => root.style.getPropertyValue('--accent');

let storage: Storage;
let media: ReturnType<typeof fakeMedia>;
let deps: ThemeStoreDeps;

beforeEach(() => {
	root.removeAttribute('style');
	storage = memoryStorage();
	media = fakeMedia(false);
	deps = {
		fetchThemes: vi.fn(async () => answer),
		loadRow: vi.fn(async () => null),
		saveRow: vi.fn(async () => {}),
		storage: () => storage,
		media: () => media.mq,
		root: () => root
	};
});
afterEach(() => root.removeAttribute('style'));

describe('theme store', () => {
	it('paints nothing over the first paint until both the themes and the row are known', async () => {
		root.style.setProperty('--panel', '#123456');
		const store = createThemeStore(deps);
		await store.start();
		expect(panel()).toBe('#123456');
		await store.setUser(1);
		expect(panel()).toBe('#eff1f5'); // no row: Latte on a light device
	});

	it('follows the device in system mode and keeps the last tokens of both slots', async () => {
		deps.loadRow = vi.fn(async () => ({ version: 1, mode: 'system', dark: { theme: 'nord', accent: 'glacier' } }));
		const store = createThemeStore(deps);
		await store.start();
		await store.setUser(1);
		expect(panel()).toBe('#eff1f5');
		media.flip(true);
		expect(panel()).toBe('#2e3440');
		expect(accent()).toBe('#81a1c1');
		expect(root.style.colorScheme).toBe('dark');
		const last = loadLastTokens(storage)!;
		expect(last.mode).toBe('system');
		expect(last.light.vars['--panel']).toBe('#eff1f5');
		expect(last.dark.vars['--panel']).toBe('#2e3440');
	});

	it('a removed theme paints the slot default and leaves the row unchanged', async () => {
		const row = { version: 1, mode: 'dark', dark: { theme: 'gone-theme', accent: 'pink' } };
		deps.loadRow = vi.fn(async () => row);
		const store = createThemeStore(deps);
		await store.start();
		await store.setUser(1);
		expect(panel()).toBe('#1e1e2e');
		expect(accent()).toBe('#f5c2e7');
		expect(deps.saveRow).not.toHaveBeenCalled();
		expect(store.row).toEqual(row);
	});

	it('offline: keeps the painted tokens; the picker lists the compiled-in themes', async () => {
		deps.fetchThemes = vi.fn(async () => {
			throw new TypeError('offline');
		});
		root.style.setProperty('--panel', '#123456');
		const store = createThemeStore(deps);
		await store.start();
		await store.setUser(1);
		expect(panel()).toBe('#123456');
		expect(store.themesLoaded).toBe(false);
		expect(store.themes.map((t) => t.id)).toEqual(['catppuccin-latte', 'catppuccin-mocha']);
	});

	it('offline with stored tokens: a device switch repaints from them', async () => {
		deps.fetchThemes = vi.fn(async () => {
			throw new TypeError('offline');
		});
		const online = createThemeStore({ ...deps, fetchThemes: vi.fn(async () => answer) });
		await online.start();
		await online.setUser(1);
		online.stop();
		root.removeAttribute('style');
		const store = createThemeStore(deps);
		await store.start();
		media.flip(true);
		expect(panel()).toBe('#1e1e2e');
	});

	it('a row that fails to load keeps what is painted', async () => {
		deps.loadRow = vi.fn(async () => {
			throw new Error('500');
		});
		root.style.setProperty('--panel', '#123456');
		const store = createThemeStore(deps);
		await store.start();
		await store.setUser(1);
		expect(panel()).toBe('#123456');
	});

	it('save writes the row with unknown members kept and repaints', async () => {
		deps.loadRow = vi.fn(async () => ({ version: 1, mode: 'light', future: 1 }));
		const store = createThemeStore(deps);
		await store.start();
		await store.setUser(1);
		await store.save({ light: { theme: 'nord', accent: 'glacier' } });
		expect(deps.saveRow).toHaveBeenCalledWith(
			expect.objectContaining({ version: 1, mode: 'light', future: 1, light: { theme: 'nord', accent: 'glacier' } })
		);
		expect(panel()).toBe('#2e3440');
		expect(store.appearance.light.theme).toBe('nord');
	});

	it('save merges the change into a fresh read: a stale tab keeps another device’s other-slot change', async () => {
		let server: unknown = { version: 1, mode: 'light' };
		const shared = {
			loadRow: vi.fn(async () => (server === null ? null : JSON.parse(JSON.stringify(server)))),
			saveRow: vi.fn(async (value: unknown) => {
				server = JSON.parse(JSON.stringify(value));
			})
		};
		const tabA = createThemeStore({ ...deps, ...shared });
		const tabB = createThemeStore({ ...deps, ...shared });
		for (const tab of [tabA, tabB]) {
			await tab.start();
			await tab.setUser(1);
		}
		await tabB.save({ dark: { theme: 'nord', accent: 'glacier' } });
		// Tab A loaded the row before tab B's save and changes the other slot.
		await tabA.save({ light: { theme: 'catppuccin-latte', accent: 'blue' } });
		expect(server).toEqual(
			expect.objectContaining({
				mode: 'light',
				light: { theme: 'catppuccin-latte', accent: 'blue' },
				dark: { theme: 'nord', accent: 'glacier' }
			})
		);
		expect(tabA.appearance.dark.theme).toBe('nord');
	});

	it('save falls back to the known row when the fresh read fails', async () => {
		deps.loadRow = vi
			.fn()
			.mockResolvedValueOnce({ version: 1, mode: 'dark', future: 1 })
			.mockRejectedValue(new Error('offline'));
		const store = createThemeStore(deps);
		await store.start();
		await store.setUser(1);
		await store.save({ corners: 'round' });
		expect(deps.saveRow).toHaveBeenCalledWith(
			expect.objectContaining({ version: 1, mode: 'dark', future: 1, corners: 'round' })
		);
	});

	it('a failed save keeps the row and the painted theme, and rejects', async () => {
		deps.saveRow = vi.fn(async () => {
			throw new Error('offline');
		});
		const store = createThemeStore(deps);
		await store.start();
		await store.setUser(1);
		await expect(store.save({ light: { theme: 'nord' } })).rejects.toBeTruthy();
		expect(panel()).toBe('#eff1f5');
		expect(store.row).toBeNull();
	});

	it('a preview paints without saving the last tokens; clearing it repaints the saved choice', async () => {
		const store = createThemeStore(deps);
		await store.start();
		await store.setUser(1);
		const before = storage.getItem(LAST_TOKENS_KEY);
		store.setPreview({ ...store.appearance, light: { theme: 'nord', accent: null } });
		expect(panel()).toBe('#2e3440');
		expect(storage.getItem(LAST_TOKENS_KEY)).toBe(before);
		store.setPreview(null);
		expect(panel()).toBe('#eff1f5');
	});

	it('signing out forgets the row and the preview but keeps the painted theme', async () => {
		deps.loadRow = vi.fn(async () => ({ version: 1, mode: 'dark', dark: { theme: 'nord' } }));
		const store = createThemeStore(deps);
		await store.start();
		await store.setUser(1);
		expect(panel()).toBe('#2e3440');
		await store.setUser(null);
		expect(store.row).toBeNull();
		expect(panel()).toBe('#2e3440');
	});

	it('a late row of a previous user is ignored', async () => {
		let release: (v: unknown) => void = () => {};
		deps.loadRow = vi.fn(() => new Promise((r) => (release = r)));
		const store = createThemeStore(deps);
		await store.start();
		const first = store.setUser(1);
		await store.setUser(null);
		release({ version: 1, mode: 'dark' });
		await first;
		expect(store.row).toBeNull();
	});

	it('resolves both slots for the settings page', async () => {
		const store = createThemeStore(deps);
		await store.start();
		await store.setUser(1);
		const r = store.resolveFor({ ...store.appearance, mode: 'dark', dark: { theme: 'nord', accent: 'bogus' } });
		expect(r.slot).toBe('dark');
		expect(r.dark).toMatchObject({ theme: 'nord', accent: 'frost' });
		expect(r.light).toMatchObject({ theme: 'catppuccin-latte', accent: 'mauve' });
		expect(store.accentChoicesOf('catppuccin-latte')).toContain('mauve');
		expect(store.accentChoicesOf('catppuccin-latte')).not.toContain('yellow');
	});
});
