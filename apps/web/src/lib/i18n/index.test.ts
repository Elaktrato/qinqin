import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFormatLocale, getLanguage, installCatalogue, loadCatalogue, resetCatalogue, t, tParts, type MessageKey } from './index';
import { MessageError } from './message';

afterEach(() => {
	resetCatalogue();
	vi.restoreAllMocks();
});

const k = (s: string) => s as MessageKey;

describe('t', () => {
	it('reads the English catalogue', () => {
		expect(t('app.name')).toBe('qinqin');
		expect(getLanguage()).toBe('en');
	});

	it('formats arguments and plurals with the active format locale', () => {
		installCatalogue('xx', { 'test.due': '{n, plural, one {# card} other {# cards}}', 'test.hi': 'Hi {name}' }, 'de');
		expect(t(k('test.due'), { n: 1234 })).toBe('1.234 cards');
		expect(t(k('test.hi'), { name: 'Li' })).toBe('Hi Li');
		expect(getLanguage()).toBe('xx');
		expect(getFormatLocale()).toBe('de');
	});

	it('falls back to en per key and warns in dev and tests', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		installCatalogue('xx', {});
		expect(t('app.name')).toBe('qinqin');
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('app.name'));
	});

	it('throws in dev and tests on a missing argument and on an unknown key', () => {
		installCatalogue('xx', { 'test.hi': 'Hi {name}' });
		expect(() => t(k('test.hi'))).toThrow(MessageError);
		expect(() => t(k('no.such.key'))).toThrow(/no\.such\.key/);
	});

	it('tParts returns rich-text parts', () => {
		installCatalogue('xx', { 'test.link': 'Read <link>{what}</link> now' });
		expect(tParts(k('test.link'), { what: 'this' })).toEqual([
			{ text: 'Read ' },
			{ tag: 'link', text: 'this' },
			{ text: ' now' }
		]);
	});
});

describe('loadCatalogue', () => {
	it('en needs no request and sets the format locale from the device languages', async () => {
		await loadCatalogue('en', ['en-GB', 'de']);
		expect(getLanguage()).toBe('en');
		expect(getFormatLocale()).toBe('en-GB');
		expect(t('app.name')).toBe('qinqin');
	});

	it('a language without a catalogue resolves to en', async () => {
		await loadCatalogue('zz', ['zz-ZZ']);
		expect(getLanguage()).toBe('en');
		expect(getFormatLocale()).toBe('en');
	});
});
