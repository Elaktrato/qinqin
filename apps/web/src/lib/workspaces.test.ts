import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import type { Workspace } from './api/types';
import { create, currentLanguage, load, select, workspaces } from './workspaces';

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

function workspace(id: number, language: string): Workspace {
	return {
		id,
		language,
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
});
