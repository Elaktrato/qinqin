// FSRS parameter sets: validation, the stored row shapes and Anki's
// comma-separated weight string. Weights are valid only when they pass
// ts-fsrs's own check and sit inside its clamp ranges; out-of-range
// values are rejected, never silently clipped (migrateParameters clips).

import { CLAMP_PARAMETERS, checkParameters, default_w, migrateParameters } from 'ts-fsrs';
import { t } from '$lib/i18n';

export const DEFAULT_W: readonly number[] = default_w;

export const SET_PREFIX = 'fsrs:set:';
export const ACTIVE_KEY = 'fsrs:active';

export interface ParamSet {
	id: string;
	w: number[];
	createdAt: string;
	source: 'optimized' | 'imported';
	labelled?: number;
	logLoss?: number;
	baselineLogLoss?: number;
}

export interface FsrsState {
	sets: ParamSet[];
	active: ParamSet | null;
	w: readonly number[];
	/** The set id `fsrs:active` names, even when that set cannot be read. */
	pointer?: string | null;
}

type Checked = { ok: true; w: number[] } | { ok: false; error: string };

/**
 * checkWeights validates 17, 19 or 21 raw numbers. The raw values are
 * compared with the clamp ranges, so a value that migrateParameters
 * would clip is reported with its 1-based position instead.
 */
export function checkWeights(raw: unknown): Checked {
	if (!Array.isArray(raw)) return { ok: false, error: t('study.fsrs.notNumbers') };
	if (!raw.every((x) => typeof x === 'number')) {
		return { ok: false, error: t('study.fsrs.notNumbers') };
	}
	const w = raw as number[];
	try {
		checkParameters(w);
	} catch {
		const bad = w.findIndex((x) => !Number.isFinite(x));
		if (bad >= 0) return { ok: false, error: t('study.fsrs.notFinite', { n: bad + 1 }) };
		return { ok: false, error: t('study.fsrs.wrongCount', { count: w.length }) };
	}
	const ranges = CLAMP_PARAMETERS(2, true);
	for (let i = 0; i < w.length; i++) {
		const [min, max] = ranges[i];
		if (w[i] < min || w[i] > max) {
			return { ok: false, error: t('study.fsrs.outside', { n: i + 1, min, max }) };
		}
	}
	return { ok: true, w: [...w] };
}

/** validWeights returns the 21 migrated weights, or null when invalid. */
export function validWeights(raw: unknown): number[] | null {
	const checked = checkWeights(raw);
	if (!checked.ok) return null;
	const migrated = migrateParameters(checked.w);
	return migrated.length === 21 ? migrated : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | undefined | null {
	if (value === undefined) return undefined;
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** parseParamSet reads one `fsrs:set:<id>` row; anything off gives null. */
export function parseParamSet(key: string, raw: unknown): ParamSet | null {
	if (!isRecord(raw)) return null;
	const { id, w, createdAt, source } = raw;
	if (typeof id !== 'string' || typeof createdAt !== 'string') return null;
	if (key !== SET_PREFIX + id) return null;
	if (source !== 'optimized' && source !== 'imported') return null;
	if (!Array.isArray(w) || w.length !== 21) return null;
	const valid = validWeights(w);
	if (valid === null) return null;
	const set: ParamSet = { id, w: valid, createdAt, source };
	for (const field of ['labelled', 'logLoss', 'baselineLogLoss'] as const) {
		const value = optionalNumber(raw[field]);
		if (value === null) return null;
		if (value !== undefined) set[field] = value;
	}
	return set;
}

function newestFirst(a: ParamSet, b: ParamSet): number {
	if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * resolveState picks the active set from the `fsrs:active` pointer. A
 * missing, null or dangling pointer means the defaults.
 */
export function resolveState(sets: ParamSet[], activeRaw: unknown): FsrsState {
	const sorted = [...sets].sort(newestFirst);
	const setId = isRecord(activeRaw) ? activeRaw.setId : null;
	const active = typeof setId === 'string' ? (sorted.find((s) => s.id === setId) ?? null) : null;
	return {
		sets: sorted,
		active,
		w: active === null ? DEFAULT_W : active.w,
		pointer: typeof setId === 'string' ? setId : null
	};
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** parseWeightString reads Anki's weight list: commas, spaces, newlines, brackets. */
export function parseWeightString(s: string): Checked {
	const tokens = s
		.replace(/[[\]()]/g, ' ')
		.split(/[\s,;]+/)
		.filter((t) => t !== '');
	if (tokens.length === 0 || !tokens.every((t) => NUMBER.test(t))) {
		return { ok: false, error: t('study.fsrs.notNumbers') };
	}
	const checked = checkWeights(tokens.map(Number));
	if (!checked.ok) return checked;
	const raw = checked.w;
	const migrated = migrateParameters(raw);
	const ranges = CLAMP_PARAMETERS(2, true);
	// ts-fsrs converts w4..w6 of a 17-number list on purpose; every other
	// typed weight must come back unchanged (migrateParameters clips silently).
	const converted = raw.length === 17 ? [4, 5, 6] : [];
	for (let i = 0; i < raw.length; i++) {
		if (converted.includes(i)) continue;
		if (migrated[i] !== raw[i]) {
			return { ok: false, error: t('study.fsrs.unreadable', { n: i + 1 }) };
		}
	}
	for (const i of converted) {
		const [min, max] = ranges[i];
		if (!(migrated[i] >= min && migrated[i] <= max)) {
			return {
				ok: false,
				error: t('study.fsrs.outsideConverted', { n: i + 1, min, max })
			};
		}
	}
	// The weights ts-fsrs fills in (w19 is 0, below the FSRS-6 range) were
	// not typed by the user: they are clipped into range so the set reads back.
	for (let i = raw.length; i < migrated.length; i++) {
		migrated[i] = Math.min(Math.max(migrated[i], ranges[i][0]), ranges[i][1]);
	}
	return { ok: true, w: migrated };
}

/** formatWeights writes the list as Anki shows it: four decimals. */
export function formatWeights(w: readonly number[]): string {
	return w.map((x) => x.toFixed(4)).join(', ');
}

/** weightsKey identifies a weight list, for caches. */
export function weightsKey(w: readonly number[]): string {
	return w.join(',');
}
