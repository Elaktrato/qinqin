import { describe, expect, it } from 'vitest';
import { webPlugins } from '$lib/plugins';
import { coreFeatures } from '$lib/features';
import type { SourceCredit } from './credits';

// The reader's credits as its v0.3.0 manifest declared them (licensing first:
// moving them to the core credits changes no word).
const READER_V030_SOURCES: SourceCredit[] = [
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
import { fixtureManifest } from '$lib/plugins/fixtures';
import { coreCredits } from './coreCredits';
import { localLicensePath } from './credits';
import { componentsSection, creditView, fontsSection, packTable, pluginCredits, sentencePackSources, strokesSection, themesSection } from './sections';

describe('packTable', () => {
	it('builds rows and a note per pack with a notice, with unique ids', () => {
		const table = packTable('levels', [
			{
				id: 3,
				name: 'HSK 3.0 (words)',
				language: 'zh',
				version: '2025-11',
				license: 'See CTI Legal Notice',
				attribution: 'CTI',
				notice: 'The official word list (HSK 词汇大纲).\n\nSource: [CTI](https://www.chinesetest.cn).'
			},
			{ id: 4, name: 'Mini', language: 'zh', version: '1', license: 'MIT', attribution: 'x', notice: '' },
			{ id: 5, name: 'No fields' }
		]);
		expect(table.rows).toEqual([
			{
				key: 3,
				name: 'HSK 3.0 (words)',
				language: 'zh',
				version: '2025-11',
				license: 'See CTI Legal Notice',
				attribution: 'CTI',
				noteId: 'note-levels-3'
			},
			{
				key: 4,
				name: 'Mini',
				language: 'zh',
				version: '1',
				license: 'MIT',
				attribution: 'x',
				noteId: undefined
			},
			{
				key: 5,
				name: 'No fields',
				language: '',
				version: '',
				license: '',
				attribution: '',
				noteId: undefined
			}
		]);
		expect(table.notes).toHaveLength(1);
		expect(table.notes[0]).toMatchObject({
			id: 'note-levels-3',
			name: 'HSK 3.0 (words)',
			lang: 'zh-Hans',
			sharedWith: []
		});
		expect(table.notes[0].paragraphs).toHaveLength(2);
		expect(table.notes[0].paragraphs[1].parts[1]).toEqual({
			type: 'link',
			text: 'CTI',
			href: 'https://www.chinesetest.cn/'
		});
	});

	it('tags notes of packs without a language as Japanese only when they have kana', () => {
		const table = packTable('dictionaries', [
			{ id: 1, name: 'A', notice: 'かな' },
			{ id: 2, name: 'B', notice: '漢字' }
		]);
		expect(table.notes.map((note) => note.lang)).toEqual(['ja', 'und']);
	});

	it('shows a paragraph shared word for word only in the first note that has it', () => {
		const terms = 'Source: [CTI](https://www.chinesetest.cn). No reuse licence is granted.';
		const table = packTable('levels', [
			{ id: 1, name: 'HSK chars', language: 'zh', notice: `Characters.\n\n${terms}` },
			{ id: 2, name: 'HSK words', language: 'zh', notice: `Words.\n\n${terms}` },
			{ id: 3, name: 'Copy', language: 'zh', notice: terms },
			{ id: 4, name: 'Near copy', language: 'zh', notice: `${terms} ` + 'Extra.' }
		]);
		const texts = (i: number) =>
			table.notes[i].paragraphs.map((p) => p.parts.map((part) => part.text).join(''));
		expect(texts(0)).toEqual(['Characters.', 'Source: CTI. No reuse licence is granted.']);
		expect(texts(1)).toEqual(['Words.']);
		expect(table.notes[1].sharedWith).toEqual([{ id: 'note-levels-1', name: 'HSK chars' }]);
		// A note made only of shared paragraphs keeps its row link and points back.
		expect(table.rows[2].noteId).toBe('note-levels-3');
		expect(texts(2)).toEqual([]);
		expect(table.notes[2].sharedWith).toEqual([{ id: 'note-levels-1', name: 'HSK chars' }]);
		// Only identical paragraphs are merged.
		expect(texts(3)).toHaveLength(1);
		expect(table.notes[3].sharedWith).toEqual([]);
	});

	it('renders a paragraph a note repeats itself as written, without pointing at itself', () => {
		const table = packTable('levels', [
			{ id: 1, name: 'Twice', language: 'zh', notice: 'Same.\n\nOther.\n\nSame.' },
			{ id: 2, name: 'Later', language: 'zh', notice: 'Same.' }
		]);
		const texts = (i: number) =>
			table.notes[i].paragraphs.map((p) => p.parts.map((part) => part.text).join(''));
		expect(texts(0)).toEqual(['Same.', 'Other.', 'Same.']);
		expect(table.notes[0].sharedWith).toEqual([]);
		expect(texts(1)).toEqual([]);
		expect(table.notes[1].sharedWith).toEqual([{ id: 'note-levels-1', name: 'Twice' }]);
	});

	it('does not merge across tables', () => {
		const a = packTable('levels', [{ id: 1, name: 'A', notice: 'Same.' }]);
		const b = packTable('frequency', [{ id: 1, name: 'B', notice: 'Same.' }]);
		expect(a.notes[0].paragraphs).toHaveLength(1);
		expect(b.notes[0].paragraphs).toHaveLength(1);
	});

	it('returns empty rows and notes for no packs', () => {
		expect(packTable('frequency', [])).toEqual({ rows: [], notes: [] });
	});
});

describe('creditView', () => {
	it('drops a non-https url and licence texts outside the static root', () => {
		const view = creditView({
			name: 'X',
			url: 'javascript:alert(1)',
			licenseTexts: [
				{ label: 'ok', path: '/LICENSE.TXT' },
				{ label: 'remote', path: 'https://evil.example/L' },
				{ label: 'proto-relative', path: '//evil.example/L' },
				{ label: 'traversal', path: '/../etc/passwd' },
				{ label: ' ', path: '/BLANK.TXT' }
			]
		});
		expect(view.href).toBeUndefined();
		expect(view.licenseTexts).toEqual([{ label: 'ok', path: '/LICENSE.TXT' }]);
		expect(view.license).toBe('');
		expect(view.paragraphs).toEqual([]);
	});

	it('keeps an https url, normalised', () => {
		expect(creditView({ name: 'Y', url: 'https://example.com' }).href).toBe('https://example.com/');
	});
});

describe('pluginCredits', () => {
	it('lists plugins that declare sources, skipping core duplicates and empty plugins', () => {
		const result = pluginCredits(
			[
				fixtureManifest({ id: 'a', name: 'A' }),
				fixtureManifest({ id: 'b', name: 'B', sources: [{ name: 'Hanzi-Writer ' }] }),
				fixtureManifest({ id: 'c', name: 'C', sources: [{ name: 'lib' }, { name: 'hanzi-writer' }] })
			],
			[{ name: 'hanzi-writer' }]
		);
		expect(result.map((plugin) => [plugin.id, plugin.credits.map((credit) => credit.name)])).toEqual([
			['c', ['lib']]
		]);
	});

	it('credits the reader sources as core credits, not as a plugin', () => {
		// The reader is a core feature (v0.4.0): its sources are "Built into the app".
		expect(coreCredits.map((credit) => credit.name)).toEqual(
			expect.arrayContaining(['Aozora Bunko', 'Project Gutenberg', 'opencc-js'])
		);
		expect(coreFeatures.flatMap((f) => f.manifest.sources ?? [])).toEqual([]);
		const opencc = coreCredits.find((credit) => credit.name === 'opencc-js')!;
		expect(opencc.license).toBe('MIT AND Apache-2.0');
		expect(opencc.licenseTexts).toEqual([
			{ label: 'MIT license text', path: '/OPENCC-JS-LICENSE.TXT' },
			{ label: 'Apache-2.0 license text', path: '/OPENCC-APACHE-2.0.TXT' }
		]);
		// The notices are the v0.3.0 reader manifest's, word for word.
		expect(coreCredits.find((c) => c.name === 'Aozora Bunko')).toEqual(READER_V030_SOURCES[0]);
		expect(coreCredits.find((c) => c.name === 'Project Gutenberg')).toEqual(READER_V030_SOURCES[1]);
		expect(opencc).toEqual(READER_V030_SOURCES[2]);
	});

	it('credits the bundled interface font (Figtree, SIL OFL 1.1) with its licence text', () => {
		const figtree = coreCredits.find((credit) => credit.name === 'Figtree')!;
		expect(figtree).toBeDefined();
		expect(figtree.url).toBe('https://github.com/erikdkennedy/figtree');
		expect(figtree.license).toBe('OFL-1.1');
		expect(figtree.attribution).toBe('Copyright 2022 The Figtree Project Authors');
		expect(figtree.licenseTexts).toEqual([{ label: 'OFL-1.1 license text', path: '/FIGTREE-OFL.TXT' }]);
		expect(figtree.notice).toMatch(/interface font/i);
	});

	it('credits the compiled-in fallback palette (Catppuccin, MIT) with its licence text', () => {
		const catppuccin = coreCredits.find((credit) => credit.name === 'Catppuccin')!;
		expect(catppuccin).toBeDefined();
		expect(catppuccin.url).toBe('https://github.com/catppuccin/palette');
		expect(catppuccin.license).toBe('MIT');
		expect(catppuccin.attribution).toBe('Copyright (c) 2021 Catppuccin');
		expect(catppuccin.licenseTexts).toEqual([{ label: 'MIT license text', path: '/CATPPUCCIN-LICENSE.TXT' }]);
		expect(catppuccin.notice).toMatch(/Latte and Mocha/);
	});

	it('credits the plugin sources from the real registry', () => {
		const result = pluginCredits(
			webPlugins.map((plugin) => plugin.manifest),
			coreCredits
		);
		expect(result.map((plugin) => plugin.id)).toEqual(['qinqin-journal']);
		expect(result[0].credits.map((credit) => credit.name)).toEqual([
			'Tesseract OCR',
			'Leptonica',
			'Anthropic Go SDK'
		]);
	});
});

describe('declared credits', () => {
	const all = [...coreCredits, ...[...coreFeatures, ...webPlugins].flatMap((owner) => owner.manifest.sources ?? [])];

	it('use only https upstream links and notices that parse to https links', () => {
		for (const credit of all) {
			const view = creditView(credit);
			if (credit.url) expect(view.href, credit.name).toBeDefined();
			for (const paragraph of view.paragraphs) {
				for (const part of paragraph.parts) {
					if (part.type === 'link') expect(part.href.startsWith('https://')).toBe(true);
					else expect(part.text, credit.name).not.toMatch(/\]\(/);
				}
			}
		}
	});

	it('point licence texts at files that ship in apps/web/static', async () => {
		const shipped = import.meta.glob('../../../static/*', { query: '?url', import: 'default' });
		const names = new Set(Object.keys(shipped).map((path) => `/${path.split('/').pop()}`));
		const paths = all.flatMap((credit) => (credit.licenseTexts ?? []).map((text) => text.path));
		expect(paths.sort()).toEqual([
			'/ANTHROPIC-SDK-GO-LICENSE.TXT',
			'/CATPPUCCIN-LICENSE.TXT',
			'/FIGTREE-OFL.TXT',
			'/LEPTONICA-LICENSE.TXT',
			'/OPENCC-APACHE-2.0.TXT',
			'/OPENCC-JS-LICENSE.TXT',
			'/TESSERACT-APACHE-2.0.TXT',
			'/UQR-LICENSE.TXT'
		]);
		for (const path of paths) {
			expect(localLicensePath(path)).toBe(path);
			expect(names.has(path), path).toBe(true);
		}
	});

	it('credit each piece of material once', () => {
		const names = all.map((credit) => credit.name.toLowerCase());
		expect(new Set(names).size).toBe(names.length);
	});
});

describe('sentencePackSources', () => {
	it('turns the public list into pack rows with the stated credits', () => {
		const rows = packTable(
			'sentences',
			sentencePackSources([
				{ packId: 'a', name: 'A', version: '1', language: 'es', license: 'CC BY 4.0', attribution: 'X', notice: 'Careful.' },
				{ packId: 'b', name: 'B', version: '2', language: 'es', license: 'MIT', attribution: 'Y', notice: '' }
			])
		);
		expect(rows.rows.map((r) => [r.key, r.name, r.license, r.attribution])).toEqual([
			[0, 'A', 'CC BY 4.0', 'X'],
			[1, 'B', 'MIT', 'Y']
		]);
		expect(rows.notes.map((n) => n.id)).toEqual(['note-sentences-0']);
	});
	it('is empty for no packs', () => {
		expect(sentencePackSources([])).toEqual([]);
	});
});

describe('componentsSection', () => {
	const pack = { packId: 'kanjivg-components', name: 'KanjiVG components', version: 'r20260714', language: 'ja', license: 'CC BY-SA 3.0', attribution: 'KanjiVG © Ulrich Apel', notice: 'Derived from [KanjiVG](https://kanjivg.tagaini.net).' };
	it('is hidden without packs and without an error', () => {
		expect(componentsSection([], '').show).toBe(false);
	});
	it('shows the stated credits and the notice of each pack', () => {
		const s = componentsSection([pack], '');
		expect(s.show).toBe(true);
		expect(s.table.rows.map((r) => [r.name, r.language, r.version, r.license, r.attribution])).toEqual([
			['KanjiVG components', 'ja', 'r20260714', 'CC BY-SA 3.0', 'KanjiVG © Ulrich Apel']
		]);
		expect(s.table.notes).toHaveLength(1);
		expect(s.table.notes[0].id).toBe('note-components-0');
	});
	it('shows on an error so the retry is reachable', () => {
		expect(componentsSection([], 'down').show).toBe(true);
	});
});

describe('fontsSection', () => {
	const kai = (weight: string) => ({
		packId: 'klee-one',
		face: 'kai' as const,
		script: 'Jpan' as const,
		original: 'Klee One',
		weight,
		style: 'normal',
		license: 'OFL-1.1',
		attribution: 'Klee One by Fontworks',
		slices: [{ url: `/fonts/${'a'.repeat(64)}.woff2`, unicodeRange: 'U+4E00' }]
	});
	const list = {
		faces: [kai('400'), kai('600')],
		packs: [
			{
				packId: 'klee-one',
				name: 'qinqin Kai JP (Klee One, subset)',
				version: '1.100-q1',
				license: 'OFL-1.1',
				attribution: 'Klee One by Fontworks (SIL OFL 1.1)',
				notice: 'qinqin Kai JP is a modified version of Klee One.'
			}
		]
	};
	it('is hidden without packs and without an error, shown on an error', () => {
		expect(fontsSection({ faces: [], packs: [] }, '').show).toBe(false);
		expect(fontsSection({ faces: [], packs: [] }, 'down').show).toBe(true);
	});
	it('credits each pack with its licence link, notice and the face it modifies', () => {
		const s = fontsSection(list, '');
		expect(s.show).toBe(true);
		expect(s.table.rows.map((r) => [r.name, r.language, r.version, r.license, r.attribution])).toEqual([
			['qinqin Kai JP (Klee One, subset)', 'ja', '1.100-q1', 'OFL-1.1', 'Klee One by Fontworks (SIL OFL 1.1)']
		]);
		expect(s.table.notes).toHaveLength(1);
		expect(s.licenseHref[0]).toBe('https://openfontlicense.org/');
		expect(s.modified).toEqual(['qinqin Kai JP (Klee One, subset): a modified (subset, renamed) version of Klee One']);
	});
});

describe('strokesSection', () => {
	const pack = {
		packId: 'hanzi-writer-strokes',
		name: 'Hanzi Writer stroke data',
		version: '0.2.0',
		languages: ['zh'],
		license: 'Arphic Public License',
		attribution: 'Make Me a Hanzi, hanzi-writer-data',
		notice: 'Derived from [Make Me a Hanzi](https://github.com/skishore/makemeahanzi).'
	};
	it('is hidden without packs and without an error, shown on an error', () => {
		expect(strokesSection([], '').show).toBe(false);
		expect(strokesSection([], 'down').show).toBe(true);
	});
	it('shows licence, attribution and notice, and links the Arphic text that ships with the app', async () => {
		const s = strokesSection([pack], '');
		expect(s.table.rows.map((r) => [r.name, r.license, r.attribution])).toEqual([
			['Hanzi Writer stroke data', 'Arphic Public License', 'Make Me a Hanzi, hanzi-writer-data']
		]);
		expect(s.table.notes[0].id).toBe('note-strokes-0');
		expect(s.licenseHref).toEqual({ 0: '/ARPHICPL.TXT' });
		const shipped = import.meta.glob('../../../static/*', { query: '?url', import: 'default' });
		expect(Object.keys(shipped).map((p) => `/${p.split('/').pop()}`)).toContain('/ARPHICPL.TXT');
		expect(localLicensePath('/ARPHICPL.TXT')).toBe('/ARPHICPL.TXT');
	});
	it('takes the typography language from the first of the pack languages', () => {
		const s = strokesSection([{ ...pack, languages: ['ja', 'zh'] }], '');
		expect(s.table.rows[0].language).toBe('ja');
		expect(strokesSection([{ ...pack, languages: [] }], '').table.rows[0].language).toBe('');
	});
	it('links nothing for another licence', () => {
		expect(strokesSection([{ ...pack, license: 'MIT' }], '').licenseHref).toEqual({});
	});
});

describe('the app credits no longer carry the stroke data', () => {
	it('lists no hanzi-writer-data credit (the stroke packs are credited from the server)', () => {
		expect(coreCredits.map((c) => c.name)).not.toContain('hanzi-writer-data');
		expect(coreCredits.map((c) => c.name)).toContain('hanzi-writer');
	});
});

describe('themesSection', () => {
	const themes = [
		{ id: 'catppuccin-latte', name: 'Latte', family: 'Catppuccin' },
		{ id: 'catppuccin-mocha', name: 'Mocha', family: 'Catppuccin' },
		{ id: 'paper', name: 'Paper', family: '' }
	];
	const packs = [
		{ packId: 'catppuccin', name: 'Catppuccin', version: '1.0', license: 'MIT', attribution: '© 2021 Catppuccin', notice: 'Colours from [the palette](https://github.com/catppuccin/palette).', licenseText: 'MIT License\n\nCopyright (c) 2021 Catppuccin\n', builtin: true, themes: ['catppuccin-latte', 'catppuccin-mocha'] },
		{ packId: 'paper-themes', name: 'Paper themes', version: '2', license: 'MIT', attribution: 'Paper', notice: '', licenseText: '', builtin: false, themes: ['paper', 'gone'] }
	];

	it('lists every pack in the answer order with its theme names and whether it is built in', () => {
		const out = themesSection({ themes, packs }, '');
		expect(out.show).toBe(true);
		expect(out.table.rows.map((r) => [r.name, r.license, r.attribution])).toEqual([
			['Catppuccin', 'MIT', '© 2021 Catppuccin'],
			['Paper themes', 'MIT', 'Paper']
		]);
		expect(out.themeNames).toEqual({ 0: 'Latte, Mocha', 1: 'Paper' });
		expect(out.builtin).toEqual({ 0: true, 1: false });
		// The full licence texts the answer carries (built-in packs).
		expect(out.licenseTexts).toEqual([
			{ key: 0, label: 'Catppuccin: MIT license text', text: 'MIT License\n\nCopyright (c) 2021 Catppuccin\n' }
		]);
		expect(out.table.notes).toHaveLength(1);
	});

	it('shows on an error so the retry is reachable, and hides with nothing listed', () => {
		expect(themesSection({ themes: [], packs: [] }, 'down').show).toBe(true);
		expect(themesSection({ themes: [], packs: [] }, '').show).toBe(false);
	});
});
