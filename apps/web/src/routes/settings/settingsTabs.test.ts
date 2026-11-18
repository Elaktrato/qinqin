// The Settings tab row (#106): the base Tabs component in its in-page form owns the tabs, their keyboard model
// and the selected tab's 2px accent underline (Tabs.dom.test.ts). The page lets the base row wrap and never
// paints tabs of its own — a person who forces Light on a dark OS used to get the dark-scheme tab blue here
// (#98 PART B, B2a); tokens follow the painted theme.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(__dirname, '+page.svelte'), 'utf8');
const style = (page.match(/<style[^>]*>([\s\S]*?)<\/style>/) ?? ['', ''])[1].replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the rule whose selector contains this text. */
function rule(selector: string): string {
	const at = style.indexOf(selector);
	expect(at, selector).toBeGreaterThanOrEqual(0);
	return style.slice(at, style.indexOf('}', at));
}

describe('settings tabs in the lighter look', () => {
	it('no style follows the OS colour scheme', () => {
		expect(page).not.toMatch(/prefers-color-scheme/);
	});

	it('delegates the tab row to the base Tabs component', () => {
		expect(page).toMatch(/import \{[^}]*\bTabs\b[^}]*\} from '\$lib\/ui'/);
		expect(page).not.toMatch(/role="tablist"/);
		expect(page).not.toMatch(/role="tabpanel"/);
	});

	it('lets the base tab row wrap instead of scrolling', () => {
		expect(style).not.toMatch(/overflow-x:\s*auto/);
		expect(style).not.toMatch(/scrollbar-width/);
		expect(style).not.toMatch(/flex-wrap:\s*nowrap/);
		expect(page).toMatch(/\[role='tab'\][^{]*\{[^}]*white-space:\s*nowrap/);
	});
});
