import { describe, expect, it } from 'vitest';
import { pluginPageImports, setsTitle } from './routeTitles';

describe('setsTitle', () => {
	it('accepts a head title built with pageTitle', () => {
		expect(setsTitle('<svelte:head>\n\t<title>{pageTitle(\'Search\')}</title>\n</svelte:head>')).toBe(true);
		expect(setsTitle('<svelte:head><meta name="x" /><title>{pageTitle()}</title></svelte:head>')).toBe(true);
	});

	it('refuses a page without a head title', () => {
		expect(setsTitle('<main><h1>Search</h1></main>')).toBe(false);
		expect(setsTitle('<svelte:head><meta name="x" /></svelte:head>')).toBe(false);
	});

	it('refuses a title outside svelte:head or not built with pageTitle', () => {
		expect(setsTitle('<title>{pageTitle("x")}</title>')).toBe(false);
		expect(setsTitle('<svelte:head><title>Search</title></svelte:head>')).toBe(false);
		expect(setsTitle('<svelte:head><title>{`Search · qinqin`}</title></svelte:head>')).toBe(false);
	});

	it('ignores a commented-out head', () => {
		expect(setsTitle('<!-- <svelte:head><title>{pageTitle()}</title></svelte:head> -->')).toBe(false);
	});
});

describe('pluginPageImports', () => {
	const index = `import A from './a/APage.svelte';
import B from './b/BPage.svelte';
import W from './a/Widget.svelte';
export const webPlugins = [
	{ id: 'a', pages: [{ title: 'A', nav: true, component: A }], widgets: [{ component: W }] },
	{ id: 'b', pages: [{ title: 'B', nav: true, component: B }] }
];`;

	it('resolves the components registered as plugin pages to their import paths', () => {
		expect(pluginPageImports(index)).toEqual(['./a/APage.svelte', './b/BPage.svelte']);
	});

	it('fails loudly when a page component has no import', () => {
		expect(() => pluginPageImports("pages: [{ title: 'X', component: Missing }]")).toThrow(/Missing/);
	});
});
