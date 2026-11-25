import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(), getSchemeEntries: vi.fn() }));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	loadStudyData: vi.fn(),
	loadStudyHistory: vi.fn()
}));

import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
import type { Scheme } from '$lib/api/types';
import { loadStudyData, loadStudyHistory } from '$lib/study/data';
import { testContext, type TestContext } from '$lib/testing/context';
import * as build from '$lib/testing/study';
import { createSetupData } from './setupData.svelte';

let ctx: TestContext;
const jaScheme = { id: 3, name: 'JLPT', unit: 'word', language: 'ja', levels: [{ id: 1, ord: 1, name: 'N5' }] } as Scheme;
const zhScheme = { ...jaScheme, id: 4, language: 'zh' } as Scheme;

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

beforeEach(() => {
	ctx = testContext();
	vi.mocked(getSchemes).mockResolvedValue([jaScheme, zhScheme]);
	vi.mocked(getSchemeEntries).mockResolvedValue([{ id: 9, kind: 'word', written: '水' }] as never);
	vi.mocked(loadStudyData).mockResolvedValue(build.history({ decks: [{ id: 'd1', name: 'D', createdAt: '2026-01-01T00:00:00Z' }] }));
	vi.mocked(loadStudyHistory).mockResolvedValue(build.history({}));
});
afterEach(() => vi.clearAllMocks());

describe('createSetupData', () => {
	it('loads the study data and the schemes of the workspace language', async () => {
		const data = createSetupData(ctx.session, { fresh: true });
		await data.load(1, 'ja');
		expect(data.status).toBe('ready');
		expect(data.decks.map((d) => d.id)).toEqual(['d1']);
		expect(data.schemesLoaded).toBe(true);
		expect(data.schemes.map((s) => s.id)).toEqual([3]);
		expect(loadStudyData).toHaveBeenCalledWith(ctx.session.study, 1);
	});

	it('the widget-speed read goes through the shared history cache', async () => {
		const data = createSetupData(ctx.session, { fresh: false });
		await data.load(1, 'ja');
		expect(loadStudyHistory).toHaveBeenCalled();
		expect(loadStudyData).not.toHaveBeenCalled();
	});

	it('no workspace is its own status', async () => {
		const data = createSetupData(ctx.session, { fresh: true });
		await data.load(null, null);
		expect(data.status).toBe('no-workspace');
	});

	it('a failed read is an error with the screen text', async () => {
		vi.mocked(loadStudyData).mockRejectedValue(new Error('down'));
		const data = createSetupData(ctx.session, { fresh: true });
		await data.load(1, 'ja');
		expect(data.status).toBe('error');
		expect(data.error).toBe('Could not load your decks.');
	});

	it('a slow answer for an earlier workspace never lands', async () => {
		const slow = deferred<ReturnType<typeof build.history>>();
		vi.mocked(loadStudyData).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(build.history({}));
		const data = createSetupData(ctx.session, { fresh: true });
		const first = data.load(1, 'ja');
		await data.load(2, 'zh');
		slow.resolve(build.history({ decks: [{ id: 'old', name: 'Old', createdAt: '2026-01-01T00:00:00Z' }] }));
		await first;
		expect(data.workspaceId).toBe(2);
		expect(data.decks).toEqual([]);
		expect(data.schemes.map((s) => s.id)).toEqual([4]);
	});

	it('loads a level, and a newer level request wins', async () => {
		const data = createSetupData(ctx.session, { fresh: true });
		await data.load(1, 'ja');
		await data.loadLevel(3, 'N5');
		expect(data.levelEntries.map((e) => e.id)).toEqual([9]);
		data.clearLevel();
		expect(data.levelEntries).toEqual([]);
	});
});
