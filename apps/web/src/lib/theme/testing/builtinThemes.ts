// Test support: every built-in theme (server/internal/themes/builtin/*/themes.json),
// and a colour drawn at a percentage over a surface (the `alpha(c, p)` of the
// derivation contract, as the browser composites `#rrggbbaa`).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Theme } from '../types';

const dir = resolve(__dirname, '../../../../../../server/internal/themes/builtin');

export const BUILTIN_THEMES: readonly Theme[] = readdirSync(dir, { withFileTypes: true })
	.filter((e) => e.isDirectory())
	.map((e) => e.name)
	.sort()
	.flatMap((pack) => JSON.parse(readFileSync(join(dir, pack, 'themes.json'), 'utf8')) as Theme[]);

const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** over: `#rrggbb` or `#rrggbbaa` drawn over the opaque `bg`, as `#rrggbb`. */
export function over(fg: string, bg: string): string {
	const a = fg.length === 9 ? parseInt(fg.slice(7, 9), 16) / 255 : 1;
	const f = channels(fg);
	const b = channels(bg);
	return '#' + f.map((v, i) => Math.round(v * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}

/** hueOf: the HSL hue of `#rrggbb` in degrees (0 for a grey). */
export function hueOf(hex: string): number {
	const [r, g, b] = channels(hex);
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	if (d === 0) return 0;
	const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return h * 60;
}
