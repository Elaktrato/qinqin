// Writes static/icons/*.png and static/favicon.svg from scripts/icons/shapes.mjs.
// Run: node scripts/make-icons.mjs (outputs are committed; a test compares them).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, rasterize } from './icons/raster.mjs';
import { ICONS, faviconSvg, markShapes } from './icons/shapes.mjs';

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');
mkdirSync(join(dest, 'icons'), { recursive: true });
for (const icon of ICONS) {
	const rgba = rasterize(icon.size, icon.size, markShapes({ maskable: icon.maskable }));
	writeFileSync(join(dest, icon.file), encodePng(icon.size, icon.size, rgba));
}
writeFileSync(join(dest, 'favicon.svg'), faviconSvg());
console.log('icons written');
