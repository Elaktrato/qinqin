import { describe, expect, it } from 'vitest';
import { localLicensePath } from '$lib/sources/credits';
import { webPlugins } from '../index';
import { journalManifest } from './manifest';

const statics = import.meta.glob('../../../../static/*.TXT', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

describe('journalManifest', () => {
	it('identifies the plugin', () => {
		expect(journalManifest.id).toBe('qinqin-journal');
		expect(journalManifest.surfaces).toEqual(['page']);
	});

	it('is registered with a nav page', () => {
		const entry = webPlugins.find((p) => p.manifest.id === 'qinqin-journal');
		expect(entry?.pages?.[0]).toMatchObject({ title: 'Journal', nav: true });
	});

	it('credits Tesseract, Leptonica and the Anthropic SDK with licences', () => {
		const names = (journalManifest.sources ?? []).map((s) => s.name);
		expect(names).toEqual(['Tesseract OCR', 'Leptonica', 'Anthropic Go SDK']);
		for (const credit of journalManifest.sources ?? []) {
			expect(credit.license).toBeTruthy();
			expect(credit.url?.startsWith('https://')).toBe(true);
		}
	});

	it('serves every licence text from static/', () => {
		const files = Object.keys(statics).map((p) => '/' + p.split('/').pop());
		for (const credit of journalManifest.sources ?? []) {
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
