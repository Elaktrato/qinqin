// The forced-mode regression (#98 PART B, B2a): a person who forces Light on a dark OS (appearance `mode: "light"`)
// used to get the dark-scheme tab blue (#6cb4ff) on the light theme — the selected Settings tab dropped to about
// 2:1. The tabs now paint from the theme tokens only, which follow the painted theme whatever the OS prefers. jsdom
// computes no colours, so this pins the source; the measured contrast is in the plan's Execution record (B5).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(__dirname, '+page.svelte'), 'utf8');
const style = (page.match(/<style[^>]*>([\s\S]*?)<\/style>/) ?? ['', ''])[1].replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the rule with exactly this selector. */
function rule(selector: string): string {
	const at = style.indexOf(selector + ' {');
	expect(at, selector).toBeGreaterThanOrEqual(0);
	return style.slice(at, style.indexOf('}', at));
}

describe('settings tabs follow the painted theme', () => {
	it('no style follows the OS colour scheme', () => {
		expect(page).not.toMatch(/prefers-color-scheme/);
	});

	it('the selected tab is text-coloured with a 2px accent underline', () => {
		const selected = rule(".settings .tabs [role='tab'][aria-selected='true']");
		expect(selected).toMatch(/color:\s*var\(--text\)/);
		expect(selected).toMatch(/border-bottom-color:\s*var\(--accent\)/);
		expect(selected).not.toMatch(/#[0-9a-f]{3,8}\b/i);
	});

	it('the other tabs are readable muted text, not faded', () => {
		const tab = rule(".settings .tabs [role='tab']");
		expect(tab).toMatch(/color:\s*var\(--readable-muted\)/);
		expect(tab).not.toMatch(/opacity/);
	});
});
