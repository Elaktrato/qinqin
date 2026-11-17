import { describe, expect, it, vi } from 'vitest';

// The reload after a language change must never loop (review of #73): a second supported language `xx` is mocked
// in so the account can resolve to something other than the running en.
vi.mock('./negotiate', async (importOriginal) => ({
	...(await importOriginal<typeof import('./negotiate')>()),
	SUPPORTED_LANGUAGES: ['en', 'xx']
}));

import { MIRROR_KEY, RELOAD_MARKER_KEY, followServerLanguage, switchInterfaceLanguage } from './interfaceLanguage';

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
	return followServerLanguage(
		{ interfaceLanguage: 'xx' },
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

describe('followServerLanguage: the reload never loops', () => {
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
