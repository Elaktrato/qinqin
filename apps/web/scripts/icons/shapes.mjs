import { readFileSync } from 'node:fs';
// The qinqin mark: a brand-blue rounded square with two white "seal" squares
// side by side (the doubled 勤勤), each crossed by one blue horizontal and one
// vertical stroke. Own geometric art, no font: licence-clean.
export const BLUE = [11, 107, 203];
const WHITE = [255, 255, 255];

export const ICONS = [
	{ file: 'icons/icon-192.png', size: 192, maskable: false },
	{ file: 'icons/icon-512.png', size: 512, maskable: false },
	{ file: 'icons/maskable-512.png', size: 512, maskable: true },
	{ file: 'icons/apple-touch-icon.png', size: 180, maskable: true }
];

function seal(x, y) {
	const s = 0.32;
	return [
		{ type: 'rrect', x, y, w: s, h: s, r: 0.05, color: WHITE },
		{ type: 'rrect', x: x + 0.05, y: y + s / 2 - 0.02, w: s - 0.1, h: 0.04, r: 0.02, color: BLUE },
		{ type: 'rrect', x: x + s / 2 - 0.02, y: y + 0.05, w: 0.04, h: s - 0.1, r: 0.02, color: BLUE }
	];
}

/**
 * markShapes returns the mark in unit coordinates. The maskable variant is
 * full-bleed with the seals inside the central 80 % safe zone (launchers crop it).
 * The Apple touch icon uses it too: iOS rounds the corners itself.
 */
export function markShapes({ maskable = false } = {}) {
	const bg = { type: 'rrect', x: 0, y: 0, w: 1, h: 1, r: maskable ? 0 : 0.22, color: BLUE };
	const seals = [...seal(0.17, 0.34), ...seal(0.51, 0.34)];
	if (!maskable) return [bg, ...seals];
	const t = (v) => 0.1 + 0.8 * v;
	return [
		bg,
		...seals.map((s) => ({ ...s, x: t(s.x), y: t(s.y), w: s.w * 0.8, h: s.h * 0.8, r: s.r * 0.8 }))
	];
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
