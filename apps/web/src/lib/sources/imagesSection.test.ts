import { describe, expect, it } from 'vitest';
import type { ImagePackInfo } from '$lib/api/images';
import { imagesSection } from './imagesSection';

const openmoji: ImagePackInfo = {
	packId: 'images-openmoji',
	name: 'OpenMoji pictures (black outline)',
	version: '17.0.0',
	languages: ['ja', 'zh'],
	license: 'CC BY-SA 4.0',
	attribution: 'All emojis designed by OpenMoji – the open-source emoji and icon project. License: CC BY-SA 4.0 (https://openmoji.org)',
	notice: 'Pictures: the black-outline SVG files of [OpenMoji](https://openmoji.org) 17.0.0, unmodified in this pack.',
	pictureCount: 962,
	mappingCount: 3172
};
const mulberry: ImagePackInfo = { ...openmoji, packId: 'images-mulberry', name: 'Mulberry Symbols', version: '3.6.1', notice: '', license: 'CC BY-SA 4.0' };

describe('imagesSection', () => {
	it('is hidden with no pack and no error, shown with either', () => {
		expect(imagesSection([], '').show).toBe(false);
		expect(imagesSection([], 'Could not load').show).toBe(true);
		expect(imagesSection([openmoji], '').show).toBe(true);
	});

	it('lists each pack with the pack credit line exactly as stated, and the licence text link', () => {
		const s = imagesSection([openmoji, mulberry], '');
		expect(s.table.rows.map((r) => [r.name, r.license, r.version])).toEqual([
			['OpenMoji pictures (black outline)', 'CC BY-SA 4.0', '17.0.0'],
			['Mulberry Symbols', 'CC BY-SA 4.0', '3.6.1']
		]);
		expect(s.table.rows[0].attribution).toContain('All emojis designed by OpenMoji');
		expect(s.licenseHref[s.table.rows[0].key]).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
		expect(s.languages[s.table.rows[0].key]).toEqual(['ja', 'zh']);
	});

	it('carries the notice as a note with its link, for the pack that has one', () => {
		const s = imagesSection([openmoji, mulberry], '');
		expect(s.table.notes).toHaveLength(1);
		expect(s.table.notes[0].paragraphs[0].parts.some((p) => p.type === 'link' && new URL(p.href).hostname === 'openmoji.org')).toBe(true);
		expect(s.table.rows[0].noteId).toBeDefined();
		expect(s.table.rows[1].noteId).toBeUndefined();
	});
});
