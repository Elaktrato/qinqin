import { describe, expect, it, vi } from 'vitest';

// The reload after a language change must never loop (review of #73, and per workspace #297): fake catalogues `xx`
// and `yy` are mocked in so the account and a workspace can resolve to something other than the running en.
vi.mock('./negotiate', async (importOriginal) => ({
	...(await importOriginal<typeof import('./negotiate')>()),
	SUPPORTED_LANGUAGES: ['en', 'xx', 'yy']
}));

import {
	MIRROR_KEY,
	RELOAD_MARKER_KEY,
	followInterfaceLanguage,
	mirrorWorkspaceLanguage,
	startupLanguage,
	switchInterfaceLanguage,
	workspaceMirrorKey
} from './interfaceLanguage';

function memoryStorage(initial: Record<string, string> = {}): Storage & { data: Map<string, string> } {
	const data = new Map(Object.entries(initial));
	return {
		data,
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (k: string) => data.get(k) ?? null,
		key: (i: number) => [...data.keys()][i] ?? null,
		removeItem: (k: string) => void data.delete(k),
		setItem: (k: string, v: string) => void data.set(k, v)
	};
}

const blocked = {
	getItem() {
		throw new Error('denied');
	},
	setItem() {
		throw new Error('denied');
	},
	removeItem() {
		throw new Error('denied');
	}
} as unknown as Storage;

const withCatalogue = (lang: string) => lang;

function follow(o: {
	storage: Storage | null;
	session?: Storage | null;
	running?: string;
	catalogue?: (lang: string) => string;
	reload: () => void;
}): boolean {
	return followInterfaceLanguage(
		{ account: 'xx', workspace: null },
		{
			running: o.running ?? 'en',
			storage: o.storage,
			session: o.session === undefined ? memoryStorage() : o.session,
			browser: [],
			catalogue: o.catalogue ?? withCatalogue,
			reload: o.reload
		}
	);
}

describe('followInterfaceLanguage (the account, outside a workspace): the reload never loops', () => {
	it('reloads once when the mirror now holds the account language and its catalogue differs', () => {
		const storage = memoryStorage();
		const session = memoryStorage();
		const reload = vi.fn();
		expect(follow({ storage, session, reload })).toBe(true);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(storage.getItem(MIRROR_KEY)).toBe('xx');
		expect(session.getItem(RELOAD_MARKER_KEY)).not.toBeNull();
	});

	it('(a) setItem throws but getItem returns the old value: no reload', () => {
		const storage = memoryStorage({ [MIRROR_KEY]: 'en' });
		storage.setItem = () => {
			throw new Error('quota');
		};
		const reload = vi.fn();
		expect(follow({ storage, reload })).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});

	it('(b) a supported language whose catalogue is missing loads en: no reload when en already runs', () => {
		const reload = vi.fn();
		expect(follow({ storage: memoryStorage(), catalogue: () => 'en', reload })).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});

	it('(c) storage blocked at sign-in: no reload (it would drop the session)', () => {
		const reload = vi.fn();
		expect(follow({ storage: blocked, reload })).toBe(false);
		expect(follow({ storage: null, reload })).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});

	it('a start right after a language reload does not reload again, and consumes the marker', () => {
		const session = memoryStorage({ [RELOAD_MARKER_KEY]: '1' });
		const reload = vi.fn();
		expect(follow({ storage: memoryStorage(), session, reload })).toBe(false);
		expect(reload).not.toHaveBeenCalled();
		expect(session.getItem(RELOAD_MARKER_KEY)).toBeNull();
	});

	it('no reload when the one-shot marker cannot be written', () => {
		const reload = vi.fn();
		expect(follow({ storage: memoryStorage(), session: blocked, reload })).toBe(false);
		expect(follow({ storage: memoryStorage(), session: null, reload })).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});
});

describe('followInterfaceLanguage in a workspace (#297)', () => {
	const ws = (id: number, interfaceLanguage?: string) => ({ id, settings: interfaceLanguage === undefined ? {} : { interfaceLanguage } });
	const opts = (o: { storage: Storage; session?: Storage; running?: string; reload: () => void }) => ({
		running: o.running ?? 'en',
		storage: o.storage,
		session: o.session ?? memoryStorage(),
		browser: [] as string[],
		catalogue: withCatalogue,
		reload: o.reload
	});

	it('a workspace with its own language: mirrored per workspace, and the page reloads into it once', () => {
		const storage = memoryStorage();
		const session = memoryStorage();
		const reload = vi.fn();
		expect(followInterfaceLanguage({ account: '', workspace: ws(7, 'yy') }, opts({ storage, session, reload }))).toBe(true);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(storage.getItem(workspaceMirrorKey(7))).toBe('yy');
		expect(storage.getItem(MIRROR_KEY)).toBe('en');
		// The start the reload causes opens in it, and does not reload again.
		expect(startupLanguage({ signedIn: true, storage, browser: [], workspace: 7 })).toBe('yy');
		expect(followInterfaceLanguage({ account: '', workspace: ws(7, 'yy') }, opts({ storage, session, running: 'yy', reload }))).toBe(false);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('a workspace without one follows the account; its mirror is removed', () => {
		const storage = memoryStorage({ [workspaceMirrorKey(3)]: 'yy' });
		const reload = vi.fn();
		expect(followInterfaceLanguage({ account: 'xx', workspace: ws(3) }, opts({ storage, reload }))).toBe(true);
		expect(storage.getItem(workspaceMirrorKey(3))).toBeNull();
		expect(storage.getItem(MIRROR_KEY)).toBe('xx');
		expect(startupLanguage({ signedIn: true, storage, browser: [], workspace: 3 })).toBe('xx');
	});

	it('switching workspaces: into another language reloads, into the running one does not', () => {
		const storage = memoryStorage();
		const reload = vi.fn();
		expect(followInterfaceLanguage({ account: '', workspace: ws(1) }, opts({ storage, reload }))).toBe(false);
		expect(followInterfaceLanguage({ account: '', workspace: ws(2, 'en') }, opts({ storage, reload }))).toBe(false);
		expect(reload).not.toHaveBeenCalled();
		expect(followInterfaceLanguage({ account: '', workspace: ws(3, 'xx') }, opts({ storage, reload }))).toBe(true);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('the start after a language reload never reloads again, even into another workspace\'s language', () => {
		const storage = memoryStorage();
		const session = memoryStorage({ [RELOAD_MARKER_KEY]: '1' });
		const reload = vi.fn();
		expect(followInterfaceLanguage({ account: '', workspace: ws(4, 'xx') }, opts({ storage, session, reload }))).toBe(false);
		expect(reload).not.toHaveBeenCalled();
		// The marker is one-shot: a later switch at this start (a person's choice) may reload.
		expect(followInterfaceLanguage({ account: '', workspace: ws(5, 'yy') }, opts({ storage, session, reload }))).toBe(true);
	});

	it('the workspace mirror cannot be written (quota): no reload, the next start would not show it', () => {
		const storage = memoryStorage();
		const setItem = storage.setItem;
		storage.setItem = (k: string, v: string) => {
			if (k === workspaceMirrorKey(9)) throw new Error('quota');
			setItem(k, v);
		};
		const reload = vi.fn();
		expect(followInterfaceLanguage({ account: '', workspace: ws(9, 'xx') }, opts({ storage, reload }))).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});

	it('blocked storage: no reload in a workspace either', () => {
		const reload = vi.fn();
		expect(followInterfaceLanguage({ account: '', workspace: ws(9, 'xx') }, { ...opts({ storage: memoryStorage(), reload }), storage: blocked })).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});
});

describe('startupLanguage in a workspace (#297): the first paint and an offline start', () => {
	it('the remembered workspace\'s own language, else the account mirror', () => {
		const storage = memoryStorage({ [MIRROR_KEY]: 'xx', [workspaceMirrorKey(7)]: 'yy' });
		expect(startupLanguage({ signedIn: true, storage, browser: [], workspace: 7 })).toBe('yy');
		expect(startupLanguage({ signedIn: true, storage, browser: [], workspace: 8 })).toBe('xx');
		expect(startupLanguage({ signedIn: true, storage, browser: [], workspace: null })).toBe('xx');
	});

	it('a malformed workspace mirror is ignored; signed out the browser decides', () => {
		const storage = memoryStorage({ [MIRROR_KEY]: 'xx', [workspaceMirrorKey(7)]: 'Y Y' });
		expect(startupLanguage({ signedIn: true, storage, browser: [], workspace: 7 })).toBe('xx');
		expect(startupLanguage({ signedIn: false, storage, browser: ['yy'], workspace: 7 })).toBe('yy');
	});
});

describe('mirrorWorkspaceLanguage (Settings → Workspaces save)', () => {
	it('mirrors the workspace\'s own setting and says whether the next start shows it', () => {
		const storage = memoryStorage({ [MIRROR_KEY]: 'en' });
		expect(mirrorWorkspaceLanguage(storage, { id: 4, settings: { interfaceLanguage: 'xx' } }, '', [])).toBe(true);
		expect(storage.getItem(workspaceMirrorKey(4))).toBe('xx');
		expect(mirrorWorkspaceLanguage(storage, { id: 4, settings: {} }, '', [])).toBe(true);
		expect(storage.getItem(workspaceMirrorKey(4))).toBeNull();
	});

	it('false when the browser blocks site storage', () => {
		expect(mirrorWorkspaceLanguage(blocked, { id: 4, settings: { interfaceLanguage: 'xx' } }, '', [])).toBe(false);
		expect(mirrorWorkspaceLanguage(null, { id: 4, settings: { interfaceLanguage: 'xx' } }, '', [])).toBe(false);
	});
});

describe('switchInterfaceLanguage (Settings save)', () => {
	it('reloads only when the mirror now holds the new language', () => {
		const reload = vi.fn();
		const storage = memoryStorage();
		expect(switchInterfaceLanguage('xx', { storage, reload })).toBe(true);
		expect(storage.getItem(MIRROR_KEY)).toBe('xx');
		expect(switchInterfaceLanguage('xx', { storage: blocked, reload })).toBe(false);
		expect(switchInterfaceLanguage('xx', { storage: null, reload })).toBe(false);
		expect(reload).toHaveBeenCalledTimes(1);
	});
});
