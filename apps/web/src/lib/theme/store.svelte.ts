// The theme store: the installed themes (GET /api/themes), the person's
// `appearance` row, the device's light/dark preference, and an optional live
// preview (Settings → Appearance). It paints only once both the themes and
// the row are known, so the first paint (app.html: this device's last
// tokens, else the compiled-in qinqin Day/Night) is never overwritten by a guess;
// every real paint is kept as this device's last tokens. Offline without the
// list, what is painted stays and a device switch repaints from the stored
// tokens. A theme that is gone paints the slot default; the row is never
// rewritten for it.

import { getThemes, type ListedTheme, type ThemePack, type ThemesAnswer } from '$lib/api/themes';
import { coreManifest } from '$lib/plugins/core/manifest';
import { createPluginSdk } from '$lib/plugins/sdk';
import {
	APPEARANCE_KEY,
	parseAppearance,
	resolveAppearance,
	slotFor,
	writeAppearance,
	type Appearance,
	type AppearanceChange,
	type Resolved,
	type Slot
} from './appearance';
import {
	adjustmentVars,
	animateThemeChange,
	applyLastTokens,
	applySlot,
	lastTokensFor,
	loadLastTokens,
	saveLastTokens,
	slotTokens
} from './apply';
import { accentChoices } from './derive';
import { FALLBACK_THEMES, fallbackTheme } from './fallback';
import type { Theme } from './types';

export interface ThemeStoreDeps {
	fetchThemes(): Promise<ThemesAnswer>;
	/** The stored row, null when there is none. */
	loadRow(): Promise<unknown>;
	saveRow(value: unknown): Promise<void>;
	storage(): Storage | null;
	media(): MediaQueryList | null;
	root(): HTMLElement | null;
}

export interface ResolvedPair {
	slot: Slot;
	light: Resolved;
	dark: Resolved;
}

function coreData() {
	return createPluginSdk(coreManifest).data.user();
}

const defaultDeps: ThemeStoreDeps = {
	fetchThemes: getThemes,
	// find() reads through the list route: no row is an empty 200, not a 404.
	loadRow: () => coreData().find(APPEARANCE_KEY),
	saveRow: (value) => coreData().put(APPEARANCE_KEY, value),
	storage: () => {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	},
	media: () => {
		try {
			return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
		} catch {
			return null;
		}
	},
	root: () => (typeof document === 'undefined' ? null : document.documentElement)
};

const COMPILED_IN: ListedTheme[] = FALLBACK_THEMES.map((t) => ({
	...t,
	family: t.family ?? '',
	packId: 'qinqin',
	builtin: true
}));

export function createThemeStore(overrides: Partial<ThemeStoreDeps> = {}) {
	const deps: ThemeStoreDeps = { ...defaultDeps, ...overrides };

	let themes = $state.raw<ListedTheme[]>(COMPILED_IN);
	let packs = $state.raw<ThemePack[]>([]);
	let themesLoaded = $state(false);
	let row = $state.raw<unknown>(null);
	let rowLoaded = $state(false);
	let userId = $state<number | null>(null);
	let preview = $state.raw<Appearance | null>(null);
	let prefersDark = $state(false);
	const appearance = $derived(parseAppearance(row));

	let media: MediaQueryList | null = null;
	const onMedia = (e: { matches: boolean }) => {
		prefersDark = e.matches;
		if (!paint(true)) {
			const last = loadLastTokens(deps.storage());
			const root = deps.root();
			if (last !== null && root !== null) applyLastTokens(last, prefersDark, root);
		}
	};

	function themeOf(id: string): ListedTheme | undefined {
		return themes.find((t) => t.id === id);
	}

	function resolvable() {
		return themes.map((t) => ({
			id: t.id,
			scheme: t.scheme,
			defaultAccent: t.defaultAccent,
			accentChoices: accentChoices(t)
		}));
	}

	function resolveFor(a: Appearance): ResolvedPair {
		const list = resolvable();
		return {
			slot: slotFor(a.mode, prefersDark),
			light: resolveAppearance({ ...a, mode: 'light' }, list, prefersDark),
			dark: resolveAppearance({ ...a, mode: 'dark' }, list, prefersDark)
		};
	}

	function painted(r: Resolved): Theme {
		return themeOf(r.theme) ?? fallbackTheme(r.slot);
	}

	/**
	 * paint: true when it painted (the themes and the row, or a preview, are known).
	 * animate: a person-initiated switch cross-fades the colours; the first
	 * paint and a row/theme-list load do not.
	 */
	function paint(animate = false): boolean {
		const root = deps.root();
		if (root === null || !themesLoaded || (!rowLoaded && preview === null)) return false;
		const a = preview ?? appearance;
		const pair = resolveFor(a);
		const current = pair[pair.slot];
		if (animate) animateThemeChange(root);
		applySlot(slotTokens(painted(current), current.accent), adjustmentVars(a), root);
		if (preview === null) {
			const last = lastTokensFor(a, painted(pair.light), pair.light.accent, painted(pair.dark), pair.dark.accent);
			saveLastTokens(last, deps.storage());
		}
		return true;
	}

	async function refreshThemes(): Promise<void> {
		try {
			const answer = await deps.fetchThemes();
			themes = answer.themes.length > 0 ? answer.themes : COMPILED_IN;
			packs = answer.packs;
			themesLoaded = true;
			paint();
		} catch {
			// Offline without a cached answer: keep what is painted.
		}
	}

	return {
		get themes() {
			return themes;
		},
		get packs() {
			return packs;
		},
		get themesLoaded() {
			return themesLoaded;
		},
		get row() {
			return row;
		},
		get rowLoaded() {
			return rowLoaded;
		},
		get appearance() {
			return appearance;
		},
		get preview() {
			return preview;
		},
		get prefersDark() {
			return prefersDark;
		},
		/** The slot, theme and accent painted now (the preview's while there is one). */
		get current(): Resolved {
			const pair = resolveFor(preview ?? appearance);
			return pair[pair.slot];
		},
		themeOf,
		resolveFor,
		accentChoicesOf(id: string): string[] {
			const t = themeOf(id);
			return t ? accentChoices(t) : [];
		},
		refreshThemes,

		/** start: listen to the device's light/dark switch and load the theme list. */
		async start(): Promise<void> {
			media = deps.media();
			prefersDark = media?.matches ?? false;
			media?.addEventListener('change', onMedia);
			await refreshThemes();
		},
		stop(): void {
			media?.removeEventListener('change', onMedia);
			media = null;
		},

		/** setUser: load the person's row (null: signed out — forget it, keep what is painted). */
		async setUser(id: number | null): Promise<void> {
			userId = id;
			row = null;
			rowLoaded = false;
			preview = null;
			if (id === null) return;
			try {
				const value = await deps.loadRow();
				if (userId !== id) return;
				row = value ?? null;
				rowLoaded = true;
				paint();
			} catch {
				// Offline or a server error: the last tokens stay painted.
			}
		},

		/** setPreview paints a choice without saving it; null returns to the saved one. */
		setPreview(a: Appearance | null): void {
			preview = a;
			if (!paint(true) && a === null) {
				const last = loadLastTokens(deps.storage());
				const root = deps.root();
				if (last !== null && root !== null) applyLastTokens(last, prefersDark, root);
			}
		},

		/**
		 * save writes a change to the row (unknown members kept) and paints it.
		 * The change is merged into a fresh read of the row, so a tab loaded
		 * earlier never writes back another device's change to the members it
		 * did not touch; the known row is the base only when the read fails.
		 * Rejects when the write fails.
		 */
		async save(change: AppearanceChange): Promise<void> {
			const id = userId;
			let base = row;
			try {
				const fresh = await deps.loadRow();
				if (userId !== id) return;
				base = fresh ?? null;
			} catch {
				// Offline or a server error: the row loaded at sign-in is the base.
			}
			const next = writeAppearance(base, change);
			await deps.saveRow(next);
			row = next;
			rowLoaded = true;
			paint(true);
		}
	};
}

export type ThemeStore = ReturnType<typeof createThemeStore>;

/** The app's one theme store (wired once in routes/+layout.svelte). */
export const themeStore = createThemeStore();
