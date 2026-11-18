import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGES } from './pages';

const web = resolve(__dirname, '../../../');
const routesDir = join(web, 'routes');
const src = resolve(__dirname, '../../..');

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...walk(p));
		else if (e.name === '+page.svelte' || e.name === '+page.ts') out.push(p.slice(routesDir.length + 1));
	}
	return out;
}

const pages = walk(routesDir).sort();
const routeOf = (file: string): string => {
	const dir = file.replace(/\/?\+page\.(svelte|ts)$/, '');
	return dir === '' ? '/' : `/${dir}`;
};

describe('the page manifest (#106)', () => {
	it('every +page.svelte and +page.ts under src/routes is in PAGES', () => {
		const listed = new Set(PAGES.map((p) => p.route));
		expect(pages.map(routeOf).filter((r) => !listed.has(r))).toEqual([]);
	});

	it('every PAGES route exists', () => {
		const found = new Set(pages.map(routeOf));
		expect(PAGES.map((p) => p.route).filter((r) => !found.has(r))).toEqual([]);
	});

	it('every listed file exists', () => {
		expect(PAGES.flatMap((p) => p.files).filter((f) => !existsSync(join(src, f)))).toEqual([]);
	});

	it('every #106 page has at least one view', () => {
		expect(PAGES.filter((p) => p.owner === '#106' && p.views.length === 0).map((p) => p.route)).toEqual([]);
	});

	it('routes owned by other items name the issue', () => {
		for (const page of PAGES) {
			if (page.owner === 'none' || page.owner === '#106') continue;
			expect(page.owner, page.route).toMatch(/^#\d+$/);
		}
	});
});
