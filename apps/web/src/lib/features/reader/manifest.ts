// The reader's widget. The reader is a core feature at /reader
// (lib/features); the text sources it fetches from and the conversion
// library it bundles are core credits (lib/sources/coreCredits.ts). The
// graded readers (#231, server/internal/library/sources/graded/texts) are
// the project's own texts, credited here.
import { t } from '$lib/i18n';
import type { FeatureDef } from '$lib/features';
import ReadingTimeWidget from '$lib/widgets/ReadingTimeWidget.svelte';

export const readerDef: FeatureDef = {
	sources: [
		{
			name: 'qinqin graded readers',
			url: 'https://github.com/Elaktrato/qinqin',
			license: 'CC BY 4.0',
			attribution: 'qinqin contributors, CC BY 4.0',
			get notice() {
				return t('sources.credit.graded');
			}
		}
	],
	widgets: [
		{
			id: 'reading-time',
			get title() {
				return t('reader.widget.title');
			},
			get description() {
				return t('reader.widget.description');
			},
			owner: 'reader',
			size: 'normal',
			surfaces: ['stats', 'home'],
			component: ReadingTimeWidget
		}
	]
};
