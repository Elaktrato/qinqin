import { describe, expect, it } from 'vitest';
import en from '../../i18n/messages/en.json';
import { rawMessage } from '../../i18n';
import { FakeCacheStorage } from '../../testing/fakeCaches';
import {
	ENGLISH_FALLBACK,
	PUSH_TEXT_KEYS,
	PUSH_TEXTS_CACHE,
	clearPushTexts,
	pushText,
	pushTextsOf,
	readPushTexts,
	writePushTexts
} from './pushTexts';

describe('the text map and the catalogue agree', () => {
	it('the English fallback is exactly the en catalogue', () => {
		for (const key of PUSH_TEXT_KEYS) expect(ENGLISH_FALLBACK[key], key).toBe((en as Record<string, string>)[key]);
		expect(Object.keys(ENGLISH_FALLBACK).sort()).toEqual([...PUSH_TEXT_KEYS].sort());
	});
	it('the page builds the map from its catalogue, every key present', () => {
		const texts = pushTextsOf(rawMessage, 'en-GB');
		expect(Object.keys(texts.messages).sort()).toEqual([...PUSH_TEXT_KEYS].sort());
		expect(texts.messages['settings.reminders.notify.due.body']).toBe(ENGLISH_FALLBACK['settings.reminders.notify.due.body']);
	});
});

describe('storing and reading', () => {
	it('round-trips through the cache and clears', async () => {
		const caches = new FakeCacheStorage();
		const texts = pushTextsOf(rawMessage, 'en-GB');
		await writePushTexts(caches, texts);
		expect(await readPushTexts(caches)).toEqual(texts);
		await clearPushTexts(caches);
		expect(await readPushTexts(caches)).toBeNull();
	});
	it('reads null for nothing stored or junk, never throws', async () => {
		const caches = new FakeCacheStorage();
		expect(await readPushTexts(caches)).toBeNull();
		await (await caches.open(PUSH_TEXTS_CACHE)).put('https://push-texts.invalid/v1', new Response('not json'));
		expect(await readPushTexts(caches)).toBeNull();
		await (await caches.open(PUSH_TEXTS_CACHE)).put('https://push-texts.invalid/v1', new Response('"str"'));
		expect(await readPushTexts(caches)).toBeNull();
	});
});

describe('pushText', () => {
	it('formats the stored message with the count and its locale', () => {
		const texts = { locale: 'en', messages: { 'settings.reminders.notify.due.body': '{count, plural, one {# Karte} other {# Karten}}' } } as const;
		expect(pushText('settings.reminders.notify.due.body', texts, 3)).toBe('3 Karten');
		expect(pushText('settings.reminders.notify.due.body', texts, 1)).toBe('1 Karte');
	});
	it('falls back to English with no map, a missing key or a broken message', () => {
		expect(pushText('settings.reminders.notify.due.body', null, 15)).toBe('15 cards are due.');
		expect(pushText('settings.reminders.notify.due.title', { locale: 'en', messages: {} }, null)).toBe('Time to study');
		expect(pushText('settings.reminders.notify.due.body', { locale: 'en', messages: { 'settings.reminders.notify.due.body': '{count, plural, ' } }, 2)).toBe('2 cards are due.');
	});
});
