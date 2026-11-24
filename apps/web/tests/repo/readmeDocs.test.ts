import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mdAnchors as anchors } from '$lib/testing/mdAnchors';

// Doc check for the README front page: its wiki links point at pages of docs/wiki (the wiki's source) and at
// headings that exist there, its links into the repository resolve, and it stays a short front page.
const root = resolve(__dirname, '../../../..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const WIKI = 'https://github.com/Elaktrato/qinqin/wiki';

const wikiLinks = [...readme.matchAll(/\]\((https:\/\/github\.com\/Elaktrato\/qinqin\/wiki[^)\s]*)\)/g)].map(
	(m) => m[1]
);

describe('README.md', () => {
	it('stays a short front page', () => {
		expect(readme.split('\n').length).toBeLessThan(220);
	});

	it('links the main wiki pages', () => {
		expect(wikiLinks.length).toBeGreaterThan(20);
		for (const page of ['Getting-started', 'Admin-deploying', 'Admin-upgrading', 'Admin-backup-and-recovery', 'API-Reference', 'Development'])
			expect(wikiLinks, page).toContain(`${WIKI}/${page}`);
	});

	it.each(wikiLinks)('%s points at an existing wiki page and heading', (link) => {
		const rest = link.slice(WIKI.length);
		expect(rest === '' || rest.startsWith('/'), link).toBe(true);
		const [path, anchor] = rest.replace(/^\//, '').split('#');
		const page = path === '' ? 'Home' : path;
		const file = resolve(root, 'docs/wiki', `${page}.md`);
		expect(existsSync(file), `${link}: no docs/wiki/${page}.md`).toBe(true);
		if (anchor !== undefined) {
			expect(anchors(readFileSync(file, 'utf8')).has(anchor), `${link}: no heading #${anchor}`).toBe(true);
		}
	});

	it('links only repository files that exist', () => {
		for (const m of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
			const target = m[1];
			if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
			expect(existsSync(resolve(root, target.split('#')[0])), target).toBe(true);
		}
	});

	it('names the code licence state and points at the licence reference', () => {
		expect(readme).toContain('docs/sources.md');
		expect(readme).toMatch(/Sources\*\* page/);
		const hasLicence = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].some((f) => existsSync(resolve(root, f)));
		if (hasLicence) expect(readme).not.toMatch(/no licence file/);
		else expect(readme).toMatch(/no licence file/);
	});
});

describe('the anchor rule', () => {
	it('follows GitHub for punctuation, code and repeats', () => {
		const a = anchors('# A\n## Rotating `QINQIN_SECRET`\n## Users (Admin → Users)\n## A\n```\n# not a heading\n```');
		expect([...a]).toEqual(['a', 'rotating-qinqin_secret', 'users-admin--users', 'a-1']);
	});
});
