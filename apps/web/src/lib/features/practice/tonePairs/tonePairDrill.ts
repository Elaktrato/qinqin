// The tone-pair drill (#180, drill id `tone-pairs`; docs/contracts/tones/pairs.json): the 20 Mandarin two-syllable
// tone patterns, each practised with real words from the learner's decks and the HSK word list; mark both tones by
// typing them or with the tone buttons. Items are the citation pairs (`3-4`); the grid on the Practice list shows each
// pair's accuracy.

import { t } from '$lib/i18n';
import { hasToneSettings } from '$lib/exercises/toneSettings';
import type { DrillDef } from '../types';
import TonePairGrid from './TonePairGrid.svelte';
import TonePairQuestion from './TonePairQuestion.svelte';
import { loadPairItems, TONE_PAIRS_DRILL, type PairItemData } from './words';

export const tonePairDrill: DrillDef = {
	id: TONE_PAIRS_DRILL,
	get title() {
		return t('practice.tonePairs.title');
	},
	get description() {
		return t('practice.tonePairs.description');
	},
	// The languages with tones (zh, zh-Hant), as the tone settings: the sandhi rules are Mandarin's.
	appliesTo: (language) => hasToneSettings(language),
	items: ({ session, workspace, history }) => loadPairItems(session, workspace.language, history.cards, history.drillAnswers ?? []),
	// The word asked and its pair by tone numbers (characters are no reading).
	label: (item) => {
		const data = item.data as PairItemData | undefined;
		const word = data?.words[data.next];
		return word === undefined ? item.key : t('practice.tonePairs.label', { word: word.written, pair: item.key });
	},
	question: TonePairQuestion,
	overview: TonePairGrid
};
