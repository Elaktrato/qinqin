// The look-alike drill (#228, drill id `look-alikes`; docs/contracts/lookalikes/): sets of characters learners confuse
// (未/末, 己/已/巳, シ/ツ/ソ/ン), each set an item with its own schedule. A set is practised once one of its members is in
// the learner's study (Japanese kana sets always). The sets are bundled (lookAlikes/data, CC BY 4.0, reviewed by
// agents acting as teachers) and loaded when the drill needs them.

import { t } from '$lib/i18n';
import type { DrillDef } from '../types';
import { loadSetsFile } from './data';
import { lookAlikeItems, type LookAlikeItemData } from './items';
import LookAlikeQuestion from './LookAlikeQuestion.svelte';
import { LOOK_ALIKES_DRILL } from './sets';

const primary = (language: string) => language.trim().toLowerCase().split(/[-_]/)[0];

export const lookAlikeDrill: DrillDef = {
	id: LOOK_ALIKES_DRILL,
	get title() {
		return t('practice.lookAlikes.title');
	},
	get description() {
		return t('practice.lookAlikes.description');
	},
	appliesTo: (language) => primary(language) === 'zh' || primary(language) === 'ja',
	items: async ({ workspace, history }) => {
		const file = await loadSetsFile(workspace.language);
		return file === null ? [] : lookAlikeItems(file, workspace.language, history);
	},
	// The set's members (characters are no reading).
	label: (item) => (item.data as LookAlikeItemData | undefined)?.set.members.join(' / ') ?? [...item.key].join(' / '),
	question: LookAlikeQuestion
};
