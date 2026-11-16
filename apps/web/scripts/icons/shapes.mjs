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

export function faviconSvg() {
	const rects = markShapes()
		.map(
			(s) =>
				`<rect x="${+(s.x * 64).toFixed(2)}" y="${+(s.y * 64).toFixed(2)}" width="${+(s.w * 64).toFixed(2)}" height="${+(s.h * 64).toFixed(2)}" rx="${+(s.r * 64).toFixed(2)}" fill="${hex(s.color)}"/>`
		)
		.join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${rects}</svg>\n`;
}
