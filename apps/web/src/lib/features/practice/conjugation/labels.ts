// The names of the conjugation forms and families (catalogue keys, literal so the catalogue lint sees each one).

import { t, type MessageKey } from '$lib/i18n';

const FORM_KEYS: Readonly<Record<string, MessageKey>> = {
	polite: 'practice.conjugation.form.polite',
	'polite-negative': 'practice.conjugation.form.politeNegative',
	'polite-volitional': 'practice.conjugation.form.politeVolitional',
	'polite-past': 'practice.conjugation.form.politePast',
	'polite-past-negative': 'practice.conjugation.form.politePastNegative',
	negative: 'practice.conjugation.form.negative',
	past: 'practice.conjugation.form.past',
	'past-negative': 'practice.conjugation.form.pastNegative',
	te: 'practice.conjugation.form.te',
	potential: 'practice.conjugation.form.potential',
	volitional: 'practice.conjugation.form.volitional',
	'conditional-ba': 'practice.conjugation.form.conditionalBa',
	'conditional-tara': 'practice.conjugation.form.conditionalTara',
	passive: 'practice.conjugation.form.passive',
	causative: 'practice.conjugation.form.causative'
};

const FAMILY_KEYS: Readonly<Record<string, MessageKey>> = {
	polite: 'practice.conjugation.family.polite',
	'polite-past': 'practice.conjugation.family.politePast',
	negative: 'practice.conjugation.family.negative',
	past: 'practice.conjugation.family.past',
	'te-form': 'practice.conjugation.family.teForm',
	potential: 'practice.conjugation.family.potential',
	volitional: 'practice.conjugation.family.volitional',
	conditional: 'practice.conjugation.family.conditional',
	passive: 'practice.conjugation.family.passive',
	causative: 'practice.conjugation.family.causative'
};

/** formLabel: a form's name ("plain past (〜た / 〜だった)"); an unknown id as itself. */
export function formLabel(form: string): string {
	const key = FORM_KEYS[form];
	return key === undefined ? form : t(key);
}

/** familyLabel: a family's name (Settings, the round's summary). */
export function familyLabel(family: string): string {
	const key = FAMILY_KEYS[family];
	return key === undefined ? family : t(key);
}
