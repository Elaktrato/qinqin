// The person's appearance: the user-global plugin data row `qinqin-core` /
// `appearance` (docs/contracts/themes/README.md, "The appearance row";
// fixtures in docs/contracts/themes/appearance.json). Pure: parse a stored
// value, resolve which theme and accent are painted, write a change while
// keeping every member this client does not know.

export const APPEARANCE_KEY = 'appearance';
const VERSION = 1;

export const MODES = ['system', 'light', 'dark'] as const;
export type Mode = (typeof MODES)[number];
export const SLOTS = ['light', 'dark'] as const;
export type Slot = (typeof SLOTS)[number];
export const CORNERS = ['sharp', 'soft', 'round'] as const;
export type Corners = (typeof CORNERS)[number];
export const SPACINGS = ['compact', 'comfortable'] as const;
export type Spacing = (typeof SPACINGS)[number];
export const HANZI_FONTS = ['sans', 'serif', 'kai'] as const;
export type HanziFont = (typeof HANZI_FONTS)[number];

export interface SlotChoice {
	theme: string;
	/** An accent key, or null: the theme's own choice (its default accent). */
	accent: string | null;
}

export interface Appearance {
	mode: Mode;
	light: SlotChoice;
	dark: SlotChoice;
	corners: Corners;
	spacing: Spacing;
	hanziFont: HanziFont;
}

export interface AppearanceChange {
	mode?: Mode;
	light?: Partial<SlotChoice>;
	dark?: Partial<SlotChoice>;
	corners?: Corners;
	spacing?: Spacing;
	hanziFont?: HanziFont;
}

/** What resolve needs of an installed theme (accentChoices from derive.ts). */
export interface ResolvableTheme {
	id: string;
	scheme?: string;
	defaultAccent: string;
	accentChoices: readonly string[];
}

export interface Resolved {
	slot: Slot;
	theme: string;
	accent: string;
}

export const DEFAULT_APPEARANCE: Readonly<Appearance> = Object.freeze({
	mode: 'system',
	light: Object.freeze({ theme: 'qinqin-day', accent: 'azure' }),
	dark: Object.freeze({ theme: 'qinqin-night', accent: 'cyan' }),
	corners: 'soft',
	spacing: 'comfortable',
	hanziFont: 'sans'
}) as Readonly<Appearance>;

/** The person's adjustments: corner radius in px, the spacing factor, the hanzi font choices. */
export const ADJUSTMENTS = {
	corners: { sharp: 4, soft: 10, round: 16 },
	spacing: { compact: 0.75, comfortable: 1 },
	hanziFont: [...HANZI_FONTS]
} as const;

const THEME_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ACCENT_KEY = /^[a-z][a-z0-9-]{0,31}$/;

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
	return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** isThemeId: the theme id grammar of theme-file.json (≤ 64 bytes). */
export function isThemeId(v: unknown): v is string {
	return typeof v === 'string' && v.length <= 64 && THEME_ID.test(v);
}

export function isAccentKey(v: unknown): v is string {
	return typeof v === 'string' && ACCENT_KEY.test(v);
}

function parseSlot(v: unknown, fallback: SlotChoice): SlotChoice {
	if (!isObject(v)) return { ...fallback };
	return {
		theme: isThemeId(v.theme) ? v.theme : fallback.theme,
		accent: isAccentKey(v.accent) ? v.accent : null
	};
}

function isRow(v: unknown): v is Record<string, unknown> {
	return isObject(v) && typeof v.version === 'number' && Number.isInteger(v.version) && v.version >= VERSION;
}

function defaults(): Appearance {
	return {
		...DEFAULT_APPEARANCE,
		light: { ...DEFAULT_APPEARANCE.light },
		dark: { ...DEFAULT_APPEARANCE.dark }
	};
}

/**
 * parseAppearance reads a stored value (null = no row). Not an object, or no
 * integer version ≥ 1: the defaults. Each member falls back on its own; a
 * newer version is read leniently.
 */
export function parseAppearance(value: unknown): Appearance {
	if (!isRow(value)) return defaults();
	const d = DEFAULT_APPEARANCE;
	return {
		mode: oneOf(MODES, value.mode, d.mode),
		light: parseSlot(value.light, d.light),
		dark: parseSlot(value.dark, d.dark),
		corners: oneOf(CORNERS, value.corners, d.corners),
		spacing: oneOf(SPACINGS, value.spacing, d.spacing),
		hanziFont: oneOf(HANZI_FONTS, value.hanziFont, d.hanziFont)
	};
}

/** slotFor: the slot a mode paints (system follows the device). */
export function slotFor(mode: Mode, prefersDark: boolean): Slot {
	if (mode === 'system') return prefersDark ? 'dark' : 'light';
	return mode;
}

/**
 * resolveAppearance: the slot, theme and accent painted. A theme that is not
 * installed (a removed pack) falls back to the slot's default theme (or, if
 * even that is missing, the first installed theme of the slot's scheme); the
 * stored accent is tried on whichever theme is painted, else its default.
 */
export function resolveAppearance(
	a: Appearance,
	themes: readonly ResolvableTheme[],
	prefersDark: boolean
): Resolved {
	const slot = slotFor(a.mode, prefersDark);
	const choice = a[slot];
	const fallbackId = DEFAULT_APPEARANCE[slot].theme;
	const theme =
		themes.find((th) => th.id === choice.theme) ??
		themes.find((th) => th.id === fallbackId) ??
		themes.find((th) => th.scheme === slot);
	if (!theme) {
		return { slot, theme: fallbackId, accent: choice.accent ?? DEFAULT_APPEARANCE[slot].accent ?? 'mauve' };
	}
	const accent =
		choice.accent !== null && theme.accentChoices.includes(choice.accent) ? choice.accent : theme.defaultAccent;
	return { slot, theme: theme.id, accent };
}

/**
 * writeAppearance: the value to PUT for a change. Starts from the stored
 * row when it is one (unknown top-level and slot members kept), else the
 * defaults; sets the changed members and `version: 1`. Never mutates
 * `stored`.
 */
export function writeAppearance(stored: unknown, change: AppearanceChange): Record<string, unknown> {
	// A JSON copy: the stored value is JSON (and may be a reactive proxy).
	const base = JSON.parse(JSON.stringify(isRow(stored) ? stored : defaults())) as Record<string, unknown>;
	base.version = VERSION;
	for (const key of ['mode', 'corners', 'spacing', 'hanziFont'] as const) {
		if (change[key] !== undefined) base[key] = change[key];
	}
	for (const slot of SLOTS) {
		const c = change[slot];
		if (c === undefined) continue;
		const prev = isObject(base[slot]) ? (base[slot] as Record<string, unknown>) : { ...DEFAULT_APPEARANCE[slot] };
		base[slot] = { ...prev, ...c };
	}
	return base;
}
