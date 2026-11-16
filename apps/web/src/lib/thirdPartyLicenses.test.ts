import { describe, expect, it } from 'vitest';
import tesseractShipped from '../../static/TESSERACT-APACHE-2.0.TXT?raw';
import leptonicaShipped from '../../static/LEPTONICA-LICENSE.TXT?raw';
import anthropicShipped from '../../static/ANTHROPIC-SDK-GO-LICENSE.TXT?raw';
import apacheShipped from '../../static/OPENCC-APACHE-2.0.TXT?raw';
import mitShipped from '../../static/OPENCC-JS-LICENSE.TXT?raw';
import uqrShipped from '../../static/UQR-LICENSE.TXT?raw';
import uqrUpstream from '../../node_modules/uqr/LICENSE?raw';
import apacheUpstream from '../../node_modules/opencc-js/LICENSES/Apache-2.0.txt?raw';
import mitUpstream from '../../node_modules/opencc-js/LICENSE?raw';

// Journal licence texts, copied byte for byte from:
//  - Tesseract: https://github.com/tesseract-ocr/tesseract/blob/5.5.0/LICENSE
//  - Leptonica: https://github.com/DanBloomberg/leptonica/blob/1.85.0/leptonica-license.txt
//  - Anthropic Go SDK: https://github.com/anthropics/anthropic-sdk-go/blob/v2.9.0/LICENSE
//    (Apache-2.0 since v2; LICENSE-MIT only covers earlier versions)
//
// The licence texts the app serves for bundled third-party code must be
// the package's own files, byte for byte (copied, never retyped).
describe('third-party licence texts', () => {
	it('ships the opencc-js MIT licence verbatim', () => {
		expect(mitShipped).toBe(mitUpstream);
	});

	it('ships the opencc-js dictionary data Apache-2.0 licence verbatim', () => {
		expect(apacheShipped).toBe(apacheUpstream);
		expect(apacheShipped).toContain('Apache License');
	});

	it('ships the uqr (QR code) MIT licence verbatim', () => {
		expect(uqrShipped).toBe(uqrUpstream);
		expect(uqrShipped).toContain('MIT License');
	});

	it('ships the Tesseract Apache-2.0 licence', () => {
		expect(tesseractShipped).toContain('Apache License');
		expect(tesseractShipped).toContain('Version 2.0');
	});

	it('ships the Leptonica licence', () => {
		expect(leptonicaShipped).toContain('Leptonica');
		expect(leptonicaShipped).toContain('Redistribution and use in source and binary forms');
	});

	it('ships the Anthropic Go SDK licence (Apache-2.0 at v2.9.0)', () => {
		expect(anthropicShipped).toContain('Apache License');
		expect(anthropicShipped).toContain('Version 2.0');
		expect(anthropicShipped).toContain('Anthropic');
	});
});
