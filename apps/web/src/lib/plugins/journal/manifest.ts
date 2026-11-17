// The journal plugin's manifest: a page-only plugin at /p/journal.
// `sources` credits what the server image ships for it.
import journal from '$builtin/journal.json';
import type { ContractManifest } from '../contract';
import type { PluginManifest } from '../index';
import { t } from '$lib/i18n';

/** A link to a licence file; the label is read when shown ("Apache-2.0 license text"). */
function licenceText(name: string, path: string): { readonly label: string; path: string } {
	return {
		path,
		get label() {
			return t('sources.licenseText', { name });
		}
	};
}

export const journalManifest: PluginManifest = {
	...(journal as unknown as ContractManifest),
	sources: [
		{
			name: 'Tesseract OCR',
			url: 'https://github.com/tesseract-ocr/tesseract',
			license: 'Apache-2.0',
			get notice() {
				return t('journal.credit.tesseract');
			},
			licenseTexts: [licenceText('Apache-2.0', '/TESSERACT-APACHE-2.0.TXT')]
		},
		{
			name: 'Leptonica',
			url: 'https://github.com/DanBloomberg/leptonica',
			license: 'BSD-2-Clause',
			get notice() {
				return t('journal.credit.leptonica');
			},
			licenseTexts: [licenceText('Leptonica', '/LEPTONICA-LICENSE.TXT')]
		},
		{
			name: 'Anthropic Go SDK',
			url: 'https://github.com/anthropics/anthropic-sdk-go',
			license: 'Apache-2.0',
			get notice() {
				return t('journal.credit.anthropic');
			},
			licenseTexts: [licenceText('Apache-2.0', '/ANTHROPIC-SDK-GO-LICENSE.TXT')]
		}
	]
};
