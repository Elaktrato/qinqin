// The garden fills the width of its card with square cells (owner request
// 2026-11-19). jsdom cannot compute grid layout, so this pins the CSS rules
// the visual review depends on.

import { describe, expect, it } from 'vitest';
import source from './HeatmapGarden.svelte?raw';

describe('HeatmapGarden layout', () => {
	it('spreads the 13 weeks across the full width and keeps the cells square', () => {
		expect(source).toMatch(/grid-template-columns:\s*repeat\(13,\s*minmax\(0,\s*1fr\)\)/);
		expect(source).toMatch(/\.cell\s*\{[^}]*\bwidth:\s*100%/s);
		expect(source).toMatch(/\.cell\s*\{[^}]*\baspect-ratio:\s*1/s);
	});
});
