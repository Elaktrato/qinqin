import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import type { Workspace } from './api/types';
import { create, currentLanguage, deleteWorkspace, load, rename, select, setSettings, workspaces } from './workspaces';

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
	return {
		id,
		language,
		name,
		settings: {},
		updatedAt: '2026-01-01T00:00:00Z'
	};
}

describe('workspace store', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
		workspaces.set({ list: [], current: null });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('loads the list and keeps the persisted selection when it still exists', async () => {
		localStorage.setItem('qinqin.workspace', '2');
		const zh = workspace(1, 'zh');
		const ja = workspace(2, 'ja');
		vi.mocked(fetch).mockResolvedValue(jsonResponse([zh, ja]));

		await load();

		expect(get(workspaces)).toEqual({ list: [zh, ja], current: ja });
		expect(get(currentLanguage)).toBe('ja');
		expect(localStorage.getItem('qinqin.workspace')).toBe('2');
		expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual(['/api/workspaces']);
	});

	it('falls back to the first workspace when the persisted id is gone', async () => {
		localStorage.setItem('qinqin.workspace', '99');
		const zh = workspace(1, 'zh');
		const ja = workspace(2, 'ja');
		vi.mocked(fetch).mockResolvedValue(jsonResponse([zh, ja]));

		await load();

		expect(get(workspaces).current).toEqual(zh);
		expect(localStorage.getItem('qinqin.workspace')).toBe('1');
	});

	it('selects no workspace for an empty list', async () => {
		localStorage.setItem('qinqin.workspace', '1');
		vi.mocked(fetch).mockResolvedValue(jsonResponse([]));

		await load();

		expect(get(workspaces)).toEqual({ list: [], current: null });
		expect(get(currentLanguage)).toBeNull();
		expect(localStorage.getItem('qinqin.workspace')).toBeNull();
	});

	it('creates a workspace, reloads, and selects the new one', async () => {
		const zh = workspace(1, 'zh');
		const es = workspace(3, 'es');
		localStorage.setItem('qinqin.workspace', '1');
		vi.mocked(fetch).mockImplementation(async (_input, init) => {
			if (init?.method === 'POST') return jsonResponse(es, 201);
			return jsonResponse([zh, es]);
		});

		const created = await create('es');

		expect(created).toEqual(es);
		const calls = vi.mocked(fetch).mock.calls;
		expect(calls.map(([url]) => String(url))).toEqual(['/api/workspaces', '/api/workspaces']);
		expect(calls[0][1]?.method).toBe('POST');
		expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ language: 'es' });
		expect(get(workspaces).current).toEqual(es);
		expect(localStorage.getItem('qinqin.workspace')).toBe('3');
	});

	it('persists an explicit selection', () => {
		const zh = workspace(1, 'zh');
		const ja = workspace(2, 'ja');
		workspaces.set({ list: [zh, ja], current: zh });

		select(2);

		expect(get(workspaces).current).toEqual(ja);
		expect(get(currentLanguage)).toBe('ja');
		expect(localStorage.getItem('qinqin.workspace')).toBe('2');
	});
	it('creates a named workspace and sends the trimmed name', async () => {
		const zh = workspace(1, 'zh');
		const novels = workspace(4, 'zh', 'Novels');
		vi.mocked(fetch).mockImplementation(async (_input, init) => {
			if (init?.method === 'POST') return jsonResponse(novels, 201);
			return jsonResponse([zh, novels]);
		});

		await create('zh', '  Novels ');

		const calls = vi.mocked(fetch).mock.calls;
		expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ language: 'zh', name: 'Novels' });
		expect(get(workspaces).current).toEqual(novels);
	});

	it('omits a blank name when creating', async () => {
		const es = workspace(3, 'es');
		vi.mocked(fetch).mockImplementation(async (_input, init) => {
			if (init?.method === 'POST') return jsonResponse(es, 201);
			return jsonResponse([es]);
		});

		await create('es', '   ');

		expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ language: 'es' });
	});

	it('renames a workspace and updates the list and the current one in place', async () => {
		const zh = workspace(1, 'zh');
		const ja = workspace(2, 'ja');
		workspaces.set({ list: [zh, ja], current: ja });
		const renamed = { ...ja, name: 'Manga' };
		vi.mocked(fetch).mockResolvedValue(jsonResponse(renamed));

		const result = await rename(2, ' Manga ');

		expect(result).toEqual(renamed);
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(String(url)).toBe('/api/workspaces/2');
		expect(init?.method).toBe('PUT');
		expect(JSON.parse(String(init?.body))).toEqual({ name: 'Manga' });
		expect(get(workspaces)).toEqual({ list: [zh, renamed], current: renamed });
	});

	it('renaming another workspace keeps the current one', async () => {
		const zh = workspace(1, 'zh');
		const ja = workspace(2, 'ja');
		workspaces.set({ list: [zh, ja], current: zh });
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...ja, name: '' }));

		await rename(2, '');

		expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ name: '' });
		expect(get(workspaces).current).toEqual(zh);
	});

	it('keeps the persisted selection among repeated languages', async () => {
		localStorage.setItem('qinqin.workspace', '5');
		const first = workspace(1, 'zh');
		const second = workspace(5, 'zh', 'HSK');
		vi.mocked(fetch).mockResolvedValue(jsonResponse([first, second]));

		await load();

		expect(get(workspaces).current).toEqual(second);

		select(1);
		expect(localStorage.getItem('qinqin.workspace')).toBe('1');
		expect(get(workspaces).current).toEqual(first);
	});

	it('deletes the current workspace, falls back to the first left, and forgets its keys', async () => {
		const zh = workspace(1, 'zh');
		const ja = workspace(2, 'ja');
		const es = workspace(3, 'es');
		workspaces.set({ list: [zh, ja, es], current: ja });
		localStorage.setItem('qinqin.workspace', '2');
		localStorage.setItem('qinqin.session.2.2026-11-14', '1');
		localStorage.setItem('qinqin.session.1.2026-11-14', '1');
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

		await deleteWorkspace(2);

		const calls = vi.mocked(fetch).mock.calls;
		expect(calls.map(([url]) => String(url))).toEqual(['/api/workspaces/2']);
		expect(calls[0][1]?.method).toBe('DELETE');
		expect(get(workspaces)).toEqual({ list: [zh, es], current: zh });
		expect(localStorage.getItem('qinqin.workspace')).toBe('1');
		expect(localStorage.getItem('qinqin.session.2.2026-11-14')).toBeNull();
		expect(localStorage.getItem('qinqin.session.1.2026-11-14')).toBe('1');
	});

	it('deleting another workspace keeps the current one', async () => {
		const zh = workspace(1, 'zh');
		const ja = workspace(2, 'ja');
		workspaces.set({ list: [zh, ja], current: zh });
		localStorage.setItem('qinqin.workspace', '1');
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

		await deleteWorkspace(2);

		expect(get(workspaces)).toEqual({ list: [zh], current: zh });
		expect(localStorage.getItem('qinqin.workspace')).toBe('1');
	});

	it('treats a workspace already gone (404) as deleted and reloads the list', async () => {
		const zh = workspace(1, 'zh');
		const ja = workspace(2, 'ja');
		workspaces.set({ list: [zh, ja], current: ja });
		vi.mocked(fetch).mockImplementation(async (_input, init) => {
			if (init?.method === 'DELETE') return new Response('workspace not found', { status: 404 });
			return jsonResponse([zh]);
		});

		await deleteWorkspace(2);

		expect(get(workspaces)).toEqual({ list: [zh], current: zh });
	});

	it('keeps everything when the server refuses (last workspace)', async () => {
		const zh = workspace(1, 'zh');
		workspaces.set({ list: [zh], current: zh });
		localStorage.setItem('qinqin.session.1.2026-11-14', '1');
		vi.mocked(fetch).mockResolvedValue(new Response('keep at least one workspace', { status: 409 }));

		await expect(deleteWorkspace(1)).rejects.toMatchObject({ status: 409 });

		expect(get(workspaces)).toEqual({ list: [zh], current: zh });
		expect(localStorage.getItem('qinqin.session.1.2026-11-14')).toBe('1');
	});

	it('merges a settings patch through PUT and replaces the workspace in the store', async () => {
		const zh = workspace(1, 'zh');
		const ja = workspace(2, 'ja');
		workspaces.set({ list: [zh, ja], current: ja });
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...ja, settings: { audioAutoplay: true } }));

		const updated = await setSettings(2, { audioAutoplay: true });

		const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/workspaces/2');
		expect(init.method).toBe('PUT');
		expect(JSON.parse(String(init.body))).toEqual({ settings: { audioAutoplay: true } });
		expect(updated.settings).toEqual({ audioAutoplay: true });
		expect(get(workspaces).current?.settings).toEqual({ audioAutoplay: true });
		expect(get(workspaces).list[1].settings).toEqual({ audioAutoplay: true });
		expect(get(workspaces).list[0]).toBe(zh);
	});
});
