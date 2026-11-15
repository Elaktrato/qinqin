// Test double for `$app/state`: a reactive `page` the tests can navigate
// by calling `setUrl`. Used with `vi.mock('$app/state', ...)` in
// component tests (see docs/superpowers/plans/2026-11-15-web-polish.md).

export const page = $state({ url: new URL('http://localhost/') });

export function setUrl(href: string): void {
	page.url = new URL(href, 'http://localhost');
}
