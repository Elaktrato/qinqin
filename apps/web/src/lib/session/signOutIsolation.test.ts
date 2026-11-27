// #173: sign in as A, fill every per-user cache through its public reader,
// leave one load of A in flight, sign out, sign in as B: every answer is B's,
// nothing of A is reachable from any cache, and A's late answer does not land.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('../i18n/reloadPage', () => ({ reloadPage: vi.fn() }));

import { setToken } from '../api/client';
import { createAppContext, type AppContext } from '../context/app.svelte';
import { fakeDeps, manualTimers, type ManualTimers } from '../testing/context';
import { fillMissingWritten } from '$lib/studycore/entriesCache';
import { loadStarterEntries } from '../features/flashcards/decks/starterDecks';
import { loadLevelItems } from '../features/flashcards/decks/systemDeckItems';
import type { LevelDeck } from '../features/flashcards/decks/systemDecks';
import { loadEntryBases } from '../api/entryBases';
import { getEntryAudio } from '../api/audio';
import { fetchSchemeCharacters } from '../api/schemes';
import { fetchCharacters } from '../api/characters';
import { loadProviderNames } from '../features/journal/providerNames';
import { journalEntriesFor } from '../features/journal/journalEntries.svelte';
import { studyPullPages, loadStudyHistory, getStudyData } from '$lib/studycore/data';
import type { StudyCard } from '$lib/studycore/types';
import { WidgetLoad } from '$lib/widgets/widgetLoad.svelte';
import { heldLayout, rememberLayout } from '$lib/widgets/homeData';

const WS = 7;
const USERS = { 'tok-A': { id: 1, tag: 'AAA' }, 'tok-B': { id: 2, tag: 'BBB' } } as const;
type Token = keyof typeof USERS;

/** Requests of A held back until released. */
const held: (() => void)[] = [];
let holdForA: string[] = [];

function storage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k),
		clear: () => data.clear(),
		key: (i: number) => [...data.keys()][i] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

function typedCard(tag: string) {
	return {
		workspaceId: WS, id: 'c-vocab-1', kind: 'vocab', entryId: 1, written: tag, entryKind: null, sentenceId: null,
		skipKinds: [], deckIds: ['general'], createdAt: '2026-11-10T08:00:00Z', extra: {}, version: 1,
		updatedAt: '2026-11-12T10:00:00Z', deletedAt: null
	};
}

function answer(path: string, method: string, tag: string): unknown {
	if (path === '/api/auth/logout') return {};
	if (path.startsWith('/api/entries/bases')) return [{ id: 1, kind: 'word', written: tag }];
	if (path.startsWith('/api/entries/')) return { id: Number(path.split('/').pop()), written: tag };
	if (path.startsWith('/api/frequency-packs/')) return { entries: [{ id: 1, written: tag }] };
	if (path.startsWith('/api/schemes/1/entries')) return [{ id: 1, kind: 'word', written: tag }];
	if (path.startsWith('/api/schemes/1/characters')) return { levels: [{ id: 1, name: tag, chars: '日' }] };
	if (path.startsWith('/api/audio/entries/')) return { terms: [{ url: tag }], syllables: null };
	if (path.startsWith('/api/characters')) return { chars: [{ c: tag }], count: 1 };
	if (path.startsWith('/api/components')) return { packs: [], parts: [], chars: { 日: [tag] } };
	if (path.startsWith('/api/ai/providers')) return { providers: [{ id: 'p', name: tag }] };
	if (path.startsWith('/api/events')) {
		return {
			events: [{ id: `ev-${tag}`, userId: 1, workspaceId: WS, device: 'd', ts: '2026-11-01T00:00:00Z', type: 'read', payload: { tag } }],
			more: false,
			next: null
		};
	}
	if (path.startsWith('/api/sync/pull')) {
		return {
			format: 2, instanceId: '01JD8Z3Q4M5N6P7R8S9T0V1W2X', until: '2026-11-12T10:00:00Z',
			scope: { workspaces: [{ id: WS, language: 'zh' }], languages: ['zh'], catalogue: '"k"' }, restarted: [],
			collections: { rows: [], cards: [typedCard(tag)], decks: [], deckSettings: [], limits: [], fsrsSets: [], fsrsActive: [] },
			more: false, next: null, cursor: 'c2.x'
		};
	}
	throw new Error(`unexpected ${method} ${path}`);
}

let app: AppContext;
let timers: ManualTimers;

beforeEach(() => {
	vi.stubGlobal('localStorage', storage());
	timers = manualTimers();
	app = createAppContext(fakeDeps(undefined, { local: () => localStorage, window: null, timers }));
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: unknown, init?: RequestInit) => {
			const path = String(input);
			const header = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';
			const token = header.replace('Bearer ', '') as Token;
			const user = USERS[token];
			if (user === undefined) return new Response('{}', { status: 401 });
			if (user.tag === 'AAA' && holdForA.some((p) => path.startsWith(p))) {
				await new Promise<void>((release) => held.push(release));
			}
			return Response.json(answer(path, init?.method ?? 'GET', user.tag));
		})
	);
});

afterEach(() => {
	app.auth.logout();
	app.dispose();
	holdForA = [];
	held.length = 0;
	vi.unstubAllGlobals();
});

function signIn(token: Token): void {
	setToken(token);
	app.auth.set({ token, user: { id: USERS[token].id, username: token, admin: false, email: null, emailVerified: false, mustChangePassword: false, createdAt: '2026-01-01T00:00:00Z' } });
}

const legacyCard = (entryId: number): StudyCard => ({ id: `c-vocab-${entryId}`, kind: 'vocab', entryId, deckIds: ['general'], createdAt: '2026-11-10T08:00:00Z' });
const level: LevelDeck = { kind: 'level', schemeId: 1, packId: 'p', schemeName: 's', unit: 'word', level: 'L1', ord: 1 };

/** The current session's study state (read at each call: a new session is a new one). */
const study = () => app.session!.study;
/** The current session's caches of server answers. */
const caches = () => app.session!.caches;

/** Every cache, read through its public reader; the answer as JSON. */
const readers: Record<string, () => Promise<unknown>> = {
	entriesCache: () => fillMissingWritten(caches().written, [legacyCard(1)]),
	starterDecks: () => loadStarterEntries(caches().starters, 1, 10),
	systemDeckItems: () => loadLevelItems(caches().levelItems, level),
	entryBases: () => loadEntryBases(caches().entryBases, [1]).then((m) => [...m.values()]),
	audio: () => getEntryAudio(caches().audio, 1),
	schemes: () => fetchSchemeCharacters(caches().schemes, 1).then((levels) => levels.map((l) => l.name)),
	characters: () => fetchCharacters(caches().characters, 'zh'),
	providerNames: () => loadProviderNames(caches().providerNames).then((m) => [...m.values()]),
	studyHistory: () => loadStudyHistory(study(), WS),
	studyData: () => getStudyData(study(), WS),
	eventLog: () => app.session!.events.load(WS),
	// #290: a widget's held value and Home's held layout (memory and device copy).
	heldWidget: async () => {
		const shownAtMount = new WidgetLoad<unknown>(app.session!, 'probe', WS).value;
		const widget = new WidgetLoad<unknown>(app.session!, 'probe', WS);
		await widget.run(WS, () => app.session!.events.load(WS), String);
		return { shownAtMount, now: widget.value };
	},
	homeLayout: async () => {
		const session = app.session!;
		const before = heldLayout(session);
		const tag = Object.values(USERS).find((u) => u.id === session.user)!.tag;
		rememberLayout(session, [tag]);
		return { before, after: heldLayout(session) };
	}
};

async function readAll(): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const [name, read] of Object.entries(readers)) out[name] = JSON.stringify(await read());
	return out;
}

describe('sign-out isolation (#173)', () => {
	it('after A signs out and B signs in, every cache answers with B\'s data', async () => {
		signIn('tok-A');
		const asA = await readAll();
		for (const [name, json] of Object.entries(asA)) expect(json, name).toContain('AAA');
		const journalA = journalEntriesFor(caches().journalEntries, WS);
		const studyA = study();
		expect(studyPullPages(studyA, WS)).toBeGreaterThan(0);
		studyA.unreadable.record(WS, { cards: 1 }, []);

		app.auth.logout();
		expect(studyPullPages(studyA, WS)).toBe(0);
		expect(studyA.unreadable.report).toBeNull();
		signIn('tok-B');

		const asB = await readAll();
		for (const [name, json] of Object.entries(asB)) {
			expect(json, name).toContain('BBB');
			expect(json, name).not.toContain('AAA');
		}
		expect(journalEntriesFor(caches().journalEntries, WS)).not.toBe(journalA);
	});

	it('a load of A still in flight at sign-out never lands in a cache B reads', async () => {
		signIn('tok-A');
		holdForA = ['/api/entries/2', '/api/schemes/1/entries', '/api/entries/bases', '/api/audio/entries/', '/api/sync/pull', '/api/events'];
		const lateA = [
			fillMissingWritten(caches().written, [legacyCard(2)]),
			loadLevelItems(caches().levelItems, level),
			loadEntryBases(caches().entryBases, [1]),
			getEntryAudio(caches().audio, 1),
			loadStudyHistory(study(), WS),
			getStudyData(study(), WS),
			app.session!.events.load(WS)
		];
		// The history and the raw data share one study round (#193): six requests held.
		await vi.waitFor(() => expect(held.length).toBe(6));

		app.auth.logout();
		signIn('tok-B');
		// A's answers arrive only now, after B signed in.
		for (const release of held) release();
		await Promise.allSettled(lateA);

		const asB = {
			entries: JSON.stringify(await fillMissingWritten(caches().written, [legacyCard(2)])),
			...(await readAll())
		};
		for (const [name, json] of Object.entries(asB)) expect(json, name).not.toContain('AAA');
	});

	it("A's session leaves no timer running: after sign-out nothing of A fires, nothing asks for A", async () => {
		signIn('tok-A');
		await readAll();
		// The server refuses A's reviews for now: the review waits in the outbox, which polls to send it.
		const answering = vi.mocked(fetch).getMockImplementation()!;
		vi.mocked(fetch).mockImplementation(async (input, init) =>
			String(input) === '/api/events/batch' ? new Response('{}', { status: 503 }) : answering(input, init)
		);
		const outbox = app.session!.outbox;
		outbox.start();
		await outbox.recordReview(WS, 'c-vocab-1', 3);
		expect(outbox.pendingCount(USERS['tok-A'].id)).toBe(1);
		expect(timers.pending()).toBeGreaterThan(0);

		app.auth.logout();
		expect(timers.pending()).toBe(0);
		const fetched = vi.mocked(fetch).mock.calls.length;
		timers.advance(60 * 60 * 1000);
		await Promise.resolve();
		expect(vi.mocked(fetch).mock.calls.length).toBe(fetched);
	});
});
