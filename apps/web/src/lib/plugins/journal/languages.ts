// The languages the AI may explain in; the same list as the server's
// journal.ExplanationLanguages (an unknown stored value reads as English).
export const EXPLANATION_LANGUAGES: { code: string; label: string }[] = [
	{ code: 'en', label: 'English' },
	{ code: 'de', label: 'German' },
	{ code: 'fr', label: 'French' },
	{ code: 'es', label: 'Spanish' },
	{ code: 'it', label: 'Italian' },
	{ code: 'pt', label: 'Portuguese' },
	{ code: 'nl', label: 'Dutch' },
	{ code: 'ru', label: 'Russian' },
	{ code: 'ja', label: 'Japanese' },
	{ code: 'zh-Hans', label: 'Chinese (Simplified)' },
	{ code: 'zh-Hant', label: 'Chinese (Traditional)' },
	{ code: 'ko', label: 'Korean' }
];
