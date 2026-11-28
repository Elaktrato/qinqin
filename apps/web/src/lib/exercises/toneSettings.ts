// Tone sandhi settings (#300, #180; docs/contracts/settings/tones.json): the workspace-settings key
// `tones: {showSandhi, gradeSpoken}`. "Show tone sandhi" (on by default) shows the spoken tones beside the citation
// tones on an answer; off, sandhi is never shown. "Grade spoken tones" (off by default) grades the spoken tones
// instead of accepting citation or spoken. The rules they steer: ./toneSandhi.ts and `toneVerdict` (./tones.ts).

import { profileOf } from '$lib/languages/profiles';

/** The workspace-settings key (docs/contracts/settings/workspace-settings.json). */
export const TONE_SETTINGS_KEY = 'tones';

export const TONE_SETTINGS_MEMBERS = ['showSandhi', 'gradeSpoken'] as const;
export type ToneSettingMember = (typeof TONE_SETTINGS_MEMBERS)[number];
export type ToneSettings = Record<ToneSettingMember, boolean>;

export const TONE_SETTINGS_DEFAULTS: Readonly<ToneSettings> = { showSandhi: true, gradeSpoken: false };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** readToneSettings reads `settings.tones`: each member alone, anything but a boolean is its default. */
export function readToneSettings(settings: Record<string, unknown> | null | undefined): ToneSettings {
	const stored = settings?.[TONE_SETTINGS_KEY];
	const root = isObject(stored) ? stored : {};
	const out = { ...TONE_SETTINGS_DEFAULTS };
	for (const member of TONE_SETTINGS_MEMBERS) {
		const value = root[member];
		if (typeof value === 'boolean') out[member] = value;
	}
	return out;
}

/** toneSettingPatch: the merge patch that changes one member (`PUT /api/workspaces/{id}` `{settings: patch}`). */
export function toneSettingPatch(member: ToneSettingMember, value: boolean): Record<string, unknown> {
	return { [TONE_SETTINGS_KEY]: { [member]: value } };
}

/** hasToneSettings: the language has tones (its profile), so Settings shows the switches. */
export function hasToneSettings(language: string): boolean {
	return profileOf(language).tones;
}
