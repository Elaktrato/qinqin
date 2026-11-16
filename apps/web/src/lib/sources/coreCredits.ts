// Third-party material built into the app itself (not a pack, not a
// plugin), shown under "Built into the app" on the Sources page. Licence
// names and copyright lines are taken from each package's own
// package.json/LICENSE; the licence texts listed ship under
// apps/web/static, copied verbatim from the packages.

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
	}
];
