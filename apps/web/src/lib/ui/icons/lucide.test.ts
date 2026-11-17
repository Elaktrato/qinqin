// The vendored icon data (scripts/vendor-icons.mjs) and its licence text.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICONS, LUCIDE_NAMES, LUCIDE_VERSION } from './lucide';
import { WANTED } from '../../../../scripts/vendor-icons.mjs';

const web = join(__dirname, '..', '..', '..', '..');
const GEOMETRY = new Set(['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'ry', 'x1', 'x2', 'y1', 'y2', 'points']);

describe('vendored Lucide icons', () => {
	it('holds exactly the icons the script wants, under our names', () => {
		expect(LUCIDE_NAMES).toEqual(WANTED);
		expect(Object.keys(ICONS)).toEqual(Object.keys(WANTED));
	});

	it('is the pinned lucide-static release, ISC, said in the header', () => {
		expect(LUCIDE_VERSION).toBe('1.66.0');
		const head = readFileSync(join(__dirname, 'lucide.ts'), 'utf8').split('\n')[0];
		expect(head).toBe(
			'// @license lucide-static v1.66.0 - ISC (static/LUCIDE-LICENSE.TXT; icons derived from Feather: MIT)'
		);
	});

	it('draws with geometry only: colour and stroke come from currentColor and Icon.svelte', () => {
		for (const [name, elements] of Object.entries(ICONS)) {
			expect(elements.length, name).toBeGreaterThan(0);
			for (const [tag, attrs] of elements) {
				expect(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'], name).toContain(tag);
				for (const [key, value] of Object.entries(attrs)) {
					if (key === 'fill') expect(['currentColor', 'none'], name).toContain(value);
					else expect(GEOMETRY.has(key), `${name}: ${key}`).toBe(true);
				}
			}
		}
	});

	it('ships the package licence verbatim (ISC, and MIT for the Feather-derived icons)', () => {
		const text = readFileSync(join(web, 'static', 'LUCIDE-LICENSE.TXT'));
		expect(createHash('sha256').update(text).digest('hex')).toBe(
			'b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57'
		);
		expect(text.toString()).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
		expect(text.toString()).toContain('Copyright (c) 2013-present Cole Bemis');
	});
});
