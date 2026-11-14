// The flashcards plugin's manifest: the identity the web build ships
// with. Feature plugins are admin-installed server-side; this manifest
// lets the app render the plugin's widgets without asking the server
// for them.
import type { PluginManifest } from '../index';
import FlashcardsWidget from './FlashcardsWidget.svelte';
import WordStatesHome from '$lib/widgets/WordStatesHome.svelte';
import WordStatesWidget from '$lib/widgets/WordStatesWidget.svelte';

export const flashcardsManifest: PluginManifest = {
	id: 'qinqin-flashcards',
	name: 'Flashcards',
	version: '1.0',
	surfaces: ['home-widget'],
	widgets: [
		{
			id: 'flashcards-summary',
			title: 'Flashcards',
			description: 'Cards due and new, level and XP, streak and the study buddy.',
			owner: 'qinqin-flashcards',
			size: 'normal',
			surfaces: ['stats', 'home'],
			component: FlashcardsWidget
		},
		{
			id: 'word-states',
			title: 'Words',
			description: 'Words new, learning, young and mature, overall and per deck.',
			owner: 'qinqin-flashcards',
			size: 'normal',
			surfaces: ['stats', 'home'],
			component: WordStatesWidget,
			homeComponent: WordStatesHome
		}
	]
};
