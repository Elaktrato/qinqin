import { describe, expect, it } from 'vitest';
import { levelAttributionLine } from './levelAttribution';

describe('levelAttributionLine', () => {
	it('joins the attribution and licence', () => {
		expect(levelAttributionLine({ attribution: 'kanjiapi.dev jlpt.tsv', license: 'MIT' })).toBe(
			'Levels: kanjiapi.dev jlpt.tsv · MIT'
		);
	});

	it('carries the source wording a pack puts in its attribution', () => {
		const line = levelAttributionLine({
			attribution:
				'Source: www.chinesetest.cn — reproduced from the Chinese Test Service Website (CTI); syllabus published by CLEC',
			license: 'See CTI Legal Notice; no reuse licence granted'
		});
		expect(line).toBe(
			'Levels: Source: www.chinesetest.cn — reproduced from the Chinese Test Service Website (CTI); syllabus published by CLEC · See CTI Legal Notice; no reuse licence granted'
		);
	});

	it('shows just the licence when the attribution is empty, and the reverse', () => {
		expect(levelAttributionLine({ attribution: '  ', license: 'CC0-1.0' })).toBe('Levels: CC0-1.0');
		expect(levelAttributionLine({ attribution: 'My list', license: '' })).toBe('Levels: My list');
		expect(levelAttributionLine({ attribution: undefined, license: 'MIT' })).toBe('Levels: MIT');
	});

	it('has no line without a scheme or without either field', () => {
		expect(levelAttributionLine(null)).toBeNull();
		expect(levelAttributionLine(undefined)).toBeNull();
		expect(levelAttributionLine({ attribution: '', license: undefined })).toBeNull();
	});

	it('keeps long text whole (the page wraps it)', () => {
		const long = 'x'.repeat(400);
		expect(levelAttributionLine({ attribution: long, license: 'MIT' })).toBe(`Levels: ${long} · MIT`);
	});
});
