// The texts of push notifications (#139). The service worker cannot use the page's catalogue, so the page stores a
// tiny map of the raw catalogue messages (the settings.reminders.notify.* keys, `{count}` placeholders and
// plurals as in the catalogue) in the Cache API under one fixed key; the worker reads it at `push` time and
// formats it with the same message formatter. With no stored map (never opened since the sign-in, a cleared
// cache) it falls back to ENGLISH_FALLBACK below. That constant is the one allowed place for fallback English
// outside the catalogue; pushTexts.test.ts pins it to messages/en.json, so the two cannot drift.
//
// Why the Cache API and not IndexedDB: a cache is reachable from both the page and the worker without a schema or
// a version upgrade, and the worker already holds `caches`. The entry never holds user data: interface text only.

import type { MessageKey } from '$lib/i18n';
import { formatMessage } from '$lib/i18n/message';
import type { CacheStorageLike } from './strategies';

export const PUSH_TEXTS_CACHE = 'qinqin-push-texts-v1';
/** An unused, same-origin-shaped address: the entry is never fetched, only matched. */
export const PUSH_TEXTS_URL = 'https://push-texts.invalid/v1';

export const PUSH_TEXT_KEYS = [
	'settings.reminders.notify.due.title',
	'settings.reminders.notify.due.body',
	'settings.reminders.notify.goal.title',
	'settings.reminders.notify.goal.body',
	'settings.reminders.notify.streak.title',
	'settings.reminders.notify.streak.body',
	'settings.reminders.notify.test.title',
	'settings.reminders.notify.test.body',
	'settings.reminders.notify.generic.title',
	'settings.reminders.notify.generic.body'
] as const satisfies readonly MessageKey[];

export type PushTextKey = (typeof PUSH_TEXT_KEYS)[number];

export interface PushTexts {
	/** The format locale of the page (plural rules, number formats). */
	locale: string;
	messages: Partial<Record<PushTextKey, string>>;
}

/** English, as in messages/en.json (pushTexts.test.ts keeps them equal). */
export const ENGLISH_FALLBACK: Readonly<Record<PushTextKey, string>> = {
	'settings.reminders.notify.due.title': 'Time to study',
	'settings.reminders.notify.due.body': '{count, plural, one {# card is due.} other {# cards are due.}}',
	'settings.reminders.notify.goal.title': 'Your daily goal',
	'settings.reminders.notify.goal.body': "Today's goal is still open.",
	'settings.reminders.notify.streak.title': 'Keep your streak',
	'settings.reminders.notify.streak.body':
		'{count, plural, one {# day in a row. Study today to keep it.} other {# days in a row. Study today to keep it.}}',
	'settings.reminders.notify.test.title': 'Test reminder',
	'settings.reminders.notify.test.body': 'Reminders work on this device.',
	'settings.reminders.notify.generic.title': 'qinqin',
	'settings.reminders.notify.generic.body': 'Open qinqin to see what is waiting.'
};

/** pushTextsOf: the map the page stores, from its own catalogue (`raw` is i18n rawMessage). */
export function pushTextsOf(raw: (key: PushTextKey) => string, locale: string): PushTexts {
	const messages: PushTexts['messages'] = {};
	for (const key of PUSH_TEXT_KEYS) messages[key] = raw(key);
	return { locale, messages };
}

export async function writePushTexts(caches: CacheStorageLike, texts: PushTexts): Promise<void> {
	const cache = await caches.open(PUSH_TEXTS_CACHE);
	await cache.put(PUSH_TEXTS_URL, new Response(JSON.stringify(texts), { headers: { 'content-type': 'application/json' } }));
}

export async function clearPushTexts(caches: CacheStorageLike): Promise<void> {
	await caches.delete(PUSH_TEXTS_CACHE);
}

/** readPushTexts: the stored map, or null when there is none or it is unreadable. Never throws. */
export async function readPushTexts(caches: CacheStorageLike): Promise<PushTexts | null> {
	try {
		const hit = await (await caches.open(PUSH_TEXTS_CACHE)).match(PUSH_TEXTS_URL);
		if (hit === undefined) return null;
		const raw = (await hit.json()) as unknown;
		if (typeof raw !== 'object' || raw === null) return null;
		const { locale, messages } = raw as { locale?: unknown; messages?: unknown };
		if (typeof locale !== 'string' || typeof messages !== 'object' || messages === null) return null;
		return { locale, messages: messages as PushTexts['messages'] };
	} catch {
		return null;
	}
}

/** pushText: the formatted text of `key`: the stored message, else the English fallback; a bad message falls back too. */
export function pushText(key: PushTextKey, texts: PushTexts | null, count: number | null): string {
	const args = { count: count ?? 0 };
	const own = texts?.messages[key];
	if (typeof own === 'string') {
		try {
			return formatMessage(own, texts?.locale ?? 'en', args);
		} catch {
			// A message this worker cannot format: English below.
		}
	}
	return formatMessage(ENGLISH_FALLBACK[key], 'en', args);
}
