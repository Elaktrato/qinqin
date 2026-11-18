import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../app.css'), 'utf8');

describe('element base styles (#106)', () => {
	it('sets b and strong to the strong weight', () => {
		expect(css).toMatch(/b,\s*strong\s*\{[^}]*font-weight:\s*var\(--weight-strong\)/);
	});
	it('draws a round checkbox with a tick and sets accent-color on the other controls', () => {
		expect(css).toMatch(/input\[type='checkbox'\]\s*\{[^}]*appearance:\s*none[^}]*border-radius:\s*50%/);
		expect(css).toMatch(/input\[type='checkbox'\]::after\s*\{[^}]*border-inline-start:\s*2px solid var\(--accent\)/);
		expect(css).toMatch(/input\[type='radio'\],[\s\S]*accent-color:\s*var\(--accent\)/);
	});
	it('draws .ui-table with hairline rows and label-style headers', () => {
		expect(css).toMatch(/\.ui-table th,\s*\.ui-table td\s*\{[^}]*border-bottom:\s*1px solid var\(--hair\)/);
		expect(css).toMatch(/\.ui-table th\s*\{[^}]*font-weight:\s*var\(--weight-medium\)/);
	});
});
