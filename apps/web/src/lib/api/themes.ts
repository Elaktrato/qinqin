// GET /api/themes (docs/contracts/themes/README.md): every installed theme
// with its colours and credits, built-in packs first. Public; the service
// worker keeps it per credential for offline starts. Each entry is checked
// (colours `#rrggbb`, accents non-empty, the default accent among them); a
// broken entry is dropped, never painted.

import { isAccentKey, isThemeId } from '$lib/theme/appearance';
import { COLOR_KEYS, type Theme } from '$lib/theme/types';
import { api } from './client';

export interface ListedTheme extends Theme {
	family: string;
	packId: string;
	builtin: boolean;
}

export interface ThemePack {
	packId: string;
	name: string;
	version: string;
	license: string;
	attribution: string;
	notice: string;
	/** The full licence text (built-in packs); "" when the answer has none. */
	licenseText: string;
	builtin: boolean;
	themes: string[];
}

export interface ThemesAnswer {
	themes: ListedTheme[];
	packs: ThemePack[];
}

const COLOR = /^#[0-9a-f]{6}$/;

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isColor(v: unknown): v is string {
	return typeof v === 'string' && COLOR.test(v);
}

function parseTheme(raw: unknown): ListedTheme | null {
	if (!isObject(raw)) return null;
	const { id, name, family, scheme, colors, accents, defaultAccent, packId, builtin } = raw;
	if (!isThemeId(id) || typeof name !== 'string' || name.trim() === '') return null;
	if (scheme !== 'light' && scheme !== 'dark') return null;
	if (!isObject(colors) || !COLOR_KEYS.every((k) => isColor(colors[k]))) return null;
	if (!isObject(accents)) return null;
	const entries = Object.entries(accents);
	if (entries.length === 0 || !entries.every(([k, v]) => isAccentKey(k) && isColor(v))) return null;
	if (typeof defaultAccent !== 'string' || !Object.hasOwn(accents, defaultAccent)) return null;
	const pickedColors = Object.fromEntries(COLOR_KEYS.map((k) => [k, colors[k] as string])) as Theme['colors'];
	return {
		id,
		name,
		family: typeof family === 'string' ? family : '',
		scheme,
		colors: pickedColors,
		accents: Object.fromEntries(entries) as Record<string, string>,
		defaultAccent,
		packId: typeof packId === 'string' ? packId : '',
		builtin: builtin === true
	};
}

function parsePack(raw: unknown): ThemePack | null {
	if (!isObject(raw)) return null;
	const { packId, name, version, license, attribution, notice, licenseText, builtin, themes } = raw;
	if (typeof packId !== 'string' || packId === '' || typeof name !== 'string') return null;
	if (!Array.isArray(themes) || !themes.every((t) => typeof t === 'string')) return null;
	const text = (v: unknown) => (typeof v === 'string' ? v : '');
	return {
		packId,
		name,
		version: text(version),
		license: text(license),
		attribution: text(attribution),
		notice: text(notice),
		licenseText: text(licenseText),
		builtin: builtin === true,
		themes: [...themes]
	};
}

/** parseThemesAnswer: the valid themes (first of each id) and packs of an answer. */
export function parseThemesAnswer(raw: unknown): ThemesAnswer {
	const out: ThemesAnswer = { themes: [], packs: [] };
	if (!isObject(raw)) return out;
	const seen = new Set<string>();
	for (const entry of Array.isArray(raw.themes) ? raw.themes : []) {
		const theme = parseTheme(entry);
		if (theme === null || seen.has(theme.id)) continue;
		seen.add(theme.id);
		out.themes.push(theme);
	}
	for (const entry of Array.isArray(raw.packs) ? raw.packs : []) {
		const pack = parsePack(entry);
		if (pack !== null) out.packs.push(pack);
	}
	return out;
}

/** getThemes: GET /api/themes, checked. Network and server errors reject. */
export async function getThemes(): Promise<ThemesAnswer> {
	return parseThemesAnswer(await api<unknown>('/api/themes'));
}
