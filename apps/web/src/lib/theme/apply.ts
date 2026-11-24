// Painting a theme: the CSS custom properties of docs/contracts/themes/
// README.md ("Derived tokens") plus the person's adjustments go on :root.
// The last painted tokens of both slots are kept on this device
// (`qinqin.theme.last.v1`), so the next start paints before anything loads:
// app.html's first-paint script reads them (it mirrors applyLastTokens; a
// test runs both and compares), and applyStartupTheme paints them, or the
// compiled-in qinqin Day/Night, before the app mounts.

import { ADJUSTMENTS, DEFAULT_APPEARANCE, MODES, slotFor, type Appearance, type Mode, type Slot } from './appearance';
import { cssVariables, derive, TOKEN_NAMES } from './derive';
import { fallbackTheme } from './fallback';
import type { Theme } from './types';

/** Per device, not per user: the frame paints before the user is known. */
export const LAST_TOKENS_KEY = 'qinqin.theme.last.v1';

export interface SlotTokens {
	scheme: 'light' | 'dark';
	/** Every property of TOKEN_NAMES, in that order. */
	vars: Record<string, string>;
}

export interface AdjustmentVars {
	'--radius': string;
	'--space': string;
}

export interface LastTokens {
	v: 1;
	mode: Mode;
	light: SlotTokens;
	dark: SlotTokens;
	radius: string;
	space: string;
}

const COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;
const RADIUS = /^(4|10|16)px$/;
const SPACE = /^(0\.75|1)$/;

/** slotTokens: the painted properties of a theme with the requested accent. */
export function slotTokens(theme: Theme, accent: string | null): SlotTokens {
	return { scheme: theme.scheme, vars: { ...cssVariables(theme, derive(theme, accent)) } };
}

/** adjustmentVars: corners and spacing as properties (the hanzi font: lib/fonts/hanziVars.ts, set by the root layout). */
export function adjustmentVars(a: Appearance): AdjustmentVars {
	return {
		'--radius': `${ADJUSTMENTS.corners[a.corners]}px`,
		'--space': String(ADJUSTMENTS.spacing[a.spacing])
	};
}

function setThemeColor(color: string | undefined): void {
	if (typeof document === 'undefined' || !color) return;
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute('content', color);
}

/** The class that turns on the brief colour transition of a theme switch. */
export const THEME_ANIM_CLASS = 'theme-anim';
// The cross-fade timer of each root (the document's one), so a second switch restarts it.
const themeAnimTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * animateThemeChange marks `root` so colours cross-fade once (app.css,
 * `html.theme-anim`); it removes the class when the transition ends, so
 * hover and layout animations keep their own timing. A reduced-motion
 * device gets a 0ms transition and sees no change.
 */
export function animateThemeChange(root: HTMLElement | null): void {
	if (root === null || typeof root.classList === 'undefined') return;
	root.classList.add(THEME_ANIM_CLASS);
	const running = themeAnimTimers.get(root);
	if (running !== undefined) clearTimeout(running);
	themeAnimTimers.set(
		root,
		setTimeout(() => {
			root.classList.remove(THEME_ANIM_CLASS);
			themeAnimTimers.delete(root);
		}, 240)
	);
}

/** applySlot paints one slot's tokens and the adjustments on `root`. */
export function applySlot(slot: SlotTokens, adj: AdjustmentVars, root: HTMLElement): void {
	for (const [name, value] of Object.entries(slot.vars)) root.style.setProperty(name, value);
	root.style.setProperty('--radius', adj['--radius']);
	root.style.setProperty('--space', adj['--space']);
	root.style.colorScheme = slot.scheme;
	root.dataset.scheme = slot.scheme;
	setThemeColor(slot.vars['--chrome']);
}

/** lastTokensFor: what to keep for the next start (both slots, so `system` follows the device then too). */
export function lastTokensFor(
	a: Appearance,
	light: Theme,
	lightAccent: string | null,
	dark: Theme,
	darkAccent: string | null
): LastTokens {
	const adj = adjustmentVars(a);
	return {
		v: 1,
		mode: a.mode,
		light: slotTokens(light, lightAccent),
		dark: slotTokens(dark, darkAccent),
		radius: adj['--radius'],
		space: adj['--space']
	};
}

/** applyLastTokens paints stored tokens: the slot of the mode, `system` by the device. */
export function applyLastTokens(last: LastTokens, prefersDark: boolean, root: HTMLElement): void {
	const slot: Slot = slotFor(last.mode, prefersDark);
	applySlot(last[slot], { '--radius': last.radius, '--space': last.space }, root);
}

function deviceStorage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

export function saveLastTokens(last: LastTokens, storage: Storage | null = deviceStorage()): void {
	try {
		storage?.setItem(LAST_TOKENS_KEY, JSON.stringify(last));
	} catch {
		// Private mode, quota, blocked site data: the next start paints the fallback.
	}
}

function validSlot(v: unknown): v is SlotTokens {
	if (typeof v !== 'object' || v === null) return false;
	const s = v as Record<string, unknown>;
	if (s.scheme !== 'light' && s.scheme !== 'dark') return false;
	if (typeof s.vars !== 'object' || s.vars === null || Array.isArray(s.vars)) return false;
	const vars = s.vars as Record<string, unknown>;
	const keys = Object.keys(vars);
	if (keys.length !== TOKEN_NAMES.length) return false;
	return TOKEN_NAMES.every((name) => typeof vars[name] === 'string' && COLOR.test(vars[name] as string));
}

/** loadLastTokens: the stored tokens, or null when there are none or they are not exactly what saveLastTokens writes. */
export function loadLastTokens(storage: Storage | null = deviceStorage()): LastTokens | null {
	let raw: string | null;
	try {
		raw = storage?.getItem(LAST_TOKENS_KEY) ?? null;
	} catch {
		return null;
	}
	if (raw === null) return null;
	let v: unknown;
	try {
		v = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
	const o = v as Record<string, unknown>;
	if (o.v !== 1 || !(MODES as readonly unknown[]).includes(o.mode)) return null;
	if (!validSlot(o.light) || !validSlot(o.dark)) return null;
	if (typeof o.radius !== 'string' || !RADIUS.test(o.radius)) return null;
	if (typeof o.space !== 'string' || !SPACE.test(o.space)) return null;
	return o as unknown as LastTokens;
}

export function prefersDarkScheme(): boolean {
	try {
		return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
	} catch {
		return false;
	}
}

/**
 * applyStartupTheme runs before the app mounts: the last tokens of this
 * device, else the compiled-in qinqin Day or Night by the device preference.
 */
export function applyStartupTheme(
	storage: Storage | null = deviceStorage(),
	prefersDark: boolean = prefersDarkScheme(),
	root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement
): 'last' | 'fallback' | 'none' {
	if (root === null) return 'none';
	const last = loadLastTokens(storage);
	if (last !== null) {
		applyLastTokens(last, prefersDark, root);
		return 'last';
	}
	const slot: Slot = prefersDark ? 'dark' : 'light';
	const theme = fallbackTheme(slot);
	applySlot(slotTokens(theme, null), adjustmentVars(DEFAULT_APPEARANCE), root);
	return 'fallback';
}
