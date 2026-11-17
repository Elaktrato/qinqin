import { afterEach, describe, expect, it } from 'vitest';
import { getLanguage, resetCatalogue } from '$lib/i18n';
import { load } from './+layout';

// The root layout's load installs the interface catalogue and sets <html lang>/dir before the app mounts (spec
// "lang and dir attributes"; app.html's static lang="en" is only the pre-mount default).

afterEach(() => {
	resetCatalogue();
	localStorage.clear();
	document.documentElement.removeAttribute('lang');
	document.documentElement.removeAttribute('dir');
});

describe('root layout load', () => {
	it('signed out: the browser languages decide, and <html lang> follows before mount', async () => {
		document.documentElement.setAttribute('lang', 'xx');
		await load();
		expect(getLanguage()).toBe('en');
		expect(document.documentElement.getAttribute('lang')).toBe('en');
		expect(document.documentElement.getAttribute('dir')).toBe('ltr');
	});

	it('signed in and offline: the mirrored language is used without asking the server', async () => {
		localStorage.setItem('qinqin.token', 'tok');
		localStorage.setItem('qq.interfaceLanguage', 'en');
		await load();
		expect(document.documentElement.getAttribute('lang')).toBe('en');
	});

	it('blocked storage still starts in the browser language', async () => {
		const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('denied');
			}
		});
		try {
			await load();
			expect(document.documentElement.getAttribute('lang')).toBe('en');
		} finally {
			if (original) Object.defineProperty(window, 'localStorage', original);
		}
	});
});

describe('root layout load: the theme before mount', () => {
	afterEach(() => {
		document.documentElement.removeAttribute('style');
		document.documentElement.removeAttribute('data-scheme');
	});

	it('paints the compiled-in fallback when this device has no stored tokens', async () => {
		await load();
		expect(document.documentElement.style.getPropertyValue('--panel')).toMatch(/^#[0-9a-f]{6}$/);
		expect(document.documentElement.dataset.scheme).toMatch(/^(light|dark)$/);
	});
});
