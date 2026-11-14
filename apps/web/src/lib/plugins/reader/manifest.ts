// The reader plugin's manifest: a page-only plugin, reachable at /p/reader.
// `sources` credits the text sources it fetches from and the conversion
// library it bundles; the Sources page lists them under "Plugins".
import type { PluginManifest } from '../index';
import ReadingTimeWidget from '$lib/widgets/ReadingTimeWidget.svelte';

export const readerManifest: PluginManifest = {
	id: 'qinqin-reader',
	name: 'Reader',
	version: '1.0',
	surfaces: ['page'],
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
	],
	sources: [
		{
			name: 'Aozora Bunko',
			url: 'https://www.aozora.gr.jp/',
			license: 'Public domain works only; catalog CC BY 4.0',
			lang: 'ja',
			notice:
				'Nothing from Aozora Bunko is bundled: the server fetches its catalog and, when a user imports one, a work from aozora.gr.jp. Only works in the public domain are listed or importable: the catalog’s work copyright flag and person copyright flag must both say no copyright, and a row that does not is skipped. The catalog is used under CC BY 4.0, as stated on aozora.gr.jp, and each book keeps its 底本 (source edition) credit.'
		},
		{
			name: 'Project Gutenberg',
			url: 'https://www.gutenberg.org/',
			license: 'Public domain in the USA',
			notice:
				'Nothing from Project Gutenberg is bundled: the server fetches its catalog and, when a user imports one, a Chinese or Japanese text ebook from gutenberg.org. The catalog has no rights column, so each imported book carries the note “Distributed by Project Gutenberg as public domain in the USA; copyright status elsewhere may differ.”'
		},
		{
			name: 'opencc-js',
			url: 'https://github.com/nk2028/opencc-js',
			license: 'MIT AND Apache-2.0',
			notice:
				'Traditional/simplified conversion in the Reader uses opencc-js: the library is under the MIT License, and its conversion dictionaries, generated from [opencc-data](https://github.com/nk2028/opencc-data), under the Apache License, Version 2.0. Both license texts ship with this app.',
			licenseTexts: [
				{ label: 'MIT license text', path: '/OPENCC-JS-LICENSE.TXT' },
				{ label: 'Apache-2.0 license text', path: '/OPENCC-APACHE-2.0.TXT' }
			]
		}
	]
};
