// The flashcards plugin's manifest: the identity the web build ships
// with. Feature plugins are admin-installed server-side; this manifest
// lets the app render the plugin's widgets without asking the server
// for them.
import flashcards from '$builtin/flashcards.json';
import type { ContractManifest } from '$lib/plugins/contract';
import type { PluginManifest } from '$lib/plugins';
import { t } from '$lib/i18n';
import FlashcardsWidget from './FlashcardsWidget.svelte';
import WordStatesHome from '$lib/widgets/WordStatesHome.svelte';
import WordStatesWidget from '$lib/widgets/WordStatesWidget.svelte';

export const flashcardsManifest: PluginManifest = {
	...(flashcards as unknown as ContractManifest),
	widgets: [
		{
			id: 'flashcards-summary',
			get title() {
				return t('flashcards.widget.title');
			},
			get description() {
				return t('flashcards.widget.description');
			},
			owner: 'qinqin-flashcards',
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
			owner: 'qinqin-flashcards',
			size: 'normal',
			surfaces: ['stats', 'home'],
			component: WordStatesWidget,
			homeComponent: WordStatesHome
		}
	]
};
