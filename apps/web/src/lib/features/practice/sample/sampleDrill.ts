// The sample drill: the framework's reference drill, a test harness (lib/features/practice/drills.ts). Five items,
// a question that shows the item and asks "Did you know it?", Right (Good) or Wrong (Again). It applies to every
// language and reads nothing from the decks.

import { t } from '$lib/i18n';
import type { DrillDef, DrillItem } from '../types';
import SampleQuestion from './SampleQuestion.svelte';

export const SAMPLE_ITEMS: readonly string[] = ['sample-1', 'sample-2', 'sample-3', 'sample-4', 'sample-5'];

export const sampleDrill: DrillDef = {
	id: 'sample',
	get title() {
		return t('practice.sample.title');
	},
	get description() {
		return t('practice.sample.description');
	},
	appliesTo: () => true,
	items: async (): Promise<DrillItem[]> => SAMPLE_ITEMS.map((key) => ({ key })),
	label: (item) => item.key,
	question: SampleQuestion
};
