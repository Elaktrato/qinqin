// The languages the AI may explain in; the same list as the server's
// journal.ExplanationLanguages (an unknown stored value reads as English).
// Labels are the languages' names in the interface language ("Chinese (Simplified)").
import { languageName } from '$lib/i18n/format';

function language(code: string): { code: string; readonly label: string } {
	return {
		code,
		get label() {
			return languageName(code, undefined, 'standard');
		}
	};
}

export const EXPLANATION_LANGUAGES: { code: string; readonly label: string }[] = [
	'en',
	'de',
	'fr',
	'es',
	'it',
	'pt',
	'nl',
	'ru',
	'ja',
	'zh-Hans',
	'zh-Hant',
	'ko'
].map(language);
