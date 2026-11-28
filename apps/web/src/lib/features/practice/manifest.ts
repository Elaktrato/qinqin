// The Practice area (/practice, docs/contracts/drills/): no widgets yet; the drills' own data is credited here (the
// measure-word and counter drills, #179: the project's counters table and its corrections to CC-CEDICT's measure
// words, server/internal/counters/table).
import type { FeatureDef } from '$lib/features';
import { t } from '$lib/i18n';

export const practiceDef: FeatureDef = Object.freeze({
	sources: [
		{
			name: 'qinqin counters and measure words',
			url: 'https://github.com/Elaktrato/qinqin',
			license: 'CC BY 4.0',
			attribution: 'qinqin contributors, CC BY 4.0',
			get notice() {
				return t('sources.credit.counters');
			}
		}
	]
});
