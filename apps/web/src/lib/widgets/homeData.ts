// Home's own setup, held for the session (#290): the stored layout and the
// widget options are read once, answered from memory on the next visit and
// refreshed behind it; a save on this device updates the held copy. A device
// copy per user (localStorage `qinqin.home.v1.<user>`) gives a warm start
// after a reload or in the Android app; it is only ever read for its own user
// and is removed at sign-out (context/session.svelte.ts). An answer that lands
// after the session ended is not kept (record 0009).

import type { Session } from '$lib/context/session.svelte';
import { loadLayout, parseLayout, serializeLayout } from './layout';
import { loadWidgetOptions, parseWidgetOptions, withHeatmapLayout, type HeatmapLayout, type WidgetOptions } from './options';

export const HOME_COPY_PREFIX = 'qinqin.home.v1.';

interface DeviceCopy {
	layout?: unknown;
	options?: unknown;
}

function copyKey(session: Session): string | null {
	return session.user === null ? null : `${HOME_COPY_PREFIX}${session.user}`;
}

function readCopy(session: Session): DeviceCopy | null {
	const key = copyKey(session);
	if (key === null) return null;
	try {
		const raw = session.deps.local()?.getItem(key);
		const parsed: unknown = raw == null ? null : JSON.parse(raw);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as DeviceCopy) : null;
	} catch {
		return null;
	}
}

function writeCopy(session: Session, change: DeviceCopy): void {
	const key = copyKey(session);
	if (key === null || !session.alive) return;
	try {
		session.deps.local()?.setItem(key, JSON.stringify({ ...readCopy(session), ...change }));
	} catch {
		// Storage full or denied: the session's copy still holds it.
	}
}

/** heldLayout: the layout this session (or this user's device copy) holds, or null when none was read yet. */
export function heldLayout(session: Session): { ids: string[] | null } | null {
	const home = session.caches.home;
	if (home.layout === null) {
		const copy = readCopy(session);
		// The copy stores the row as written (null: no stored layout, the default).
		if (copy !== null && 'layout' in copy) home.layout = { ids: copy.layout === null ? null : parseLayout(copy.layout) };
	}
	return home.layout;
}

/** heldOptions: the widget options this session (or this user's device copy) holds, or null. */
export function heldOptions(session: Session): WidgetOptions | null {
	const home = session.caches.home;
	if (home.options === null) {
		const copy = readCopy(session);
		if (copy !== null && 'options' in copy) home.options = parseWidgetOptions(copy.options);
	}
	return home.options;
}

/** refreshLayout reads the stored layout and holds it. Errors reject and keep what is held. */
export async function refreshLayout(session: Session): Promise<string[] | null> {
	const ids = await loadLayout();
	rememberLayout(session, ids);
	return ids;
}

/** refreshOptions reads the widget options and holds them. Errors reject and keep what is held. */
export async function refreshOptions(session: Session): Promise<WidgetOptions> {
	const options = await loadWidgetOptions();
	if (session.alive) {
		session.caches.home.options = options;
		writeCopy(session, { options: options.row });
	}
	return options;
}

/** rememberLayout holds a layout this device saved (or read): null is the default. */
export function rememberLayout(session: Session, ids: readonly string[] | null): void {
	if (!session.alive) return;
	session.caches.home.layout = { ids: ids === null ? null : [...ids] };
	writeCopy(session, { layout: ids === null ? null : serializeLayout(ids) });
}

/** rememberHeatmapLayout holds the heatmap layout this device saved. */
export function rememberHeatmapLayout(session: Session, layout: HeatmapLayout): void {
	if (!session.alive) return;
	const row = withHeatmapLayout(heldOptions(session)?.row ?? null, layout);
	session.caches.home.options = parseWidgetOptions(row);
	writeCopy(session, { options: row });
}

/** forgetHomeCopies removes every device copy (the sign-out). */
export function forgetHomeCopies(storage: Storage | null): void {
	if (storage === null) return;
	try {
		const keys: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (key?.startsWith(HOME_COPY_PREFIX)) keys.push(key);
		}
		for (const key of keys) storage.removeItem(key);
	} catch {
		// Nothing to remove.
	}
}
