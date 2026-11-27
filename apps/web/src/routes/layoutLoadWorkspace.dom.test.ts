import { afterEach, describe, expect, it, vi } from 'vitest';

// An offline start in a workspace with its own interface language (#297): the root layout's load picks the
// remembered workspace's mirrored setting before any request. A fake second catalogue `xx` is mocked in, and the
// catalogue loader records what it was asked to install.
vi.mock('$lib/i18n/negotiate', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/i18n/negotiate')>()),
	SUPPORTED_LANGUAGES: ['en', 'xx']
}));
const { loadCatalogue } = vi.hoisted(() => ({ loadCatalogue: vi.fn(async () => undefined) }));
vi.mock('$lib/i18n', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/i18n')>()),
	loadCatalogue
}));

import { load } from './+layout';

afterEach(() => {
	localStorage.clear();
	loadCatalogue.mockClear();
});

describe('root layout load in a workspace (#297)', () => {
	it('signed in and offline in a workspace with its own language: that language, no request', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		localStorage.setItem('qinqin.token', 'tok');
		localStorage.setItem('qinqin.workspace', '7');
		localStorage.setItem('qq.interfaceLanguage', 'en');
		localStorage.setItem('qq.interfaceLanguage.workspace.7', 'xx');
		await load();
		expect(loadCatalogue).toHaveBeenCalledWith('xx');
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it('another remembered workspace without its own language: the account mirror', async () => {
		localStorage.setItem('qinqin.token', 'tok');
		localStorage.setItem('qinqin.workspace', '8');
		localStorage.setItem('qq.interfaceLanguage', 'en');
		localStorage.setItem('qq.interfaceLanguage.workspace.7', 'xx');
		await load();
		expect(loadCatalogue).toHaveBeenCalledWith('en');
	});

	it('signed out: the browser, whatever the workspace mirrors say', async () => {
		localStorage.setItem('qinqin.workspace', '7');
		localStorage.setItem('qq.interfaceLanguage.workspace.7', 'xx');
		await load();
		expect(loadCatalogue).toHaveBeenCalledWith('en');
	});
});
