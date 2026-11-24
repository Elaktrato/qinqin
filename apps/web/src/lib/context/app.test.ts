// The app context and the session lifecycle (record 0009): a session exists
// while a token does, takes the user `me` names, and is disposed with the reason
// when the session ends; a new session is a new object.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../i18n/reloadPage', () => ({ reloadPage: vi.fn() }));

import { getToken } from '../api/client';
import { createAppContext, type AppContext } from './app.svelte';
import type { SessionEndReason } from './session.svelte';
import { fakeDeps, memoryStorage } from '../testing/context';

const user = (id: number) => ({
	id,
	username: `u${id}`,
	admin: false,
	email: null,
	emailVerified: false,
	mustChangePassword: false,
	createdAt: '2026-01-01T00:00:00Z'
});

let app: AppContext;
let me = user(1);

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage());
	me = user(1);
	const deps = fakeDeps({
		'POST /api/auth/login': () => ({ status: 'ok', token: 'tok-1' }),
		'GET /api/auth/me': () => me,
		'POST /api/auth/logout': () => undefined
	});
	app = createAppContext(deps);
});

afterEach(() => {
	app.dispose();
	vi.unstubAllGlobals();
});

describe('the session follows the token', () => {
	it('no token: no session; signing in creates one for the user', async () => {
		expect(app.session).toBeNull();
		await app.auth.login('u1', 'pw');
		expect(app.session).not.toBeNull();
		expect(app.session?.user).toBe(1);
		expect(app.session?.alive).toBe(true);
		expect(getToken()).toBe('tok-1');
	});

	it('a stored token gets a session at once and adopts the user when `me` answers', async () => {
		localStorage.setItem('qinqin.token', 'stored');
		const loading = app.auth.loadMe();
		const first = app.session;
		expect(first?.user).toBeNull();
		await loading;
		expect(app.session).toBe(first);
		expect(first?.user).toBe(1);
	});

	it('signing out disposes the session with signOut and leaves none', async () => {
		await app.auth.login('u1', 'pw');
		const session = app.session!;
		const ended: SessionEndReason[] = [];
		session.onDispose((reason) => ended.push(reason));
		app.auth.logout();
		expect(ended).toEqual(['signOut']);
		expect(session.alive).toBe(false);
		expect(app.session).toBeNull();
		expect(getToken()).toBeNull();
	});

	it('a 401 disposes it with expired', async () => {
		await app.auth.login('u1', 'pw');
		const session = app.session!;
		const ended: SessionEndReason[] = [];
		session.onDispose((reason) => ended.push(reason));
		app.auth.expire();
		expect(ended).toEqual(['expired']);
		expect(app.session).toBeNull();
	});

	it('another user under this tab disposes it with switched and starts a new one', async () => {
		await app.auth.login('u1', 'pw');
		const first = app.session!;
		const ended: SessionEndReason[] = [];
		first.onDispose((reason) => ended.push(reason));
		me = user(2);
		localStorage.setItem('qinqin.token', 'tok-2');
		await app.auth.loadMe();
		expect(ended).toEqual(['switched']);
		expect(app.session).not.toBe(first);
		expect(app.session?.user).toBe(2);
		expect(app.session?.alive).toBe(true);
	});

	it('the same user again (a reload of `me`) keeps the session', async () => {
		await app.auth.login('u1', 'pw');
		const first = app.session;
		app.auth.set({ token: 'tok-1', user: { ...me, username: 'renamed' } });
		expect(app.session).toBe(first);
	});

	it('disposing the app disposes its session', async () => {
		await app.auth.login('u1', 'pw');
		const session = app.session!;
		app.dispose();
		expect(session.alive).toBe(false);
	});
});

describe('session disposers', () => {
	it('run once, in order, and a throwing one is logged without stopping the rest', async () => {
		await app.auth.login('u1', 'pw');
		const session = app.session!;
		const ran: string[] = [];
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		session.onDispose(() => ran.push('a'));
		session.onDispose(() => {
			throw new Error('boom');
		});
		const off = session.onDispose(() => ran.push('gone'));
		session.onDispose(() => ran.push('c'));
		off();
		session.dispose('signOut');
		session.dispose('signOut');
		expect(ran).toEqual(['a', 'c']);
		expect(error).toHaveBeenCalledTimes(1);
		error.mockRestore();
	});

	it('a disposer added after the dispose runs at once', async () => {
		await app.auth.login('u1', 'pw');
		const session = app.session!;
		session.dispose('expired');
		const ran: SessionEndReason[] = [];
		session.onDispose((reason) => ran.push(reason));
		expect(ran).toEqual(['expired']);
	});
});
