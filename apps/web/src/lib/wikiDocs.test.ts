import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Doc check for the wiki source in docs/wiki: the sidebar and the page files
// agree, every internal link resolves, and the generated API pages are current.
const root = resolve(__dirname, '../../../..');
const wiki = resolve(root, 'docs/wiki');
const SPECIAL = new Set(['_Sidebar.md', '_Footer.md', 'README.md']);

const pages = readdirSync(wiki)
	.filter((f) => f.endsWith('.md') && !SPECIAL.has(f))
	.map((f) => f.slice(0, -3))
	.sort();

function internalLinks(md: string): string[] {
	const out: string[] = [];
	for (const m of md.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
		const target = m[1];
		if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
		out.push(target.split('#')[0]);
	}
	return out;
}

describe('docs/wiki', () => {
	const sidebar = readFileSync(resolve(wiki, '_Sidebar.md'), 'utf8');
	const linked = new Set(internalLinks(sidebar));

	it('finds the pages', () => {
		expect(pages).toContain('Home');
		expect(pages.length).toBeGreaterThan(10);
	});

	it('links only to pages that exist from the sidebar', () => {
		for (const name of linked) {
			expect(existsSync(resolve(wiki, `${name}.md`)), `sidebar links ${name}, no such page`).toBe(true);
		}
	});

	it.each(pages)('sidebar links %s', (name) => {
		expect(linked.has(name), `${name}.md is not linked from _Sidebar.md`).toBe(true);
	});

	it.each([...pages, '_Footer'])('internal links in %s resolve', (name) => {
		const md = readFileSync(resolve(wiki, `${name}.md`), 'utf8');
		for (const target of internalLinks(md)) {
			expect(existsSync(resolve(wiki, `${target}.md`)), `${name}.md links ${target}`).toBe(true);
		}
	});

	it('references no images', () => {
		for (const name of pages) {
			expect(readFileSync(resolve(wiki, `${name}.md`), 'utf8'), name).not.toMatch(/!\[/);
		}
	});

	it('has current generated API pages (scripts/gen-api-docs.mjs --check)', () => {
		const r = spawnSync(process.execPath, ['scripts/gen-api-docs.mjs', '--check'], {
			cwd: root,
			encoding: 'utf8'
		});
		expect(r.status, r.stderr).toBe(0);
	});
});

describe('API errors are translated by code (#73)', () => {
	const wiki = resolve(__dirname, '../../../../docs/wiki');
	it.each(['API-Errors.md', 'API-Overview.md'])('%s says clients show text by code and message stays English', (page) => {
		const text = readFileSync(resolve(wiki, page), 'utf8');
		expect(text).toMatch(/translat\w+ by (the )?(error )?code|by code/i);
		expect(text).toMatch(/message[^.]*English/);
	});
});
