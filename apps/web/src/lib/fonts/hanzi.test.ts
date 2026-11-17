import { describe, expect, it } from 'vitest';
import { HANZI_FACES, hanziScript, hanziStack, installedFaces, packFamily, type HanziFace } from './hanzi';

const GENERIC = ['serif', 'sans-serif'];
const parts = (stack: string) => stack.split(',').map((p) => p.trim());

describe('hanziScript: the study lang picks the script', () => {
	it.each([
		['zh', 'Hans'],
		['zh-Hans', 'Hans'],
		['zh-CN', 'Hans'],
		['zh-SG', 'Hans'],
		['zh-Hans-CN', 'Hans'],
		['zh-Hant', 'Hant'],
		['zh-Hant-TW', 'Hant'],
		['zh-TW', 'Hant'],
		['zh-HK', 'Hant'],
		['zh-MO', 'Hant'],
		['ZH-hant', 'Hant'],
		['ja', 'Jpan'],
		['ja-JP', 'Jpan']
	])('%s -> %s', (lang, script) => {
		expect(hanziScript(lang)).toBe(script);
	});
	it.each(['', 'en', 'ko', 'zh-Latn-pinyin', 'ja-Latn', 'zhx'])('%s has no hanzi script', (lang) => {
		expect(hanziScript(lang)).toBeNull();
	});
});

describe('hanziStack', () => {
	const none = installedFaces([]);
	for (const face of HANZI_FACES) {
		for (const lang of ['zh', 'zh-Hant', 'ja', 'en']) {
			it(`${face} ${lang}: system families only, ending with a generic family`, () => {
				const stack = hanziStack(face, lang, none);
				expect(GENERIC).toContain(parts(stack).at(-1));
				expect(stack).not.toMatch(/url\(|@font-face|https?:|qq-/);
			});
		}
	}

	it('simplified and traditional get their own regional families', () => {
		expect(hanziStack('sans', 'zh', none)).toContain('"PingFang SC"');
		expect(hanziStack('sans', 'zh-TW', none)).toContain('"PingFang TC"');
		expect(hanziStack('serif', 'zh-Hant', none)).toContain('"Noto Serif CJK TC"');
		expect(hanziStack('kai', 'zh-Hant', none)).toMatch(/BiauKai/);
		expect(hanziStack('kai', 'zh', none)).toMatch(/^"Kaiti SC"/);
	});

	it('Japanese Kai has its own textbook stack, then the serif stack', () => {
		const kai = hanziStack('kai', 'ja', none);
		expect(kai.startsWith('"UD Digi Kyokasho N-R", "YuKyokasho"')).toBe(true);
		expect(kai.endsWith(hanziStack('serif', 'ja', none))).toBe(true);
	});

	it('an unknown language gets the generic families', () => {
		expect(hanziStack('sans', 'en', none)).toBe('sans-serif');
		expect(hanziStack('serif', 'en', none)).toBe('serif');
		expect(hanziStack('kai', 'en', none)).toBe('serif');
	});

	it('an installed pack face comes first, for its script only', () => {
		const installed = installedFaces([
			{ face: 'kai', script: 'Hans' },
			{ face: 'sans', script: 'Jpan' }
		]);
		expect(parts(hanziStack('kai', 'zh', installed))[0]).toBe('"qq-kai-Hans"');
		expect(hanziStack('kai', 'zh', installed).endsWith(hanziStack('kai', 'zh', none))).toBe(true);
		expect(hanziStack('kai', 'zh-Hant', installed)).toBe(hanziStack('kai', 'zh-Hant', none));
		expect(parts(hanziStack('sans', 'ja', installed))[0]).toBe('"qq-sans-Jpan"');
		expect(hanziStack('serif', 'ja', installed)).toBe(hanziStack('serif', 'ja', none));
		expect(hanziStack('sans', 'en', installed)).toBe('sans-serif');
	});

	it('packFamily names the FontFace family of a face and script', () => {
		const faces: HanziFace[] = ['sans', 'serif', 'kai'];
		expect(faces.map((f) => packFamily(f, 'Hant'))).toEqual(['qq-sans-Hant', 'qq-serif-Hant', 'qq-kai-Hant']);
	});
});
