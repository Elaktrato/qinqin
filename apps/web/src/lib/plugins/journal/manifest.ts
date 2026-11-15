// The journal plugin's manifest: a page-only plugin at /p/journal.
// `sources` credits what the server image ships for it.
import type { PluginManifest } from '../index';

export const journalManifest: PluginManifest = {
	id: 'qinqin-journal',
	name: 'Journal',
	version: '1.0',
	surfaces: ['page'],
	sources: [
		{
			name: 'Tesseract OCR',
			url: 'https://github.com/tesseract-ocr/tesseract',
			license: 'Apache-2.0',
			notice:
				'The server image ships Tesseract 5.5 and the chi_sim, chi_tra, jpn and eng models from tessdata (Apache-2.0) for offline photo reading. The photo is read on this server; nothing is sent anywhere.',
			licenseTexts: [{ label: 'Apache-2.0 license text', path: '/TESSERACT-APACHE-2.0.TXT' }]
		},
		{
			name: 'Leptonica',
			url: 'https://github.com/DanBloomberg/leptonica',
			license: 'BSD-2-Clause',
			notice:
				'Tesseract links the Leptonica image library, which the server image redistributes.',
			licenseTexts: [{ label: 'Leptonica license text', path: '/LEPTONICA-LICENSE.TXT' }]
		},
		{
			name: 'Anthropic Go SDK',
			url: 'https://github.com/anthropics/anthropic-sdk-go',
			license: 'Apache-2.0',
			notice:
				'Used by the server to call Claude with your own API key when you ask for a review, ideas or a transcription.',
			licenseTexts: [{ label: 'Apache-2.0 license text', path: '/ANTHROPIC-SDK-GO-LICENSE.TXT' }]
		}
	]
};
