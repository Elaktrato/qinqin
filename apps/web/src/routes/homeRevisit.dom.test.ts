// Home on a large account, visited twice (#290): the default widgets on the
// fake study server (2,000 cards, 3,000 reviews, 100 rows per pull page), a
// first visit, then a revisit after the study cache's freshness window. It
// counts the requests each visit sends before its content shows, and whether a
// widget showed a loading line on the revisit. The numbers before and after
// #290 are in docs/superpowers/plans/2026-11-27-290-cached-refresh.md.
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));

import { studyContext, type TestContext } from '$lib/testing/context';
import { StudyServer } from '$lib/testing/studyServer';
import * as build from '$lib/testing/study';
import { cardRow, deckRow } from '$lib/studycore/rows';
import Page from './+page.svelte';

const WS = 1;
let clock = Date.now();
let ctx: TestContext;
let server: StudyServer;

function answer(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
	clock = Date.now();
	server = new StudyServer({ pageSize: 100, now: () => clock });
	const at = '2026-01-01T00:00:00Z';
	const meta = { workspaceId: WS, version: 1, updatedAt: at, deletedAt: null };
	for (let d = 0; d < 5; d++) server.putTyped('decks', { ...deckRow({ id: `deck-${d}`, name: `D${d}`, createdAt: at }), ...meta });
	for (let i = 1; i <= 2000; i++) {
		server.putTyped('cards', { ...cardRow(build.card({ id: `c-vocab-${i}`, entryId: i, deckIds: ['deck-1'], createdAt: at })), ...meta });
	}
	const events = [];
	for (let i = 0; i < 3000; i++) {
		const ts = new Date(clock - 40 * 86_400_000 + i * 15 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
		events.push({ ...build.review({ cardId: `c-vocab-${(i % 2000) + 1}`, ts, id: build.eventId(i) }), userId: 1 });
	}
	server.events = events;
	server.extra = (url) => {
		if (url.pathname === '/api/stats/activity') return answer({ from: '', to: '', sources: [], cells: [] });
		return undefined;
	};
	vi.stubGlobal('fetch', vi.fn(server.fetch));
	ctx = studyContext({ deps: { now: () => clock } });
	ctx.session.workspaces.set({ list: [{ id: WS, language: 'zh', name: 'w' } as never], current: { id: WS, language: 'zh', name: 'w' } as never });
	ctx.session.features.set({ list: [{ id: 'flashcards', enabled: true }], status: 'ready' });
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

/** The widgets' loading lines ("Loading activity…", "Loading study data…", ...). */
const loadingLines = (): number =>
	[...document.querySelectorAll('[data-widget] *')].filter((el) => el.children.length === 0 && /^\s*Loading\b/.test(el.textContent ?? '')).length;

/** Every default widget shows its content (no loading line; the flashcards line and the week are there). */
const contentShown = (): boolean =>
	document.querySelectorAll('[data-widget]').length === 4 &&
	loadingLines() === 0 &&
	(document.body.textContent ?? '').includes('reviews ·') &&
	(document.body.textContent ?? '').includes('Days active');

/** visit renders Home and waits until every default widget shows content; returns what it cost. */
async function visit(): Promise<{ requests: string[]; sawLoading: number; beforeContent: number }> {
	server.resetCounts();
	let sawLoading = 0;
	// How many requests were sent before every widget showed its content (a count, not a clock: record 0005).
	let beforeContent = -1;
	const look = (): void => {
		sawLoading = Math.max(sawLoading, loadingLines());
		if (beforeContent < 0 && contentShown()) beforeContent = server.log.length;
	};
	const observer = new MutationObserver(look);
	observer.observe(document.body, { childList: true, subtree: true, characterData: true });
	const { unmount } = render(Page, { context: ctx.context });
	look();
	await waitFor(() => expect(contentShown()).toBe(true), { timeout: 10_000, interval: 5 });
	look();
	observer.disconnect();
	const requests = [...server.log];
	unmount();
	return { requests, sawLoading, beforeContent };
}

const kinds = (requests: readonly string[]): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const r of requests) {
		const key = r.replace(/\?.*$/, '');
		out[key] = (out[key] ?? 0) + 1;
	}
	return out;
};

function report(name: string, v: { requests: string[]; sawLoading: number; beforeContent: number }): void {
	if (process.env.QINQIN_MEASURE === '1') {
		process.stdout.write(`\n${name}: ${v.requests.length} requests (${v.beforeContent} before the content), ${v.sawLoading} loading lines seen ${JSON.stringify(kinds(v.requests))}`);
	}
}

describe('Home revisited (#290)', () => {
	it.each([0, 30])('measures a first visit and a revisit after the freshness window (latency %i ms)', async (latency) => {
		server.latencyMs = latency;
		const first = await visit();
		clock += 20_000;
		const again = await visit();
		clock += 1_000;
		const quick = await visit();
		report(`first visit, ${latency} ms latency`, first);
		report(`revisit after 20 s, ${latency} ms latency`, again);
		report(`revisit 1 s later, ${latency} ms latency`, quick);
		expect(first.requests.length).toBeGreaterThan(0);
	}, 60_000);
});
