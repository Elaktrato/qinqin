// The conjugation trainer's form families (#178; docs/contracts/conjugation/families.json, settings.json): which
// families a Japanese workspace practises, the workspace-settings key `conjugation: {families: {<family>: boolean}}`.
// Each family alone: a boolean, else its default (the beginner families on, the later ones off). Written one family
// at a time by merge patch.

/** The workspace-settings key (docs/contracts/settings/README.md). */
export const CONJUGATION_SETTINGS_KEY = 'conjugation';

export const CONJUGATION_FAMILIES = [
	'polite',
	'polite-past',
	'negative',
	'past',
	'te-form',
	'potential',
	'volitional',
	'conditional',
	'passive',
	'causative'
] as const;
export type ConjugationFamily = (typeof CONJUGATION_FAMILIES)[number];

/** A family's forms in question order (the server's form ids). */
export const FAMILY_FORMS: Readonly<Record<ConjugationFamily, readonly string[]>> = {
	polite: ['polite', 'polite-negative', 'polite-volitional'],
	'polite-past': ['polite-past', 'polite-past-negative'],
	negative: ['negative'],
	past: ['past', 'past-negative'],
	'te-form': ['te'],
	potential: ['potential'],
	volitional: ['volitional'],
	conditional: ['conditional-ba', 'conditional-tara'],
	passive: ['passive'],
	causative: ['causative']
};

/** On by default: the beginner families. */
export const DEFAULT_CONJUGATION_FAMILIES: readonly ConjugationFamily[] = ['polite', 'polite-past', 'negative', 'past', 'te-form'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isConjugationFamily(id: unknown): id is ConjugationFamily {
	return typeof id === 'string' && (CONJUGATION_FAMILIES as readonly string[]).includes(id);
}

/** enabledFamilies: the families switched on in a workspace's settings, in family order. */
export function enabledFamilies(settings: Record<string, unknown> | null | undefined): ConjugationFamily[] {
	const stored = settings?.[CONJUGATION_SETTINGS_KEY];
	const families = isObject(stored) && isObject(stored.families) ? stored.families : {};
	return CONJUGATION_FAMILIES.filter((f) => {
		const value = families[f];
		return typeof value === 'boolean' ? value : DEFAULT_CONJUGATION_FAMILIES.includes(f);
	});
}

/** conjugationFamilyPatch: the merge patch that switches one family (`PUT /api/workspaces/{id}` `{settings: patch}`). */
export function conjugationFamilyPatch(family: ConjugationFamily, on: boolean): Record<string, unknown> {
	return { [CONJUGATION_SETTINGS_KEY]: { families: { [family]: on } } };
}

/** hasConjugationSettings: the drill is Japanese, so Settings shows the switches in Japanese workspaces only. */
export function hasConjugationSettings(language: string): boolean {
	return language === 'ja';
}
