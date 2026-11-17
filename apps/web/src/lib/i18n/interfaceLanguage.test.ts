import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	MIRROR_KEY,
	applyDocumentLanguage,
	followServerLanguage,
	readMirror,
	resolveInterfaceLanguage,
	startupLanguage,
	writeMirror
} from './interfaceLanguage';

// The interface language on the web (spec "Interface language setting", web flow): signed out the browser's
// languages decide; signed in the stored setting ('' = the browser's); the last resolved language is mirrored in
// localStorage for the first paint and an offline start; when `me` brings a different one, the page reloads once.

function memoryStorage(initial: Record<string, string> = {}): Storage {
	const data = new Map(Object.entries(initial));
	return {
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

const throwing = {
	getItem() {
		throw new Error('denied');
	},
	setItem() {
		throw new Error('denied');
	}
} as unknown as Storage;

afterEach(() => vi.restoreAllMocks());

describe('resolveInterfaceLanguage', () => {
	it('signed out: the browser languages', () => {
		expect(resolveInterfaceLanguage(undefined, ['de-DE', 'en-GB'])).toBe('en');
		expect(resolveInterfaceLanguage(undefined, [])).toBe('en');
	});
	it('signed in: the stored setting; an empty setting follows the browser', () => {
		expect(resolveInterfaceLanguage('en', ['fr'])).toBe('en');
		expect(resolveInterfaceLanguage('', ['en-US'])).toBe('en');
		// A tag no catalogue supports negotiates like any candidate (today: en).
		expect(resolveInterfaceLanguage('zh-Hant', [])).toBe('en');
	});
});

describe('the localStorage mirror', () => {
	it('is read and written in try/catch: blocked storage reads as nothing', () => {
		const s = memoryStorage();
		expect(readMirror(s)).toBeNull();
		writeMirror(s, 'en');
		expect(s.getItem(MIRROR_KEY)).toBe('en');
		expect(readMirror(s)).toBe('en');
		expect(readMirror(throwing)).toBeNull();
		expect(() => writeMirror(throwing, 'en')).not.toThrow();
		expect(readMirror(null)).toBeNull();
	});
	it('ignores a mirrored value that is not a language tag', () => {
		expect(readMirror(memoryStorage({ [MIRROR_KEY]: 'english!' }))).toBeNull();
	});
});

describe('startupLanguage', () => {
	it('signed in (a token is stored): the mirror for the first paint and an offline start', () => {
		expect(startupLanguage({ signedIn: true, storage: memoryStorage({ [MIRROR_KEY]: 'en' }), browser: ['de'] })).toBe('en');
	});
	it('signed in without a mirror, or signed out: the browser languages', () => {
		expect(startupLanguage({ signedIn: true, storage: memoryStorage(), browser: ['en-GB'] })).toBe('en');
		expect(startupLanguage({ signedIn: false, storage: memoryStorage({ [MIRROR_KEY]: 'xx' }), browser: [] })).toBe('en');
	});
});

describe('followServerLanguage', () => {
	it('mirrors the resolved language and reloads only when it differs from the running one', () => {
		const s = memoryStorage();
		const reload = vi.fn();
		expect(followServerLanguage({ interfaceLanguage: '' }, { running: 'en', storage: s, browser: ['en'], reload })).toBe(false);
		expect(reload).not.toHaveBeenCalled();
		expect(s.getItem(MIRROR_KEY)).toBe('en');
		expect(followServerLanguage({ interfaceLanguage: 'en' }, { running: 'xx', storage: s, browser: [], reload })).toBe(true);
		expect(reload).toHaveBeenCalledTimes(1);
	});
	it('an older server without the field behaves like the browser default', () => {
		const reload = vi.fn();
		expect(followServerLanguage({}, { running: 'en', storage: null, browser: ['fr'], reload })).toBe(false);
	});
});

describe('applyDocumentLanguage', () => {
	it('sets <html lang> and dir', () => {
		const attrs = new Map<string, string>();
		const el = { setAttribute: (k: string, v: string) => void attrs.set(k, v), getAttribute: (k: string) => attrs.get(k) ?? null };
		applyDocumentLanguage(el, 'en');
		expect(el.getAttribute('lang')).toBe('en');
		expect(el.getAttribute('dir')).toBe('ltr');
		applyDocumentLanguage(el, 'ar');
		expect(el.getAttribute('dir')).toBe('rtl');
		applyDocumentLanguage(el, 'he-IL');
		expect(el.getAttribute('dir')).toBe('rtl');
	});
});
