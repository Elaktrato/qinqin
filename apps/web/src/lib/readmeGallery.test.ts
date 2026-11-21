import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(__dirname, '../../../..');
const readme = readFileSync(resolve(repo, 'README.md'), 'utf8');
const section = readme.split(/^## Screenshots$/m)[1]?.split(/^## /m)[0] ?? '';
const links = [...section.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map((m) => ({
	alt: m[1].trim(),
	path: m[2]
}));

const WANT = [
	'home-1440-latte.png',
	'session-1440-mocha.png',
	'reader-1440-rosepine-dawn.png',
	'reader-sheet-360-rosepine.png',
	'journal-1440-nord.png',
	'search-entry-1440-gruvbox.png',
	'stats-overview-1440-latte.png',
	'stats-characters-1024-gruvbox.png',
	'stats-week-360-mocha.png',
	'drawer-360-mocha.png',
	'decks-1024-macchiato.png',
	'settings-appearance-360-frappe.png',
	'sign-in-360-latte.png'
];

const dir = resolve(repo, 'docs/assets/screenshots');
const files = readdirSync(dir)
	.filter((name) => name.endsWith('.png'))
	.sort();

describe('README screenshot gallery', () => {
	it('links the 13 images in order, each with alt text', () => {
		expect(links.map((link) => link.path)).toEqual(
			WANT.map((name) => `docs/assets/screenshots/${name}`)
		);
		for (const link of links) expect(link.alt.length, link.path).toBeGreaterThan(0);
	});

	it('links every PNG in docs/assets/screenshots', () => {
		expect(files).toEqual([...WANT].sort());
	});

	it('keeps each image a PNG under 400 KB and the folder under 5 MB', () => {
		let total = 0;
		for (const name of files) {
			const path = resolve(dir, name);
			const size = statSync(path).size;
			expect(size, name).toBeLessThan(400 * 1024);
			expect(readFileSync(path).subarray(0, 8).toString('hex'), name).toBe('89504e470d0a1a0a');
			total += size;
		}
		expect(total).toBeLessThan(5 * 1024 * 1024);
	});
});
