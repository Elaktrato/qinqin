// Third-party material built into the app itself (not a pack, not a
// plugin), shown under "Built into the app" on the Sources page. Licence
// names and copyright lines are taken from each package's own
// package.json/LICENSE; the licence texts listed ship under
// apps/web/static, copied verbatim from the packages. The text sources
// the reader fetches from (not bundled) are credited here too: the reader
// is part of the app.

import type { SourceCredit } from './credits';

export const coreCredits: SourceCredit[] = [
	{
		name: 'hanzi-writer-data',
		url: 'https://www.npmjs.com/package/hanzi-writer-data',
		license: 'Arphic Public License',
		attribution: 'Make Me a Hanzi, hanzi-writer-data',
		notice:
			'Stroke-order animations use hanzi-writer-data, derived from the [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) dataset. That data is licensed under the Arphic Public License and is used unmodified. The full license text ships with this app.',
		licenseTexts: [{ label: 'Arphic Public License text', path: '/ARPHICPL.TXT' }]
	},
	{
		name: 'hanzi-writer',
		url: 'https://github.com/chanind/hanzi-writer',
		license: 'MIT',
		attribution: 'Copyright (c) 2014 David Chanin',
		notice: 'Draws the stroke-order animations and the writing cards.'
	},
	{
		name: 'ts-fsrs',
		url: 'https://github.com/open-spaced-repetition/ts-fsrs',
		license: 'MIT',
		attribution: 'Copyright (c) 2026 Open Spaced Repetition',
		notice: 'Schedules flashcard reviews.'
	},
	{
		name: 'uqr',
		url: 'https://github.com/unjs/uqr',
		license: 'MIT',
		attribution: 'Copyright (c) Project Nayuki; Copyright (c) 2023 Anthony Fu',
		notice: 'Draws the QR code for two-step sign-in setup in your browser. The code is never sent anywhere.',
		licenseTexts: [{ label: 'MIT license text', path: '/UQR-LICENSE.TXT' }]
	},
	// The reader (a core feature since v0.4.0; these were its plugin credits,
	// unchanged).
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
];
