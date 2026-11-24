import { EventLog } from '$lib/events';
import type { MockInstance } from 'vitest';
import { cleanup, render, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn(() => Promise.resolve([]))
}));

import { goto } from '$app/navigation';
import { fireEvent } from '@testing-library/svelte';
import { api } from '$lib/api/client';
import { createAppContext, type AppContext } from '$lib/context/app.svelte';
import { contextOf } from '$lib/context/context';
import { fakeDeps } from '$lib/testing/context';
import { setUrl } from '$lib/testing/appState.svelte';
import Layout from './+layout.svelte';
import { dataRow } from '../lib/testing/keyed';

// The session's event log (record 0009): its methods, faked on the class.
let recordSessionOnce!: MockInstance<EventLog['recordSessionWhenSettled']>;
beforeEach(() => {
	vi.spyOn(EventLog.prototype, 'record').mockImplementation(((async () => {})) as never);
	recordSessionOnce = vi.spyOn(EventLog.prototype, 'recordSessionWhenSettled').mockImplementation(((async () => {})) as never);
});

/** The app context the layout mounts with (a fresh one per mount, as a page load). */
let app: AppContext;
function freshApp(): Map<unknown, unknown> {
	app = createAppContext(fakeDeps(undefined, { local: () => localStorage, window }));
	return contextOf(app);
}

/** The desktop bar (both bars are in the DOM; CSS shows one, and jsdom has no CSS). */
function desktop(container: HTMLElement): HTMLElement {
	return container.querySelector('[data-frame="desktop"]') as HTMLElement;
}

const children = createRawSnippet(() => ({ render: () => '<p>page body</p>' }));

function mountAt(path: string, token: string | null, navLayout: unknown = null) {
	setUrl(path);
	localStorage.clear();
	if (token) localStorage.setItem('qinqin.token', token);
	vi.mocked(api).mockImplementation((async (url: string) => {
		if (url === '/api/auth/me') return { id: 1, username: 'u', admin: false };
		if (navLayout !== null && url.includes('prefix=nav-layout')) return [dataRow({ key: 'nav-layout', workspaceId: null, data: navLayout })];
		return [];
	}) as never);
	return render(Layout, { props: { children }, context: freshApp() });
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('layout auth guard', () => {
	it('sends a signed-out visitor from a private page to /login without rendering it', async () => {
		const { queryByText } = mountAt('/search', null);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login', { replaceState: true }));
		expect(queryByText('page body')).toBeNull();
	});

	it('sends a signed-in user from /login home', async () => {
		const { queryByText } = mountAt('/login', 'tok');
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/', { replaceState: true }));
		expect(queryByText('page body')).toBeNull();
	});

	it('renders a private page for a signed-in user and does not redirect', async () => {
		const { findByText } = mountAt('/search', 'tok');
		await findByText('page body');
		expect(goto).not.toHaveBeenCalled();
	});

	// The design moves Stats from the footer into the bar (#99): these two
	// cases replace "puts Stats in the footer links, not in the main
	// navigation" and "marks the footer Stats link current on stats pages".
	it('puts Stats in the main navigation, current on /stats/week', async () => {
		const { findByText, container } = mountAt('/stats/week', 'tok');
		await findByText('page body');
		const main = desktop(container).querySelector('nav[aria-label="Main"]') as HTMLElement;
		const stats = main.querySelector('a[href="/stats"]');
		expect(stats).not.toBeNull();
		expect(stats?.getAttribute('aria-current')).toBe('page');
		expect(main.querySelector('a[href="/search"]')?.hasAttribute('aria-current')).toBe(false);
	});

	it('has no footer and no bottom bar', async () => {
		const { findByText, queryByRole, container } = mountAt('/search', 'tok');
		await findByText('page body');
		expect(queryByRole('contentinfo')).toBeNull();
		expect(container.querySelector('footer')).toBeNull();
		expect(queryByRole('navigation', { name: 'Footer' })).toBeNull();
		expect(container.querySelectorAll('header')).toHaveLength(1);
	});

	it('reaches Settings and Sources from the account menu', async () => {
		const { findByText, container } = mountAt('/search', 'tok');
		await findByText('page body');
		const bar = desktop(container);
		await fireEvent.click(within(bar).getByRole('button', { name: 'Account menu' }));
		expect(within(bar).getByRole('menuitem', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
		expect(within(bar).getByRole('menuitem', { name: 'Sources' }).getAttribute('href')).toBe('/sources');
	});

	it('the skip link is the first focusable element and focuses #main-content', async () => {
		const { findByText, container } = mountAt('/search', 'tok');
		await findByText('page body');
		const first = container.querySelector('a[href], button');
		expect(first?.textContent).toBe('Skip to content');
		await fireEvent.click(first as HTMLElement);
		expect(document.activeElement?.id).toBe('main-content');
		// The frame's main is the one main landmark and holds the page.
		const mains = container.querySelectorAll('main, [role="main"]');
		expect(mains).toHaveLength(1);
		expect(mains[0].id).toBe('main-content');
		expect(mains[0].textContent).toContain('page body');
	});

	it('the phone bar in side-menu mode: the menu button, the title and the flag; no nav until the drawer opens', async () => {
		const { findByText, container } = mountAt('/stats/week', 'tok', { version: 1, phone: 'drawer' });
		await findByText('page body');
		await waitFor(() => expect(app.navLayout.phone).toBe('drawer'));
		const phone = container.querySelector('[data-frame="phone"]') as HTMLElement;
		expect(phone.closest('header')).toBe(desktop(container).closest('header'));
		expect(within(phone).getByRole('button', { name: 'Open menu' })).toBeTruthy();
		expect(phone.querySelector('.title')?.textContent).toBe('Stats');
		expect(within(phone).queryByRole('navigation')).toBeNull();
		// Only the desktop nav exists (CSS hides it on the phone).
		expect(container.querySelectorAll('nav[aria-label="Main"]')).toHaveLength(1);
		expect(container.querySelector('[data-frame="phone-nav"]')).toBeNull();
		expect(document.documentElement.hasAttribute('data-bottom-bar')).toBe(false);
	});

	it('the phone frame in bottom-bar mode (the default): no menu button, the avatar, the bar after the page', async () => {
		const { findByText, container } = mountAt('/search', 'tok');
		await findByText('page body');
		const phone = container.querySelector('[data-frame="phone"]') as HTMLElement;
		expect(within(phone).queryByRole('button', { name: 'Open menu' })).toBeNull();
		expect(within(phone).getByRole('button', { name: 'Account menu' })).toBeTruthy();
		expect(phone.querySelector('.title')?.textContent).toBe('Search');
		const nav = container.querySelector('[data-frame="phone-nav"]') as HTMLElement;
		expect(nav.classList.contains('phone')).toBe(true);
		// After the page in the reading order, outside the banner.
		const main = container.querySelector('#main-content') as HTMLElement;
		expect(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(nav.closest('header')).toBeNull();
		const bar = within(nav).getByRole('navigation', { name: 'Main' });
		expect(within(bar).getByRole('link', { name: 'Search' }).getAttribute('aria-current')).toBe('page');
		expect(document.documentElement.hasAttribute('data-bottom-bar')).toBe(true);
	});

	it('the study session hides the bottom bar (it has its own docked buttons)', async () => {
		const { findByText, container } = mountAt('/study/session', 'tok');
		await findByText('page body');
		expect(container.querySelector('[data-frame="phone-nav"]')).toBeNull();
		expect(document.documentElement.hasAttribute('data-bottom-bar')).toBe(false);
		// The top bar stays in bar mode (no menu button).
		const phone = container.querySelector('[data-frame="phone"]') as HTMLElement;
		expect(within(phone).queryByRole('button', { name: 'Open menu' })).toBeNull();
	});

	it('desktop and tablet do not change: the desktop bar is the same in both phone modes', async () => {
		const bar = mountAt('/reader', 'tok');
		await bar.findByText('page body');
		// Generated ids differ between two mounts; everything else must not.
		const markup = (el: HTMLElement) => el.innerHTML.replace(/ (id|for|aria-controls|aria-describedby|aria-labelledby)="[^"]*"/g, '');
		const withBar = markup(desktop(bar.container));
		cleanup();
		const drawer = mountAt('/reader', 'tok', { version: 1, phone: 'drawer' });
		await drawer.findByText('page body');
		await waitFor(() => expect(app.navLayout.phone).toBe('drawer'));
		expect(markup(desktop(drawer.container))).toBe(withBar);
	});

	it('signed out on /sources: the logo links to /login, a Sign in link shows, no nav', async () => {
		const { findByText, getByRole, queryByRole } = mountAt('/sources', null);
		await findByText('page body');
		expect(getByRole('link', { name: 'qinqin, sign in' }).getAttribute('href')).toBe('/login');
		expect(getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
		expect(queryByRole('navigation')).toBeNull();
		expect(queryByRole('button', { name: 'Account menu' })).toBeNull();
		expect(queryByRole('button', { name: /^Workspace/ })).toBeNull();
	});

	it('leaves the open Sources page alone when signed out', async () => {
		const { findByText } = mountAt('/sources', null);
		await findByText('page body');
		expect(goto).not.toHaveBeenCalled();
	});

	it('guards again when the token disappears (logout or expiry)', async () => {
		const { findByText, queryByText } = mountAt('/search', 'tok');
		await findByText('page body');
		app.auth.set({ token: null, user: null });
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login', { replaceState: true }));
		await waitFor(() => expect(queryByText('page body')).toBeNull());
	});
});

describe('layout workspaces', () => {
	const ws = (id: number) => ({ id, language: 'zh', name: `w${id}`, settings: {}, updatedAt: '' });

	it('offers Try again after a failed workspaces load and recovers', async () => {
		let fail = true;
		setUrl('/search');
		localStorage.clear();
		localStorage.setItem('qinqin.token', 'tok');
		vi.mocked(api).mockImplementation((async (url: string) => {
			if (url === '/api/auth/me') return { id: 1, username: 'u', admin: false };
			if (url === '/api/workspaces') {
				if (fail) throw new Error('offline');
				return [ws(1)];
			}
			return [];
		}) as never);
		const view = render(Layout, { props: { children }, context: freshApp() });
		await view.findByText('Could not load workspaces.');
		fail = false;
		await fireEvent.click(view.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(view.queryByText('Could not load workspaces.')).toBeNull());
		await waitFor(() => expect(app.session?.workspaces.current?.id).toBe(1));
	});

	it('records a session for a workspace selected mid-session', async () => {
		setUrl('/search');
		localStorage.clear();
		localStorage.setItem('qinqin.token', 'tok');
		vi.mocked(api).mockImplementation((async (url: string) => {
			if (url === '/api/auth/me') return { id: 1, username: 'u', admin: false };
			if (url === '/api/workspaces') return [ws(1), ws(2)];
			return [];
		}) as never);
		render(Layout, { props: { children }, context: freshApp() });
		await waitFor(() => expect(recordSessionOnce).toHaveBeenCalledWith(1));
		app.session?.workspaces.select(2);
		await waitFor(() => expect(recordSessionOnce).toHaveBeenCalledWith(2));
	});
});

describe('layout restricted sessions', () => {
	const me = (restriction: string) => ({
		id: 1,
		username: 'u',
		admin: false,
		email: null,
		emailVerified: false,
		mustChangePassword: restriction === 'password_change',
		createdAt: 't',
		restriction
	});

	function mountRestricted(path: string, restriction: string) {
		setUrl(path);
		localStorage.clear();
		localStorage.setItem('qinqin.token', 'tok');
		vi.mocked(api).mockImplementation((async (url: string) => {
			if (url === '/api/auth/me') return me(restriction);
			return [];
		}) as never);
		return render(Layout, { props: { children }, context: freshApp() });
	}

	it('sends a password-change session from a private page to /account/password', async () => {
		const { queryByText } = mountRestricted('/study', 'password_change');
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/account/password', { replaceState: true }));
		expect(queryByText('page body')).toBeNull();
	});

	it('does not load workspaces or plugin states for a restricted session', async () => {
		mountRestricted('/account/password', 'password_change');
		await waitFor(() => expect(api).toHaveBeenCalledWith('/api/auth/me'));
		await new Promise((r) => setTimeout(r, 30));
		const urls = vi.mocked(api).mock.calls.map(([u]) => String(u));
		expect(urls).not.toContain('/api/workspaces');
		expect(urls.some((u) => u.startsWith('/api/features'))).toBe(false);
	});

	it('renders the change page itself and keeps Sign out within reach', async () => {
		const { findByText, getByRole, getAllByRole, queryByRole } = mountRestricted(
			'/account/password',
			'password_change'
		);
		await findByText('page body');
		expect(goto).not.toHaveBeenCalled();
		// The logo and an account menu holding the open Sources page and Sign out only (#99).
		expect(getByRole('link', { name: 'qinqin, home' })).toBeTruthy();
		await fireEvent.click(getByRole('button', { name: 'Account menu' }));
		expect(getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Sources', 'Sign out']);
		// No navigation into the app while restricted.
		expect(queryByRole('navigation', { name: 'Main' })).toBeNull();
		expect(queryByRole('button', { name: /^Workspace/ })).toBeNull();
	});

	it('sends an enrolment session to its setup page', async () => {
		mountRestricted('/', 'mfa_enrollment');
		await waitFor(() =>
			expect(goto).toHaveBeenCalledWith('/account/two-factor-setup', { replaceState: true })
		);
	});

	it('leaves the open Sources page reachable', async () => {
		const { findByText } = mountRestricted('/sources', 'password_change');
		await findByText('page body');
		expect(goto).not.toHaveBeenCalled();
	});
});

describe('layout theme store', () => {
	const calls = () => vi.mocked(api).mock.calls.map((c) => String(c[0]));

	it('loads the theme list signed out, and the appearance row once signed in', async () => {
		const out = mountAt('/sources', null);
		await out.findByText('page body');
		await waitFor(() => expect(calls()).toContain('/api/themes'));
		expect(calls().some((u) => u.startsWith('/api/rows'))).toBe(false);
		cleanup();
		vi.clearAllMocks();
		const view = mountAt('/search', 'tok');
		await view.findByText('page body');
		await waitFor(() =>
			expect(calls().filter((u) => u.startsWith('/api/rows') && u.includes('prefix=appearance'))).toHaveLength(1)
		);
	});

	it('reads the installed font faces once signed in, never signed out', async () => {
		const out = mountAt('/sources', null);
		await out.findByText('page body');
		await waitFor(() => expect(calls()).toContain('/api/themes'));
		expect(calls()).not.toContain('/api/fonts');
		cleanup();
		vi.clearAllMocks();
		const view = mountAt('/search', 'tok');
		await view.findByText('page body');
		await waitFor(() => expect(calls().filter((u) => u === '/api/fonts')).toHaveLength(1));
	});

	it('sets the app-wide hanzi font stacks on the root (default Sans, system fonts without a pack)', async () => {
		document.documentElement.removeAttribute('style');
		const view = mountAt('/search', 'tok');
		await view.findByText('page body');
		const root = document.documentElement.style;
		await waitFor(() => expect(root.getPropertyValue('--font-hanzi-hans')).toContain('"PingFang SC"'));
		expect(root.getPropertyValue('--font-hanzi-hant')).toContain('"PingFang TC"');
		expect(root.getPropertyValue('--font-hanzi-jpan')).toContain('"Hiragino Sans"');
	});

	// The quick theme switch moved into the account menu (#99).
	it('puts the quick theme switch in the account menu when signed in, not signed out', async () => {
		const out = mountAt('/sources', null);
		await out.findByText('page body');
		expect(out.queryByRole('button', { name: 'Account menu' })).toBeNull();
		cleanup();
		const view = mountAt('/search', 'tok');
		await view.findByText('page body');
		const bar = desktop(view.container);
		await fireEvent.click(within(bar).getByRole('button', { name: 'Account menu' }));
		expect(within(bar).getByRole('menuitem', { name: /^Theme/ })).toBeTruthy();
	});
});
