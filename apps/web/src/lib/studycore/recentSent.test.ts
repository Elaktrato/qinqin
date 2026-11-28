import { beforeEach, describe, expect, it } from 'vitest';
import {
	RECENT_SENT_KEY,
	RECENT_SENT_MAX,
	RECENT_SENT_TTL_MS,
	clearRecentSent,
	recentSentReviews,
	rememberSent
} from './recentSent';

function storageStub(): Storage {
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

const ev = (id: string, ws = 7) => ({ id, workspaceId: ws, device: 'web', ts: '2026-03-01T00:00:00.000Z', type: 'review', payload: {} }) as never;
const NOW = Date.parse('2026-03-01T12:00:00Z');

let store: Storage;
beforeEach(() => {
	store = storageStub();
});

describe('recent sent reviews', () => {
	it('keeps what was sent, per user and workspace', () => {
		rememberSent(1, [ev('a'), ev('b', 8)], NOW, store);
		rememberSent(2, [ev('c')], NOW, store);
		expect(recentSentReviews(1, 7, NOW, store).map((e) => e.id)).toEqual(['a']);
		expect(recentSentReviews(1, 8, NOW, store).map((e) => e.id)).toEqual(['b']);
		expect(recentSentReviews(2, 7, NOW, store).map((e) => e.id)).toEqual(['c']);
	});

	it('keeps sent drill answers too', () => {
		const typed = (id: string, type: string) => ({ ...(ev(id) as object), type }) as never;
		rememberSent(1, [typed('d', 'drill.tone-pairs'), typed('x', 'drill.weakest')], NOW, store);
		expect(recentSentReviews(1, 7, NOW, store).map((e) => e.id)).toEqual(['d']);
	});

	it('keeps sent grammar lesson runs too (#277), never other events', () => {
		const typed = (id: string, type: string) => ({ ...(ev(id) as object), type }) as never;
		rememberSent(1, [typed('g', 'grammar'), typed('r', 'read'), typed('s', 'session')], NOW, store);
		expect(recentSentReviews(1, 7, NOW, store).map((e) => e.id)).toEqual(['g']);
	});

	it('keeps sent course events too (#224): a test passed online shows on the roadmap before the log refreshes', () => {
		const typed = (id: string, type: string) => ({ ...(ev(id) as object), type }) as never;
		rememberSent(1, [typed('c', 'course'), typed('r', 'read')], NOW, store);
		expect(recentSentReviews(1, 7, NOW, store).map((e) => e.id)).toEqual(['c']);
	});

	it('keeps sent notebook marks too (#227): a removed item stays out before the log refreshes', () => {
		const typed = (id: string, type: string) => ({ ...(ev(id) as object), type }) as never;
		rememberSent(1, [typed('n', 'notebook'), typed('v', 'view')], NOW, store);
		expect(recentSentReviews(1, 7, NOW, store).map((e) => e.id)).toEqual(['n']);
	});

	it('forgets entries older than three days', () => {
		rememberSent(1, [ev('old')], NOW - RECENT_SENT_TTL_MS - 1, store);
		rememberSent(1, [ev('new')], NOW, store);
		expect(recentSentReviews(1, 7, NOW, store).map((e) => e.id)).toEqual(['new']);
	});

	it('keeps the newest few hundred', () => {
		for (let i = 0; i < RECENT_SENT_MAX + 5; i++) rememberSent(1, [ev(`e${i}`)], NOW, store);
		const ids = recentSentReviews(1, 7, NOW, store).map((e) => e.id);
		expect(ids).toHaveLength(RECENT_SENT_MAX);
		expect(ids[ids.length - 1]).toBe(`e${RECENT_SENT_MAX + 4}`);
		expect(ids).not.toContain('e0');
	});

	it('clearRecentSent removes everything; corrupt storage reads as empty', () => {
		rememberSent(1, [ev('a')], NOW, store);
		clearRecentSent(store);
		expect(store.getItem(RECENT_SENT_KEY)).toBeNull();
		store.setItem(RECENT_SENT_KEY, '{nope');
		expect(recentSentReviews(1, 7, NOW, store)).toEqual([]);
		expect(() => rememberSent(1, [ev('a')], NOW, store)).not.toThrow();
	});
});
