import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// One main landmark per page (#99): the frame's <main id="main-content">
// (the skip link's target) holds every route; no page, layout or component
// brings its own. A source walk, so it covers every route of the route list
// and every component a route renders (they all live under src/).
const src = resolve(__dirname, '..');
const routes = resolve(src, 'routes');
const rootLayout = resolve(routes, '+layout.svelte');

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
		const path = join(dir, d.name);
		if (d.isDirectory()) return d.name === 'testing' ? [] : svelteFiles(path);
		return d.name.endsWith('.svelte') ? [path] : [];
	});
}

/** The markup without comments, scripts and styles. */
function markup(source: string): string {
	return source
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<script[\s\S]*?<\/script>/g, '')
		.replace(/<style[\s\S]*?<\/style>/g, '');
}

const mains = (source: string) => markup(source).match(/<main[\s>]/g)?.length ?? 0;
const roleMain = (source: string) => /role=["']main["']/.test(markup(source));

describe('the main landmark', () => {
	it('the root layout has exactly one <main>, the skip link target, around the page', () => {
		const layout = markup(readFileSync(rootLayout, 'utf8'));
		expect(mains(layout)).toBe(1);
		const main = layout.slice(layout.indexOf('<main'));
		expect(main).toMatch(/^<main[^>]*\bid="main-content"/);
		expect(main).toMatch(/^<main[^>]*\btabindex="-1"/);
		expect(main.slice(0, main.indexOf('</main>'))).toContain('{@render children()}');
		expect(layout).toContain('href="#main-content"');
	});

	const pages = svelteFiles(routes).filter((f) => f.endsWith('+page.svelte'));

	it('walks the route list', () => {
		const names = pages.map((p) => relative(routes, p));
		expect(names.length).toBeGreaterThanOrEqual(19);
		for (const known of ['+page.svelte', 'settings/+page.svelte', 'lookups/+page.svelte', 'account/password/+page.svelte']) {
			expect(names).toContain(known);
		}
	});

	it.each(pages.map((p) => [relative(routes, p), p]))('route %s brings no main of its own', (_name, page) => {
		const source = readFileSync(page, 'utf8');
		expect(mains(source)).toBe(0);
		expect(roleMain(source)).toBe(false);
	});

	const others = svelteFiles(src).filter((f) => f !== rootLayout && !f.endsWith('+page.svelte'));

	it.each(others.map((p) => [relative(src, p), p]))('%s brings no main (layouts and components a route renders)', (_name, file) => {
		const source = readFileSync(file, 'utf8');
		expect(mains(source)).toBe(0);
		expect(roleMain(source)).toBe(false);
	});
});
