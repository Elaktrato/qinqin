// Static checks behind the route-walk title test (#12): every page sets a
// document title, built with pageTitle() so the format stays consistent.

/** setsTitle: the Svelte source has a <svelte:head> holding <title>{pageTitle(…)}. */
export function setsTitle(source: string): boolean {
	const code = source.replace(/<!--[\s\S]*?-->/g, '');
	for (const head of code.matchAll(/<svelte:head>([\s\S]*?)<\/svelte:head>/g)) {
		if (/<title>\s*\{\s*pageTitle\(/.test(head[1])) return true;
	}
	return false;
}

/**
 * pluginPageImports lists the import paths of the components registered as
 * plugin pages (`pages: [{ …, component: X }]`) in the plugin index source.
 */
export function pluginPageImports(indexSource: string): string[] {
	const imports = new Map<string, string>();
	for (const m of indexSource.matchAll(/^import\s+(\w+)\s+from\s+'([^']+)';/gm)) imports.set(m[1], m[2]);
	const out: string[] = [];
	for (const pages of indexSource.matchAll(/pages:\s*\[([\s\S]*?)\]/g)) {
		for (const c of pages[1].matchAll(/component:\s*(\w+)/g)) {
			const path = imports.get(c[1]);
			if (!path) throw new Error(`plugin page component ${c[1]} has no default import`);
			out.push(path);
		}
	}
	return out;
}
