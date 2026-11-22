// The phone navigation (#188, design 2026-11-22-phone-bottom-bar): the
// user-global plugin data row `qinqin-core` / `nav-layout`. `phone` is the
// phone frame's navigation (the bottom bar or the side menu), `bar` the
// sections pinned to the bottom bar, in order. Ids of sections that are not
// visible right now (switched off, a removed plugin) stay stored, so they
// come back when the section does. Unknown keys are never dropped and a
// newer version is kept on write; a write re-reads the row first, so keys
// another device wrote meanwhile survive.
// Contract: docs/contracts/settings/README.md, nav-layout.json.

import { moveWidgetTo } from '$lib/widgets/editor';
import { coreManifest } from '$lib/plugins/core/manifest';
import { createPluginSdk } from '$lib/plugins/sdk';

export const NAV_LAYOUT_KEY = 'nav-layout';
export const PHONE_MODES = ['bar', 'drawer'] as const;
export type PhoneMode = (typeof PHONE_MODES)[number];
/** The bar's pins when nothing is stored: Home (there is no logo to tap), Decks, Reader, Search. */
export const DEFAULT_BAR: readonly string[] = Object.freeze(['home', 'flashcards', 'reader', 'search']);
/** The five-item rule: at most five items; four pins and More when the sections do not fit. */
export const BAR_MAX_ITEMS = 5;

export interface NavLayout {
	phone: PhoneMode;
	/** The pinned section ids in order, each once (hidden and unknown ids included). */
	bar: string[];
}

export interface NavLayoutChange {
	phone?: PhoneMode;
	bar?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validVersion(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function isPhoneMode(value: unknown): value is PhoneMode {
	return typeof value === 'string' && (PHONE_MODES as readonly string[]).includes(value);
}

/** The ids of a list that count: non-empty strings, each once (the first wins). */
function cleanIds(list: readonly unknown[]): string[] {
	return [...new Set(list.filter((id): id is string => typeof id === 'string' && id !== ''))];
}

export function defaultNavLayout(): NavLayout {
	return { phone: 'bar', bar: [...DEFAULT_BAR] };
}

/**
 * parseNavLayout reads a stored value. No row, or a row that is not an
 * object with an integer `version` ≥ 1, is the defaults; a newer version is
 * read leniently. An unknown `phone` is the bar; a missing or non-list `bar`
 * is the default pins; an empty `bar` stays empty.
 */
export function parseNavLayout(value: unknown): NavLayout {
	if (!isRecord(value) || !validVersion(value.version)) return defaultNavLayout();
	return {
		phone: isPhoneMode(value.phone) ? value.phone : 'bar',
		bar: Array.isArray(value.bar) ? cleanIds(value.bar) : [...DEFAULT_BAR]
	};
}

/**
 * withNavLayout is the row to write: the stored object with only the
 * members in `change` replaced; every other key kept, `version` kept when it
 * is an integer ≥ 1 (else 1). A non-object row starts fresh. A member not in
 * `change` is not added (a missing bar keeps reading as the default pins).
 */
export function withNavLayout(stored: unknown, change: NavLayoutChange): Record<string, unknown> {
	const base = isRecord(stored) ? stored : {};
	const next: Record<string, unknown> = { ...base, version: validVersion(base.version) ? base.version : 1 };
	if (change.phone !== undefined) next.phone = change.phone;
	if (change.bar !== undefined) next.bar = cleanIds(change.bar);
	return next;
}

function store() {
	return createPluginSdk(coreManifest).data.user();
}

/** loadNavLayout reads the row (find: no 404 for a never-saved row). Errors reject. */
export async function loadNavLayout(): Promise<NavLayout> {
	return parseNavLayout(await store().find(NAV_LAYOUT_KEY));
}

/** saveNavLayout re-reads the row, applies the change, writes it and returns what now reads. */
export async function saveNavLayout(change: NavLayoutChange): Promise<NavLayout> {
	const data = store();
	const next = withNavLayout(await data.find(NAV_LAYOUT_KEY), change);
	await data.put(NAV_LAYOUT_KEY, next);
	return parseNavLayout(next);
}

// Editing the stored bar (Settings → Layout). Like the home widgets editor,
// these change the stored list, not only what is visible: a pin of a
// section switched off keeps its slot.

/** toggleInBar pins a section (at the end) or takes it out of the bar. */
export function toggleInBar(bar: readonly string[], id: string, on: boolean): string[] {
	const list = cleanIds(bar);
	if (on) return list.includes(id) ? list : [...list, id];
	return list.filter((other) => other !== id);
}

/** moveInBarTo moves a pin to `target` (0-based, clamped) among the visible pins. */
export function moveInBarTo(bar: readonly string[], id: string, target: number, visible: Iterable<string>): string[] {
	return moveWidgetTo(cleanIds(bar), id, target, visible);
}

/** moveInBar moves a pin one place up (-1) or down (1) among the visible pins; a no-op at the ends. */
export function moveInBar(bar: readonly string[], id: string, direction: -1 | 1, visible: Iterable<string>): string[] {
	const shown = new Set(visible);
	const order = cleanIds(bar).filter((other) => shown.has(other));
	const from = order.indexOf(id);
	const to = from + direction;
	if (from < 0 || to < 0 || to >= order.length) return cleanIds(bar);
	return moveInBarTo(bar, id, to, shown);
}
