// The interface language per workspace in the root layout (#297): once `me` and the workspace list are in, the
// current workspace's language decides; switching to a workspace in another language reloads once, under the guard
// of the account setting, so it can never loop. A fake second catalogue `xx` is mocked in (only en exists today),
// with a catalogue lookup that installs every supported language.
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()), afterNavigate: vi.fn() }));
vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn(() => Promise.resolve([]))
}));
vi.mock('$lib/i18n/negotiate', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/i18n/negotiate')>()),
	SUPPORTED_LANGUAGES: ['en', 'xx']
}));
vi.mock('$lib/i18n', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/i18n')>();
	const { negotiate } = await import('$lib/i18n/negotiate');
	return { ...real, catalogueLanguage: (lang: string) => negotiate([lang], ['en', 'xx']) };
});
const { reloadPage } = vi.hoisted(() => ({ reloadPage: vi.fn() }));
vi.mock('$lib/i18n/reloadPage', () => ({ reloadPage }));

import { api } from '$lib/api/client';
import type { Workspace } from '$lib/api/types';
import { createAppContext, type AppContext } from '$lib/context/app.svelte';
import { contextOf } from '$lib/context/context';
import { EventLog } from '$lib/events';
import { RELOAD_MARKER_KEY, workspaceMirrorKey } from '$lib/i18n/interfaceLanguage';
import { fakeDeps } from '$lib/testing/context';
import { setUrl } from '$lib/testing/appState.svelte';
import Layout from './+layout.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>page body</p>' }));

const ws = (id: number, settings: Record<string, unknown> = {}): Workspace => ({
	id,
	language: id === 2 ? 'ja' : 'zh',
	name: '',
	settings,
	updatedAt: '2026-11-27T00:00:00Z'
});

let app: AppContext;

beforeEach(() => {
	vi.spyOn(EventLog.prototype, 'record').mockImplementation((async () => {}) as never);
	vi.spyOn(EventLog.prototype, 'recordSessionWhenSettled').mockImplementation((async () => {}) as never);
});

afterEach(() => {
	cleanup();
	app?.dispose();
	vi.clearAllMocks();
	localStorage.clear();
	sessionStorage.clear();
});

function mount(o: { workspaces: Workspace[] | Error; account?: string }) {
	setUrl('/search');
	localStorage.setItem('qinqin.token', 'tok');
	vi.mocked(api).mockImplementation((async (url: string) => {
		if (url === '/api/auth/me') return { id: 1, username: 'u', admin: false, interfaceLanguage: o.account ?? '' };
		if (url === '/api/workspaces') {
			if (o.workspaces instanceof Error) throw o.workspaces;
			return o.workspaces;
		}
		return [];
	}) as never);
	app = createAppContext(fakeDeps(undefined, { local: () => localStorage, session: () => sessionStorage, window }));
	return render(Layout, { props: { children }, context: contextOf(app) });
}

async function loaded(): Promise<NonNullable<AppContext['session']>> {
	return waitFor(() => {
		const session = app.session;
		expect(session?.workspaces.loaded).toBe(true);
		return session!;
	});
}

describe('the layout follows the current workspace\'s interface language (#297)', () => {
	it('a workspace without its own language and an account in en: no reload', async () => {
		mount({ workspaces: [ws(1), ws(2, { interfaceLanguage: 'xx' })] });
		await loaded();
		await new Promise((r) => setTimeout(r, 20));
		expect(reloadPage).not.toHaveBeenCalled();
		expect(localStorage.getItem('qq.interfaceLanguage')).toBe('en');
	});

	it('switching to a workspace in another language mirrors it and reloads once', async () => {
		mount({ workspaces: [ws(1), ws(2, { interfaceLanguage: 'xx' })] });
		const session = await loaded();
		session.workspaces.select(2);
		await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
		expect(localStorage.getItem(workspaceMirrorKey(2))).toBe('xx');
		expect(localStorage.getItem('qinqin.workspace')).toBe('2');
		expect(sessionStorage.getItem(RELOAD_MARKER_KEY)).not.toBeNull();
	});

	it('a remembered workspace in another language than the start reloads once at start', async () => {
		localStorage.setItem('qinqin.workspace', '2');
		mount({ workspaces: [ws(1), ws(2, { interfaceLanguage: 'xx' })] });
		await loaded();
		await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
	});

	it('the start a language reload caused never reloads again (the language still differs): no loop', async () => {
		localStorage.setItem('qinqin.workspace', '2');
		sessionStorage.setItem(RELOAD_MARKER_KEY, '1');
		mount({ workspaces: [ws(1), ws(2, { interfaceLanguage: 'xx' })] });
		await loaded();
		await new Promise((r) => setTimeout(r, 20));
		expect(reloadPage).not.toHaveBeenCalled();
		expect(sessionStorage.getItem(RELOAD_MARKER_KEY)).toBeNull();
	});

	it('the workspace list does not load (offline): the start\'s language stays, no reload into the account\'s', async () => {
		localStorage.setItem('qinqin.workspace', '2');
		localStorage.setItem(workspaceMirrorKey(2), 'xx');
		mount({ workspaces: new Error('offline'), account: 'en' });
		await waitFor(() => expect(app.session?.workspaces.loadError).not.toBe(''));
		await new Promise((r) => setTimeout(r, 20));
		expect(reloadPage).not.toHaveBeenCalled();
		expect(localStorage.getItem(workspaceMirrorKey(2))).toBe('xx');
	});

	it('a workspace following an account in another language reloads into the account\'s', async () => {
		mount({ workspaces: [ws(1)], account: 'xx' });
		await loaded();
		await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
		expect(localStorage.getItem('qq.interfaceLanguage')).toBe('xx');
		expect(localStorage.getItem(workspaceMirrorKey(1))).toBeNull();
	});
});
