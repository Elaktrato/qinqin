// The measure-word and counter drills (#179; docs/contracts/counters/): Chinese measure words (一＿书 → 本, from
// CC-CEDICT's CL notes as the server corrects them), Japanese counters (紙 → 枚, the project's counters table) and the
// readings of number + counter with their sound changes (3本 → さんぼん). Items: the noun's entry id, or
// `<counterId>:<number>`. The server derives the data (POST /api/drills/measure-words/words, GET /api/drills/counters).

import { t } from '$lib/i18n';
import { hasToneSettings } from '$lib/exercises/toneSettings';
import type { DrillDef, DrillItem } from '../types';
import MeasureQuestion from './MeasureQuestion.svelte';
import ReadingQuestion from './ReadingQuestion.svelte';
import { COUNTERS_DRILL, MEASURE_WORDS_DRILL, READINGS_DRILL, studiedNounIds } from './items';
import { nounItems, type NounItemData } from './nounItems';
import { readingItems, type ReadingItemData } from './readingItems';
import { loadCounterNouns, loadCounterReadings } from './words';

const isJapanese = (language: string) => language === 'ja';
const nounLabel = (item: DrillItem) => {
	const data = item.data as NounItemData | undefined;
	return data === undefined ? item.key : `${data.noun.written} · ${data.noun.measures[0].written}`;
};

export const measureWordsDrill: DrillDef = {
	id: MEASURE_WORDS_DRILL,
	get title() {
		return t('practice.measureWords.title');
	},
	get description() {
		return t('practice.measureWords.description');
	},
	// The Chinese languages (zh, zh-Hant): the languages with tones, as the tone settings.
	appliesTo: (language) => hasToneSettings(language),
	items: async ({ session, history }): Promise<DrillItem[]> => {
		// CC-CEDICT keeps a one-hanzi word (书) as a character entry: character cards count.
		const ids = studiedNounIds(history, true);
		if (ids.length === 0) return [];
		return nounItems(ids, await loadCounterNouns(session.deps.api, ids), hasToneSettings);
	},
	label: nounLabel,
	question: MeasureQuestion
};

export const countersDrill: DrillDef = {
	id: COUNTERS_DRILL,
	get title() {
		return t('practice.counters.title');
	},
	get description() {
		return t('practice.counters.description');
	},
	appliesTo: isJapanese,
	items: async ({ session, history }): Promise<DrillItem[]> => {
		const ids = studiedNounIds(history, false);
		if (ids.length === 0) return [];
		return nounItems(ids, await loadCounterNouns(session.deps.api, ids), isJapanese);
	},
	label: nounLabel,
	question: MeasureQuestion
};

export const counterReadingsDrill: DrillDef = {
	id: READINGS_DRILL,
	get title() {
		return t('practice.counterReadings.title');
	},
	get description() {
		return t('practice.counterReadings.description');
	},
	appliesTo: isJapanese,
	items: async ({ session }): Promise<DrillItem[]> => readingItems(await loadCounterReadings(session.deps.api)),
	label: (item) => (item.data as ReadingItemData | undefined)?.number.prompt ?? item.key,
	question: ReadingQuestion
};
