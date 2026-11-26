import { readFileSync } from 'node:fs';
// The qinqin mark: the qinqin logo (src/lib/assets/qinqin-logo.svg, one path) in white on a brand-blue
// rounded square. The logo is the single source; the same file makes the favicon and the Android launcher icon.
export const BLUE = [11, 107, 203];
const WHITE = [255, 255, 255];

export const ICONS = [
	{ file: 'icons/icon-192.png', size: 192, maskable: false },
	{ file: 'icons/icon-512.png', size: 512, maskable: false },
	{ file: 'icons/maskable-512.png', size: 512, maskable: true },
	{ file: 'icons/apple-touch-icon.png', size: 180, maskable: true }
];

/** The logo's outlines as polygons in the logo's own 1080 x 1080 coordinates. */
export function logoSubpaths() {
	const subpaths = [];
	for (const [, cmd, args] of logoPath().matchAll(/([MLZz])([^MLZz]*)/g)) {
		if (cmd === 'M') subpaths.push([]);
		if (cmd === 'M' || cmd === 'L') {
			const n = args.match(/-?\d*\.?\d+/g).map(Number);
			for (let i = 0; i < n.length; i += 2) subpaths[subpaths.length - 1].push([n[i], n[i + 1]]);
		}
	}
	return subpaths;
}

/**
 * markShapes returns the mark in unit coordinates: the blue square and the logo, centred, `height` of the icon
 * tall. The maskable variant is full-bleed with the logo inside the central 80 % safe zone (launchers crop it).
 * The Apple touch icon uses it too: iOS rounds the corners itself.
 */
export function markShapes({ maskable = false } = {}) {
	const bg = { type: 'rrect', x: 0, y: 0, w: 1, h: 1, r: maskable ? 0 : 0.22, color: BLUE };
	const subpaths = logoSubpaths();
	const all = subpaths.flat();
	const y0 = Math.min(...all.map((p) => p[1]));
	const y1 = Math.max(...all.map((p) => p[1]));
	const cx = (Math.min(...all.map((p) => p[0])) + Math.max(...all.map((p) => p[0]))) / 2;
	const cy = (y0 + y1) / 2;
	const scale = (maskable ? 0.5 : 0.62) / (y1 - y0);
	const fit = ([x, y]) => [0.5 + (x - cx) * scale, 0.5 + (y - cy) * scale];
	return [bg, { type: 'poly', subpaths: subpaths.map((sp) => sp.map(fit)), color: WHITE }];
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/** The logo's outline (one path, 1080 x 1080 viewBox), read from the single source file. */
export function logoPath() {
	const svg = readFileSync(new URL('../../src/lib/assets/qinqin-logo.svg', import.meta.url), 'utf8');
	const m = /<path d="([^"]+)"/.exec(svg);
	if (!m) throw new Error('qinqin-logo.svg has no path');
	return m[1];
}

/** Theme-aware favicon: dark mark on light browser chrome, light mark on dark chrome. */
export function faviconSvg() {
	return (
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080">' +
		'<style>path{fill:#111827}@media (prefers-color-scheme:dark){path{fill:#f9fafb}}</style>' +
		`<path d="${logoPath()}"/></svg>\n`
	);
}
