import { describe, expect, it } from 'vitest';
import { audioSection, type AudioPackInfo } from './audioSection';

const kanji: AudioPackInfo = {
	packId: 'kanjialive-audio',
	name: 'Kanji alive example-word audio',
	version: '2026-09-04',
	language: 'ja',
	license: 'CC BY 4.0',
	attribution: 'Kanji alive (https://kanjialive.com), CC BY 4.0',
	notice: 'Recordings from [Kanji alive](https://kanjialive.com).',
	clipCount: 10156
};
const commons: AudioPackInfo = { ...kanji, packId: 'commons-audio-zh', name: 'Commons Mandarin', language: 'zh', license: 'per file', notice: '', clipCount: 3 };

describe('audioSection', () => {
	it('is absent when no audio pack is installed', () => {
		expect(audioSection([])).toBeNull();
	});

	it('lists each pack with licence, attribution and its notice', () => {
		const s = audioSection([kanji, commons])!;
		expect(s.table.rows.map((r) => [r.name, r.license, r.attribution])).toEqual([
			['Kanji alive example-word audio', 'CC BY 4.0', 'Kanji alive (https://kanjialive.com), CC BY 4.0'],
			['Commons Mandarin', 'per file', 'Kanji alive (https://kanjialive.com), CC BY 4.0']
		]);
		expect(s.table.notes).toHaveLength(1);
		expect(s.table.notes[0].paragraphs[0].parts.some((p) => p.type === 'link' && new URL(p.href).hostname === 'kanjialive.com')).toBe(true);
		expect(s.table.rows[0].noteId).toBeDefined();
		expect(s.table.rows[1].noteId).toBeUndefined();
	});

	it('links per-recording credits only for packs whose licence is per file', () => {
		const s = audioSection([kanji, commons])!;
		const [a, b] = s.table.rows;
		expect(s.creditsHref[a.key]).toBeUndefined();
		expect(s.creditsHref[b.key]).toBe('/api/audio-packs/commons-audio-zh/credits?limit=500');
	});

	it('encodes the pack id in the link', () => {
		const s = audioSection([{ ...commons, packId: 'a b/c' }])!;
		expect(Object.values(s.creditsHref)[0]).toBe('/api/audio-packs/a%20b%2Fc/credits?limit=500');
	});
});
