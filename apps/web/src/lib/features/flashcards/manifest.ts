// The flashcards feature's widgets (lib/features).
import type { FeatureDef } from '$lib/features';
import { t } from '$lib/i18n';
import FlashcardsWidget from './FlashcardsWidget.svelte';
import WordStatesHome from '$lib/widgets/WordStatesHome.svelte';
import WordStatesWidget from '$lib/widgets/WordStatesWidget.svelte';

export const flashcardsDef: FeatureDef = {
	widgets: [
		{
			id: 'flashcards-summary',
			get title() {
				return t('flashcards.widget.title');
			},
			get description() {
				return t('flashcards.widget.description');
			},
			owner: 'flashcards',
			size: 'normal',
			surfaces: ['stats', 'home'],
			component: FlashcardsWidget
		},
		{
			id: 'word-states',
			get title() {
				return t('flashcards.widget.wordsTitle');
			},
			get description() {
				return t('flashcards.widget.wordsDescription');
			},
			owner: 'flashcards',
			// A Stats widget too: it hides with Stats switched off (#295).
			requires: ['stats'],
			size: 'normal',
			surfaces: ['stats', 'home'],
			component: WordStatesWidget,
			homeComponent: WordStatesHome
		}
	]
};
