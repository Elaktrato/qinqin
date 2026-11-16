// The reader's manifest: the identity of its reserved registry row and its
// widget. The reader is a core feature at /reader (lib/features); the text
// sources it fetches from and the conversion library it bundles are core
// credits (lib/sources/coreCredits.ts).
import reader from '$builtin/reader.json';
import type { ContractManifest } from '$lib/plugins/contract';
import type { PluginManifest } from '$lib/plugins';
import ReadingTimeWidget from '$lib/widgets/ReadingTimeWidget.svelte';

export const readerManifest: PluginManifest = {
	...(reader as unknown as ContractManifest),
	widgets: [
		{
			id: 'reading-time',
			title: 'Reading time',
			description: 'Tracked reading time: all time, last 7 and 30 days, most read books.',
			owner: 'qinqin-reader',
			size: 'normal',
			surfaces: ['stats', 'home'],
			component: ReadingTimeWidget
		}
	]
};
