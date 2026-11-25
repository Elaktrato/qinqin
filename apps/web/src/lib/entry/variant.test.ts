import { describe, expect, it } from 'vitest';
import { variantLabel } from './variant';

describe('variantLabel (#104)', () => {
	it('labels a form flagged trad as traditional', () => {
		expect(
			variantLabel(
				{ language: 'zh', written: '发', forms: [{ text: '发' }, { text: '發', flags: ['trad'] }] },
				{ written: '發' }
			)
		).toBe('traditional');
	});

	it('labels the partner simplified when the entry itself is the trad form', () => {
		expect(
			variantLabel(
				{ language: 'zh', written: '發', forms: [{ text: '發', flags: ['trad'] }, { text: '发' }] },
				{ written: '发' }
			)
		).toBe('simplified');
	});

	it('says variant when the flags cannot tell', () => {
		expect(variantLabel({ language: 'zh', written: '发', forms: [] }, { written: '發' })).toBe('variant');
	});

	it('never labels a Japanese form traditional or simplified', () => {
		expect(
			variantLabel(
				{ language: 'ja', written: 'こと', forms: [{ text: '事', flags: ['trad'] }] },
				{ written: '事' }
			)
		).toBe('variant');
	});

	it('follows the language profile: a regional Chinese tag has variants (#199)', () => {
		expect(
			variantLabel({ language: 'zh-TW', written: '发', forms: [{ text: '發', flags: ['trad'] }] }, { written: '發' })
		).toBe('traditional');
	});
});
