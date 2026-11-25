import { describe, expect, it } from 'vitest';
import { localLicensePath } from '$lib/sources/credits';
import { coreFeatures } from '../index';
import { journalDef } from './manifest';

const statics = import.meta.glob('../../../../static/*.TXT', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

describe('journalDef', () => {
	it('is the core feature journal at /journal', () => {
		const entry = coreFeatures.find((f) => f.id === 'journal');
		expect(entry).toMatchObject({ slug: 'journal', href: '/journal', title: 'Journal' });
		expect(entry?.def).toBe(journalDef);
	});

	it('credits Tesseract, Leptonica and the Anthropic SDK with licences', () => {
		const names = (journalDef.sources ?? []).map((s) => s.name);
		expect(names).toEqual(['Tesseract OCR', 'Leptonica', 'Anthropic Go SDK']);
		for (const credit of journalDef.sources ?? []) {
			expect(credit.license).toBeTruthy();
			expect(credit.url?.startsWith('https://')).toBe(true);
		}
	});

	it('serves every licence text from static/', () => {
		const files = Object.keys(statics).map((p) => '/' + p.split('/').pop());
		for (const credit of journalDef.sources ?? []) {
			expect(credit.licenseTexts?.length).toBeGreaterThan(0);
			for (const text of credit.licenseTexts ?? []) {
				expect(localLicensePath(text.path)).toBe(text.path);
				expect(files).toContain(text.path);
			}
		}
	});
});

describe('journal components', () => {
	const files = import.meta.glob('./*.svelte', { query: '?raw', import: 'default', eager: true }) as Record<
		string,
		string
	>;

	it('finds the components', () => {
		expect(Object.keys(files).length).toBeGreaterThan(5);
	});

	it('never renders AI text as HTML', () => {
		for (const [name, src] of Object.entries(files)) {
			expect(src.includes('{@html'), name).toBe(false);
		}
	});
});
