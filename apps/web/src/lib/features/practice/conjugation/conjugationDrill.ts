// The conjugation trainer (#178; docs/contracts/conjugation/): a Japanese drill on the verbs and adjectives the learner
// studies. An item is word × form family (`<entryId>:<family>`); the server conjugates (POST
// /api/drills/conjugation/words), the workspace setting `conjugation` chooses the families.

import { t } from '$lib/i18n';
import { enabledFamilies } from '$lib/exercises/conjugationSettings';
import type { DrillDef, DrillItem } from '../types';
import ConjugationQuestion from './ConjugationQuestion.svelte';
import { CONJUGATION_DRILL, conjugationItems, studiedEntryIds, type ConjugationItemData } from './items';
import { familyLabel } from './labels';
import { loadConjugationWords } from './words';

export const conjugationDrill: DrillDef = {
	id: CONJUGATION_DRILL,
	get title() {
		return t('practice.conjugation.title');
	},
	get description() {
		return t('practice.conjugation.description');
	},
	appliesTo: (language) => language === 'ja',
	items: async ({ session, workspace, history }): Promise<DrillItem[]> => {
		const families = enabledFamilies(workspace.settings);
		const ids = studiedEntryIds(history);
		if (families.length === 0 || ids.length === 0) return [];
		const words = await loadConjugationWords(session.deps.api, ids);
		return conjugationItems(ids, words, families, history.drillAnswers ?? []);
	},
	label: (item) => {
		const data = item.data as ConjugationItemData | undefined;
		return data === undefined ? item.key : `${data.word.written} · ${familyLabel(data.family)}`;
	},
	question: ConjugationQuestion
};
