import { describe, expect, it } from 'vitest';
import messages from '../../../../../docs/contracts/i18n/messages.json';
import invalid from '../../../../../docs/contracts/i18n/invalid-messages.json';
import plurals from '../../../../../docs/contracts/i18n/plural-categories.json';
import negotiation from '../../../../../docs/contracts/i18n/negotiate.json';
import tags from '../../../../../docs/contracts/i18n/language-tags.json';
import android from '../../../../../docs/contracts/i18n/android-convert.json';
import retired from '../../../../../docs/contracts/i18n/retired-keys.json';
import { MessageError, formatMessage, formatParts, parseMessage, pluralCategory } from './message';
import { formatLocale, isLanguageSetting, negotiate } from './negotiate';
import { convert } from '../../../scripts/i18n-android.mjs';

// Every fixture of docs/contracts/i18n/ (that no catalogue holds a retired key: catalogue.test.ts).

type MessageCase = {
	name: string;
	message: string;
	locale: string;
	args: Record<string, string | number>;
	output?: string;
	parts?: ({ text: string } | { tag: string; text: string })[];
	error?: string;
};

describe('i18n/messages.json', () => {
	const cases = messages.cases as MessageCase[];
	it('has cases', () => expect(cases.length).toBeGreaterThan(20));
	it.each(cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
		if (c.error !== undefined) {
			let err: unknown;
			try {
				formatMessage(c.message, c.locale, c.args);
			} catch (e) {
				err = e;
			}
			expect(err).toBeInstanceOf(MessageError);
			expect((err as MessageError).kind).toBe(c.error);
			return;
		}
		expect(formatMessage(c.message, c.locale, c.args)).toBe(c.output);
		if (c.parts !== undefined) expect(formatParts(c.message, c.locale, c.args)).toEqual(c.parts);
	});
});

describe('i18n/invalid-messages.json', () => {
	it.each(invalid.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
		let err: unknown;
		try {
			parseMessage(c.message);
		} catch (e) {
			err = e;
		}
		expect(err, c.message).toBeInstanceOf(MessageError);
		expect((err as MessageError).kind).toBe(c.error);
	});
});

describe('i18n/plural-categories.json', () => {
	it.each(plurals.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
		expect(pluralCategory(c.locale, c.n)).toBe(c.category);
	});
});

describe('i18n/negotiate.json', () => {
	it.each(negotiation.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
		expect(negotiate(c.candidates, c.supported)).toBe(c.result);
	});
	it.each(negotiation.formatLocale.map((c) => [c.name, c] as const))('formatLocale: %s', (_, c) => {
		expect(formatLocale(c.interface, c.device)).toBe(c.result);
	});
});

describe('i18n/language-tags.json', () => {
	it('states the pattern the README states', () => {
		expect(tags.pattern).toBe('^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$');
	});
	it.each(tags.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
		expect(isLanguageSetting(c.value)).toBe(c.valid);
	});
	it('refuses non-strings', () => {
		for (const v of [null, undefined, 1, {}, ['en']]) expect(isLanguageSetting(v)).toBe(false);
	});
});

type AndroidCase = {
	name: string;
	catalogue: Record<string, string>;
	en?: Record<string, string>;
	notes?: Record<string, string>;
	output: string;
};

describe('i18n/android-convert.json', () => {
	it.each((android.cases as unknown as AndroidCase[]).map((c) => [c.name, c] as const))('%s', (_, c) => {
		expect(convert(c.catalogue, c.en ?? c.catalogue, c.notes ?? {})).toBe(c.output);
	});
});

describe('i18n/retired-keys.json', () => {
	it('is a list of unique keys', () => {
		const keys: unknown[] = retired.keys;
		expect(Array.isArray(keys)).toBe(true);
		for (const k of keys) expect(typeof k).toBe('string');
		expect(new Set(keys).size).toBe(keys.length);
	});
});
