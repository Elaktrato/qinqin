import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAppearance } from './appearance';
import {
	LAST_TOKENS_KEY,
	adjustmentVars,
	applyLastTokens,
	applySlot,
	applyStartupTheme,
	lastTokensFor,
	loadLastTokens,
	saveLastTokens,
	slotTokens,
	type LastTokens
} from './apply';
import { TOKEN_NAMES } from './derive';
import { FALLBACK_THEMES, fallbackTheme } from './fallback';

const latte = fallbackTheme('light');
const mocha = fallbackTheme('dark');

function clearRoot(root: HTMLElement): void {
	root.removeAttribute('style');
	root.removeAttribute('data-scheme');
}

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

function throwingStorage(): Storage {
	const fail = () => {
		throw new Error('SecurityError');
	};
	return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

const root = document.documentElement;
beforeEach(() => clearRoot(root));
afterEach(() => clearRoot(root));

describe('slotTokens / applySlot', () => {
	it('sets every token of the README table, the adjustments and color-scheme', () => {
		const slot = slotTokens(mocha, 'blue');
		applySlot(slot, adjustmentVars(parseAppearance(null)), root);
		for (const name of TOKEN_NAMES) expect(root.style.getPropertyValue(name)).not.toBe('');
		expect(root.style.getPropertyValue('--panel')).toBe('#1e1e2e');
		expect(root.style.getPropertyValue('--accent')).toBe('#89b4fa');
		expect(root.style.getPropertyValue('--radius')).toBe('10px');
		expect(root.style.getPropertyValue('--space')).toBe('1');
		expect(root.style.colorScheme).toBe('dark');
		expect(root.dataset.scheme).toBe('dark');
	});

	it('maps corners and spacing', () => {
		const a = parseAppearance({ version: 1, corners: 'round', spacing: 'compact' });
		expect(adjustmentVars(a)).toEqual({ '--radius': '16px', '--space': '0.75' });
		const s = parseAppearance({ version: 1, corners: 'sharp' });
		expect(adjustmentVars(s)['--radius']).toBe('4px');
	});

	it('repaints the browser bar colour from chrome', () => {
		const meta = document.createElement('meta');
		meta.name = 'theme-color';
		meta.content = '#0b6bcb';
		document.head.append(meta);
		applySlot(slotTokens(latte, null), adjustmentVars(parseAppearance(null)), root);
		expect(meta.content).toBe('#dce0e8');
		meta.remove();
	});
});

describe('last tokens', () => {
	const last = lastTokensFor(parseAppearance({ version: 1, mode: 'dark', corners: 'round' }), latte, 'mauve', mocha, 'pink');

	it('round-trips through storage under the device key', () => {
		const s = memoryStorage();
		saveLastTokens(last, s);
		expect(s.getItem(LAST_TOKENS_KEY)).not.toBeNull();
		expect(LAST_TOKENS_KEY).toBe('qinqin.theme.last.v1');
		expect(loadLastTokens(s)).toEqual(last);
	});

	it('survives a storage that throws (private mode, blocked site data)', () => {
		expect(() => saveLastTokens(last, throwingStorage())).not.toThrow();
		expect(loadLastTokens(throwingStorage())).toBeNull();
		expect(loadLastTokens(null)).toBeNull();
	});

	it('refuses a corrupt or tampered value', () => {
		const s = memoryStorage();
		for (const bad of [
			'not json',
			'[]',
			JSON.stringify({ ...last, v: 2 }),
			JSON.stringify({ ...last, mode: 'sepia' }),
			JSON.stringify({ ...last, dark: { scheme: 'dark', vars: { ...last.dark.vars, '--panel': 'red;x' } } }),
			JSON.stringify({ ...last, light: { scheme: 'light', vars: { ...last.light.vars, '--evil': '#000000' } } }),
			JSON.stringify({ ...last, radius: 'calc(1px)' })
		]) {
			s.setItem(LAST_TOKENS_KEY, bad);
			expect(loadLastTokens(s), bad).toBeNull();
		}
	});

	it('paints the slot the mode and the device choose', () => {
		applyLastTokens({ ...last, mode: 'system' }, false, root);
		expect(root.style.getPropertyValue('--panel')).toBe('#eff1f5');
		applyLastTokens({ ...last, mode: 'system' }, true, root);
		expect(root.style.getPropertyValue('--panel')).toBe('#1e1e2e');
		expect(root.style.getPropertyValue('--accent')).toBe('#f5c2e7');
		applyLastTokens(last, false, root);
		expect(root.style.colorScheme).toBe('dark');
		expect(root.style.getPropertyValue('--radius')).toBe('16px');
	});
});

describe('applyStartupTheme (before the app mounts)', () => {
	it('uses the last tokens when there are some', () => {
		const s = memoryStorage();
		saveLastTokens(lastTokensFor(parseAppearance({ version: 1, mode: 'light' }), FALLBACK_THEMES[0], 'teal', mocha, null), s);
		expect(applyStartupTheme(s, true, root)).toBe('last');
		expect(root.style.getPropertyValue('--accent')).toBe('#179299');
	});

	it('falls back to the compiled-in Latte or Mocha by the device preference', () => {
		expect(applyStartupTheme(memoryStorage(), false, root)).toBe('fallback');
		expect(root.style.getPropertyValue('--panel')).toBe('#eff1f5');
		expect(applyStartupTheme(throwingStorage(), true, root)).toBe('fallback');
		expect(root.style.getPropertyValue('--panel')).toBe('#1e1e2e');
	});
});

describe('the first-paint script in app.html', () => {
	const html = readFileSync(resolve(__dirname, '../../app.html'), 'utf8');
	const match = html.match(/<script>([\s\S]*?)<\/script>/);

	it('exists, runs before the app and reads the same key', () => {
		expect(match).not.toBeNull();
		expect(match![1]).toContain(LAST_TOKENS_KEY);
		// No colour of its own: only the stored tokens are painted.
		expect(match![1]).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?!\])/);
	});

	function runScript(stored: string | null, prefersDark: boolean): void {
		const s = memoryStorage();
		if (stored !== null) s.setItem(LAST_TOKENS_KEY, stored);
		const fn = new Function('localStorage', 'matchMedia', 'document', match![1]);
		fn(s, () => ({ matches: prefersDark }), document);
	}

	it('paints exactly what applyLastTokens paints', () => {
		const last: LastTokens = lastTokensFor(parseAppearance({ version: 1, corners: 'sharp', spacing: 'compact' }), latte, 'blue', mocha, 'pink');
		for (const dark of [false, true]) {
			clearRoot(root);
			applyLastTokens(last, dark, root);
			const want = root.getAttribute('style');
			clearRoot(root);
			runScript(JSON.stringify(last), dark);
			expect(root.getAttribute('style')).toBe(want);
			expect(root.dataset.scheme).toBe(dark ? 'dark' : 'light');
		}
	});

	it('paints nothing without stored tokens, with corrupt ones, or when storage throws', () => {
		runScript(null, true);
		expect(root.getAttribute('style')).toBeNull();
		runScript('{"v":1,"mode":"dark","dark":{"scheme":"dark","vars":{"--panel":"url(x)"}}}', true);
		expect(root.style.getPropertyValue('--panel')).toBe('');
		const fn = new Function('localStorage', 'matchMedia', 'document', match![1]);
		expect(() => fn(throwingStorage(), () => ({ matches: true }), document)).not.toThrow();
	});

	it('names exactly TOKEN_NAMES, in order', () => {
		const list = match![1].match(/var NAMES = \[([^\]]*)\]/);
		expect(list).not.toBeNull();
		const names = [...list![1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
		expect(names).toEqual([...TOKEN_NAMES]);
	});

	it('paints nothing when the stored names are not exactly TOKEN_NAMES (as loadLastTokens)', () => {
		const last: LastTokens = lastTokensFor(parseAppearance(null), latte, 'mauve', mocha, 'mauve');
		const extra = { ...last, dark: { ...last.dark, vars: { ...last.dark.vars, '--evil': '#000000' } } };
		runScript(JSON.stringify(extra), true);
		expect(root.getAttribute('style')).toBeNull();
		const { '--panel': _, ...rest } = last.dark.vars;
		const missing = { ...last, dark: { ...last.dark, vars: rest } };
		runScript(JSON.stringify(missing), true);
		expect(root.getAttribute('style')).toBeNull();
	});
});
