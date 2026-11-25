// The writing-system trainer (/scripts, #204): its stats and home widget and the credit of its script data.
import type { FeatureDef } from '$lib/features';
import { t } from '$lib/i18n';
import { writingSystemsOf } from '$lib/languages/profiles';
import ScriptsWidget from './ScriptsWidget.svelte';

export const scriptsDef: FeatureDef = {
	widgets: [
		{
			id: 'scripts-progress',
			get title() {
				return t('scripts.widget.title');
			},
			get description() {
				return t('scripts.widget.description');
			},
			owner: 'scripts',
			size: 'normal',
			// Only where the language profile has a writing system to teach.
			appliesTo: (language: string) => writingSystemsOf(language).length > 0,
			surfaces: ['stats', 'home'],
			component: ScriptsWidget
		}
	],
	sources: [
		{
			name: 'qinqin script charts',
			url: 'https://github.com/Elaktrato/qinqin',
			license: 'CC0 1.0',
			attribution: 'qinqin contributors',
			get notice() {
				return t('scripts.credit.notice');
			}
		}
	]
};
