import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from './app';
import { webPlugins } from './plugins';
import { pluginPageImports, setsTitle } from './testing/routeTitles';

// Route-walk (#12): every page in the route tree sets a document title
// with pageTitle(), itself or through an ancestor +layout.svelte, and so
// does every plugin page rendered by /p/[plugin]/[...rest]. A new route
// without a title fails here.
const web = resolve(__dirname, '../..');
const routes = resolve(web, 'src/routes');

function pages(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
		const path = join(dir, d.name);
		if (d.isDirectory()) return pages(path);
		return d.name === '+page.svelte' ? [path] : [];
	});
}

function titledByLayout(page: string): boolean {
	for (let dir = dirname(page); dir.startsWith(routes); dir = dirname(dir)) {
		const layout = join(dir, '+layout.svelte');
		if (existsSync(layout) && setsTitle(readFileSync(layout, 'utf8'))) return true;
	}
	return false;
}

const all = pages(routes).sort();

describe('document titles on every route', () => {
	it('walks the whole route tree', () => {
		const names = all.map((p) => relative(routes, p));
		// The walk must see the routes of today; an empty or broken glob cannot pass.
		expect(names.length).toBeGreaterThanOrEqual(19);
		for (const known of [
			'+page.svelte',
			'stats/week/+page.svelte',
			'search/parts/+page.svelte',
			'lookups/+page.svelte',
			'account/two-factor-setup/+page.svelte',
			'p/[plugin]/[...rest]/+page.svelte'
		]) {
			expect(names).toContain(known);
		}
	});

	it.each(all.map((p) => [relative(routes, p), p]))('%s sets a title', (_name, page) => {
		expect(setsTitle(readFileSync(page, 'utf8')) || titledByLayout(page)).toBe(true);
	});

	it('only the pinned pages rely on a layout title', () => {
		// A page that takes its title from a layout must be added here deliberately.
		const viaLayout = all.filter((p) => !setsTitle(readFileSync(p, 'utf8'))).map((p) => relative(routes, p));
		expect(viaLayout).toEqual(['stats/+page.svelte', 'stats/characters/+page.svelte', 'stats/week/+page.svelte']);
	});

	const index = resolve(web, 'src/lib/plugins/index.ts');
	const pluginPages = pluginPageImports(readFileSync(index, 'utf8')).map((p) => resolve(dirname(index), p));

	it('finds every registered plugin page', () => {
		// The source scan must see exactly the pages webPlugins registers, so a
		// page registered in another form cannot slip past the title check.
		const registered = webPlugins.flatMap((plugin) => plugin.pages ?? []);
		expect(registered.length).toBeGreaterThanOrEqual(4);
		expect(pluginPages).toHaveLength(registered.length);
	});

	it.each(pluginPages.map((p) => [relative(web, p), p]))('plugin page %s sets a title', (_name, page) => {
		expect(setsTitle(readFileSync(page, 'utf8'))).toBe(true);
	});

	it('app.html has the app name as the default title', () => {
		expect(readFileSync(resolve(web, 'src/app.html'), 'utf8')).toContain(`<title>${APP_NAME}</title>`);
	});
});
