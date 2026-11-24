import { describe, expect, it } from 'vitest';
import { featurePageImports, setsTitle } from './routeTitles';

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

describe('featurePageImports', () => {
	const index = `import APage from '$lib/features/a/APage.svelte';
import BPage from '$lib/features/b/BPage.svelte';
import W from '$lib/features/a/Widget.svelte';
export const coreFeatures = [
	feature(A_ID, 'features.a.title', aDef, APage),
	feature(B_ID, 'features.b.title', bDef, BPage)
];`;

	it('resolves the components registered as core feature pages to paths under src/lib', () => {
		expect(featurePageImports(index)).toEqual(['features/a/APage.svelte', 'features/b/BPage.svelte']);
	});

	it('fails loudly when a page component has no $lib import', () => {
		expect(() => featurePageImports("\tfeature(X_ID, 'x', xDef, Missing)")).toThrow(/Missing/);
	});
});
