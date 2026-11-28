// Third-party material built into the app itself (not a pack, not a
// feature's own credit), shown under "Built into the app" on the Sources page. Licence
// names and copyright lines are taken from each package's own
// package.json/LICENSE; the licence texts listed ship under
// apps/web/static, copied verbatim from the packages. The stroke data is not
// built in: it is a pack on the server, credited from GET /api/stroke-packs
// (the Sources page's Stroke data section). The text sources
// the reader fetches from (not bundled) are credited here too: the reader
// is part of the app.

import type { SourceCredit } from './credits';
import { t, type MessageKey } from '$lib/i18n';

/**
 * A credit whose own words (the notice; the licence where it is prose) are read in the interface language when
 * shown: getters, never a spread (a spread would read the catalogue while the module loads).
 */
function credit(base: SourceCredit, words: { notice: MessageKey; license?: MessageKey }): SourceCredit {
	Object.defineProperty(base, 'notice', { enumerable: true, get: () => t(words.notice) });
	const license = words.license;
	if (license !== undefined) Object.defineProperty(base, 'license', { enumerable: true, get: () => t(license) });
	return base;
}

function licenceText(name: string, path: string): { readonly label: string; path: string } {
	return {
		path,
		get label() {
			return t('sources.licenseText', { name });
		}
	};
}

export const coreCredits: SourceCredit[] = [
	credit({
		name: 'hanzi-writer',
		url: 'https://github.com/chanind/hanzi-writer',
		license: 'MIT',
		attribution: 'Copyright (c) 2014 David Chanin',
	}, { notice: 'sources.core.hanziWriter' }),
	credit({
		name: 'ts-fsrs',
		url: 'https://github.com/open-spaced-repetition/ts-fsrs',
		license: 'MIT',
		attribution: 'Copyright (c) 2026 Open Spaced Repetition',
	}, { notice: 'sources.core.tsFsrs' }),
	// The interface font (#97), bundled unmodified; its licence text ships
	// at static/FIGTREE-OFL.TXT (upstream OFL.txt, byte for byte).
	credit({
		name: 'Figtree',
		url: 'https://github.com/erikdkennedy/figtree',
		license: 'OFL-1.1',
		attribution: 'Copyright 2022 The Figtree Project Authors',
		licenseTexts: [licenceText('OFL-1.1', '/FIGTREE-OFL.TXT')]
	}, { notice: 'sources.core.figtree' }),
	// The line icons (#98): Lucide shapes vendored as data
	// (lib/ui/icons/lucide.ts); the package LICENSE ships at
	// static/LUCIDE-LICENSE.TXT byte for byte (lib/ui/icons/lucide.test.ts).
	credit({
		name: 'Lucide',
		url: 'https://lucide.dev',
		license: 'ISC AND MIT',
		attribution: 'Copyright (c) 2026 Lucide Icons and Contributors; Copyright (c) 2013-present Cole Bemis (Feather)',
		licenseTexts: [licenceText('ISC AND MIT', '/LUCIDE-LICENSE.TXT')]
	}, { notice: 'sources.core.lucide' }),
	// The compiled-in fallback palette (#108): qinqin Day and Night paint
	// before the server's theme list arrives (lib/theme/fallback.ts). Its
	// licence text ships at static/QINQIN-LICENSE.TXT, the house theme
	// pack's LICENSE byte for byte (lib/theme/fallback.test.ts).
	credit({
		name: 'qinqin themes',
		url: 'https://github.com/Elaktrato/qinqin',
		license: 'CC BY 4.0',
		attribution: 'qinqin contributors, CC BY 4.0',
		licenseTexts: [licenceText('CC BY 4.0', '/QINQIN-LICENSE.TXT')]
	}, { notice: 'sources.core.qinqinThemes' }),
	// The topic labels of words (#220): built into the server (server/internal/topics/labels), written for the
	// project and shared under CC BY-SA 4.0 (adapted from OpenMoji's groups, keyed to CC-CEDICT and JMdict); the
	// licence name links to the legal code.
	credit({
		name: 'qinqin topic labels',
		url: 'https://github.com/Elaktrato/qinqin',
		license: 'CC BY-SA 4.0',
		attribution: 'qinqin contributors, CC BY-SA 4.0; from CC-CEDICT, JMdict (EDRDG) and OpenMoji, each CC BY-SA 4.0'
	}, { notice: 'sources.core.topicLabels' }),
	credit({
		name: 'uqr',
		url: 'https://github.com/unjs/uqr',
		license: 'MIT',
		attribution: 'Copyright (c) Project Nayuki; Copyright (c) 2023 Anthony Fu',
		licenseTexts: [licenceText('MIT', '/UQR-LICENSE.TXT')]
	}, { notice: 'sources.core.uqr' }),
	// The reader (a core feature since v0.4.0; these were its plugin credits,
	// unchanged).
	credit(
		{ name: 'Aozora Bunko', url: 'https://www.aozora.gr.jp/', lang: 'ja' },
		{ notice: 'sources.core.aozora', license: 'sources.core.aozoraLicense' }
	),
	credit(
		{ name: 'Project Gutenberg', url: 'https://www.gutenberg.org/' },
		{ notice: 'sources.core.gutenberg', license: 'sources.core.gutenbergLicense' }
	),
	credit(
		{
			name: 'opencc-js',
			url: 'https://github.com/nk2028/opencc-js',
			license: 'MIT AND Apache-2.0',
			licenseTexts: [licenceText('MIT', '/OPENCC-JS-LICENSE.TXT'), licenceText('Apache-2.0', '/OPENCC-APACHE-2.0.TXT')]
		},
		{ notice: 'sources.core.opencc' }
	)
];
