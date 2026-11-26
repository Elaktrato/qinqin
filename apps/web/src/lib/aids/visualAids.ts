// Visual aids (#212): pictures, tone colours and character anatomy, each switched on or off per workspace
// (workspace settings key `visualAids`; docs/contracts/aids/). Defaults: all three on - a picture only shows
// where an installed images pack has one, anatomy only where a components pack has the character.

export const AID_KEYS = ['pictures', 'toneColors', 'toneContour', 'anatomy'] as const;
export type AidKey = (typeof AID_KEYS)[number];
export type VisualAids = Record<AidKey, boolean>;

/** The workspace-settings key (docs/contracts/settings/workspace-settings.json). */
export const VISUAL_AIDS_KEY = 'visualAids';

export const AID_DEFAULTS: Readonly<VisualAids> = { pictures: true, toneColors: true, toneContour: true, anatomy: true };

/** Every aid off: what a component outside a signed-in session sees. */
export const NO_AIDS: Readonly<VisualAids> = { pictures: false, toneColors: false, toneContour: false, anatomy: false };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * readVisualAids reads `settings.visualAids`: a switch that is absent or not a boolean is its default. Migration:
 * colours and contour used to be one switch (`toneColors`), so a stored `toneColors: false` without a stored
 * `toneContour` keeps the contour off too; the learner who turned tone marks off does not see a new one appear.
 */
export function readVisualAids(settings: Record<string, unknown> | null | undefined): VisualAids {
	const stored = settings?.[VISUAL_AIDS_KEY];
	const root = isObject(stored) ? stored : {};
	const out = { ...AID_DEFAULTS };
	for (const key of AID_KEYS) {
		const value = root[key];
		if (typeof value === 'boolean') out[key] = value;
	}
	if (typeof root.toneContour !== 'boolean' && root.toneColors === false) out.toneContour = false;
	return out;
}

/** visualAidPatch: the merge patch (settings contract) that sets one switch. */
export function visualAidPatch(key: AidKey, on: boolean): Record<string, unknown> {
	return { [VISUAL_AIDS_KEY]: { [key]: on } };
}
