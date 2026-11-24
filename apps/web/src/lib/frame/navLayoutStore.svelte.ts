// The person's phone navigation as the frame reads it (#188): the
// `nav-layout` row (lib/frame/navLayout.ts), loaded once per signed-in user
// and again when the app comes back to the front (another device may have
// changed it), and replaced at once when Settings saves a change.
//
// The last value read is kept on the device (localStorage, per user), so a
// reload paints the person's choice (bar or side menu) right away instead
// of the default and then a jump. Signing out forgets the value in memory
// and on the device.

import { defaultNavLayout, loadNavLayout, parseNavLayout, type NavLayout } from './navLayout';

export const NAV_LAYOUT_CACHE_KEY = 'qinqin.navLayout.v1';
/** Coming back to the front re-reads the row at most this often (ms). */
const REFRESH_EVERY = 60_000;

export interface NavLayoutStoreDeps {
	load(): Promise<NavLayout>;
	storage(): Storage | null;
	now(): number;
}

const defaultDeps: NavLayoutStoreDeps = {
	load: loadNavLayout,
	storage: () => {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	},
	now: () => Date.now()
};

function readCache(storage: Storage | null, user: number): NavLayout | null {
	try {
		const raw = storage?.getItem(NAV_LAYOUT_CACHE_KEY);
		if (!raw) return null;
		const cached = JSON.parse(raw) as { user?: unknown; layout?: { phone?: unknown; bar?: unknown } };
		if (cached.user !== user || typeof cached.layout !== 'object' || cached.layout === null) return null;
		return parseNavLayout({ version: 1, ...cached.layout });
	} catch {
		return null;
	}
}

function writeCache(storage: Storage | null, user: number | null, layout: NavLayout | null): void {
	try {
		if (user === null || layout === null) storage?.removeItem(NAV_LAYOUT_CACHE_KEY);
		else storage?.setItem(NAV_LAYOUT_CACHE_KEY, JSON.stringify({ user, layout }));
	} catch {
		// A full or blocked storage only costs the instant paint after a reload.
	}
}

export function createNavLayoutStore(overrides: Partial<NavLayoutStoreDeps> = {}) {
	const deps: NavLayoutStoreDeps = { ...defaultDeps, ...overrides };
	let layout = $state.raw<NavLayout>(defaultNavLayout());
	let user: number | null = null;
	let loadedAt = 0;
	// Bumped by every set: a slower load never overwrites a newer choice.
	let generation = 0;
	// Saves in flight (Settings): a read that lands meanwhile may predate
	// the write, so it is dropped.
	let saving = 0;
	// Counts saves begun: a read that overlapped any save is dropped too.
	let saveEpoch = 0;

	async function refresh(): Promise<void> {
		if (user === null) return;
		const forUser = user;
		const asked = ++generation;
		// A read begun during a save may predate the write: count it as overlapping.
		const epoch = saving > 0 ? -1 : saveEpoch;
		loadedAt = deps.now();
		try {
			const next = await deps.load();
			if (user !== forUser || asked !== generation || saving > 0 || epoch !== saveEpoch) return;
			layout = next;
			writeCache(deps.storage(), forUser, next);
		} catch {
			// Offline or a failed read: keep what is painted (the cache or the defaults).
		}
	}

	return {
		get phone() {
			return layout.phone;
		},
		get bar(): readonly string[] {
			return layout.bar;
		},
		get layout(): NavLayout {
			return layout;
		},
		/** setUser: the signed-in user (null signs out); loads their row once. */
		setUser(id: number | null): Promise<void> {
			if (id === user) return Promise.resolve();
			user = id;
			generation++;
			if (id === null) {
				layout = defaultNavLayout();
				writeCache(deps.storage(), null, null);
				return Promise.resolve();
			}
			layout = readCache(deps.storage(), id) ?? defaultNavLayout();
			return refresh();
		},
		/** resume: the app came back to the front; re-read the row (throttled). */
		resume(): Promise<void> {
			if (user === null || deps.now() - loadedAt < REFRESH_EVERY) return Promise.resolve();
			return refresh();
		},
		/** reload: re-read the row now (Settings opens, a failed save is abandoned). */
		reload(): Promise<void> {
			return refresh();
		},
		/**
		 * set: show a value at once. `confirmed` (the server has it) also keeps it
		 * on the device; an optimistic value is not cached, so a failed save never
		 * outlives a reload.
		 */
		set(next: NavLayout, confirmed = true): void {
			generation++;
			layout = next;
			if (confirmed) writeCache(deps.storage(), user, next);
		},
		/** beginSave / endSave bracket a write: reads landing meanwhile are dropped. */
		beginSave(): void {
			saving++;
			saveEpoch++;
		},
		endSave(): void {
			saving = Math.max(0, saving - 1);
		}
	};
}

export type NavLayoutStore = ReturnType<typeof createNavLayoutStore>;

