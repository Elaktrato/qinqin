import { afterEach, beforeEach, describe, expect, it, vi, onTestFinished } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { ApiError, api } from '$lib/api/client';
import type { Workspace } from '$lib/api/types';
import { isWorkspaceGone } from './workspaceGone';
import { testContext, workspacesState, type TestContext } from '$lib/testing/context';

let ctx: TestContext;

/** A running app context routes workspace_not_found answers to the session's recovery. */
function watchDeletedWorkspaces(): void {
	onTestFinished(ctx.app.start());
}

function fakeStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function workspace(id: number, language: string, name = ''): Workspace {
	return { id, language, name, settings: {}, updatedAt: '2026-01-01T00:00:00Z' };
}

const zh = workspace(1, 'zh');
const ja = workspace(2, 'ja', 'Novels');

function selectIn(list: Workspace[], current: Workspace): void {
	localStorage.setItem('qinqin.workspace', String(current.id));
	ctx.session.workspaces.set({ list, current });
}

function workspaceCalls(): number {
	return vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/workspaces').length;
}

describe('isWorkspaceGone', () => {
	it('is the API 404 for a workspace that no longer exists', () => {
		expect(isWorkspaceGone(new ApiError(404, '{"error":"workspace_not_found","message":"No such workspace."}'))).toBe(true);
	});

	it('is nothing else', () => {
		expect(isWorkspaceGone(new ApiError(404, 'not found'))).toBe(false);
		expect(isWorkspaceGone(new ApiError(404, 'workspace not found'))).toBe(false); // text is never sniffed
		expect(isWorkspaceGone(new ApiError(404, '{"error":"not_found","message":"No such workspace."}'))).toBe(false);
		expect(isWorkspaceGone(new ApiError(404, 'workspace or plugin not found'))).toBe(false);
		expect(isWorkspaceGone(new ApiError(409, 'workspace not found'))).toBe(false);
		expect(isWorkspaceGone(new Error('workspace not found'))).toBe(false);
		expect(isWorkspaceGone(null)).toBe(false);
	});
});

describe('recoverFromDeletedWorkspace', () => {
	// Each test starts an hour after the last, past the reload cooldown.
	let now = Date.parse('2026-11-14T10:00:00Z');

	beforeEach(() => {
		now += 3_600_000;
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('sessionStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(now);
		ctx = testContext({ deps: { local: () => localStorage, session: () => sessionStorage, window: null } });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('reloads the list, falls back and says so when the selected workspace is gone', async () => {
		selectIn([zh, ja], zh);
		localStorage.setItem('qinqin.session.1.2026-11-14', '1');
		vi.mocked(fetch).mockResolvedValue(jsonResponse([ja]));

		await ctx.session.recovery.recover();

		expect(workspacesState(ctx.session.workspaces)).toEqual({ list: [ja], current: ja });
		expect(localStorage.getItem('qinqin.workspace')).toBe('2');
		expect(ctx.session.notices.text).toBe('This workspace was deleted — switched to Novels.');
		// What this browser kept for the deleted workspace is forgotten.
		expect(localStorage.getItem('qinqin.session.1.2026-11-14')).toBeNull();
	});

	it('says only that it was deleted when no workspace is left', async () => {
		selectIn([zh], zh);
		vi.mocked(fetch).mockResolvedValue(jsonResponse([]));

		await ctx.session.recovery.recover();

		expect(workspacesState(ctx.session.workspaces)).toEqual({ list: [], current: null });
		expect(ctx.session.notices.text).toBe('This workspace was deleted.');
	});

	it('stays quiet when the selected workspace still exists', async () => {
		selectIn([zh, ja], zh);
		vi.mocked(fetch).mockResolvedValue(jsonResponse([zh]));

		await ctx.session.recovery.recover();

		expect(workspacesState(ctx.session.workspaces).current).toEqual(zh);
		expect(ctx.session.notices.text).toBeNull();
	});

	it('shares one reload between concurrent callers', async () => {
		selectIn([zh, ja], zh);
		vi.mocked(fetch).mockResolvedValue(jsonResponse([ja]));

		await Promise.all([ctx.session.recovery.recover(), ctx.session.recovery.recover()]);

		expect(workspaceCalls()).toBe(1);
	});

	it('does not reload again right after a reload, so stale 404s cannot loop', async () => {
		selectIn([zh, ja], zh);
		vi.mocked(fetch).mockResolvedValue(jsonResponse([zh, ja]));

		await ctx.session.recovery.recover();
		await ctx.session.recovery.recover();
		expect(workspaceCalls()).toBe(1);

		vi.setSystemTime(now + 30_000);
		await ctx.session.recovery.recover();
		expect(workspaceCalls()).toBe(2);
	});

	it('never throws when the reload fails', async () => {
		selectIn([zh, ja], zh);
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));

		await expect(ctx.session.recovery.recover()).resolves.toBeUndefined();
		expect(workspacesState(ctx.session.workspaces).current).toEqual(zh);
	});

	it('is triggered by any API call answered workspace_not_found once watching', async () => {
		selectIn([zh, ja], zh);
		watchDeletedWorkspaces();
		vi.mocked(fetch).mockImplementation(async (input) =>
			String(input) === '/api/workspaces'
				? jsonResponse([ja])
				: new Response('{"error":"workspace_not_found","message":"No such workspace."}', { status: 404 })
		);

		await expect(api('/api/events?workspace=1')).rejects.toBeInstanceOf(ApiError);
		await vi.waitFor(() => expect(workspacesState(ctx.session.workspaces).current).toEqual(ja));
		expect(ctx.session.notices.text).toBe('This workspace was deleted — switched to Novels.');
	});

	it('ignores other 404s', async () => {
		selectIn([zh, ja], zh);
		watchDeletedWorkspaces();
		vi.mocked(fetch).mockResolvedValue(new Response('not found', { status: 404 }));

		await expect(api('/api/library/books/4')).rejects.toBeInstanceOf(ApiError);
		await Promise.resolve();
		expect(workspaceCalls()).toBe(0);
	});
});
