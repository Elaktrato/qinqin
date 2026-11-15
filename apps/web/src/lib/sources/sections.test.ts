import { describe, expect, it } from 'vitest';
import { webPlugins } from '$lib/plugins';
import { fixtureManifest } from '$lib/plugins/fixtures';
import { coreCredits } from './coreCredits';
import { localLicensePath } from './credits';
import { creditView, packTable, pluginCredits } from './sections';

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

	it('credits the reader sources from the real registry', () => {
		const result = pluginCredits(
			webPlugins.map((plugin) => plugin.manifest),
			coreCredits
		);
		expect(result.map((plugin) => plugin.id)).toEqual(['qinqin-reader', 'qinqin-journal']);
		expect(result[0].credits.map((credit) => credit.name)).toEqual([
			'Aozora Bunko',
			'Project Gutenberg',
			'opencc-js'
		]);
		expect(result[1].credits.map((credit) => credit.name)).toEqual([
			'Tesseract OCR',
			'Leptonica',
			'Anthropic Go SDK'
		]);
	});
});

describe('declared credits', () => {
	const all = [...coreCredits, ...webPlugins.flatMap((plugin) => plugin.manifest.sources ?? [])];

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
			'/ARPHICPL.TXT',
			'/LEPTONICA-LICENSE.TXT',
			'/OPENCC-APACHE-2.0.TXT',
			'/OPENCC-JS-LICENSE.TXT',
			'/TESSERACT-APACHE-2.0.TXT'
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
