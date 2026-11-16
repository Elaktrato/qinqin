import { describe, expect, it } from 'vitest';
import { ICONS } from '../../../scripts/icons/shapes.mjs';
import appHtml from '../../app.html?raw';
import manifestRaw from '../../../static/manifest.webmanifest?raw';

interface Icon {
	src: string;
	sizes: string;
	type: string;
	purpose?: string;
}
const manifest = JSON.parse(manifestRaw) as Record<string, unknown> & { icons: Icon[] };

describe('web app manifest', () => {
	it('is installable: id, start_url, scope, standalone', () => {
		expect(manifest.id).toBe('/');
		expect(manifest.start_url).toBe('/');
		expect(manifest.scope).toBe('/');
		expect(manifest.display).toBe('standalone');
		expect(manifest.name).toBe('qinqin 勤勤');
		expect(manifest.short_name).toBe('qinqin');
		expect(manifest.theme_color).toBe('#0b6bcb');
		expect(manifest.background_color).toBe('#ffffff');
	});

	it('lists icons that exist with matching sizes, one maskable', () => {
		const known = new Map(ICONS.map((i) => [`/${i.file}`, i.size]));
		for (const icon of manifest.icons) {
			expect(known.has(icon.src), icon.src).toBe(true);
			expect(icon.sizes).toBe(`${known.get(icon.src)}x${known.get(icon.src)}`);
			expect(icon.type).toBe('image/png');
		}
		const sizes = manifest.icons.map((i) => `${i.sizes}/${i.purpose ?? 'any'}`).sort();
		expect(sizes).toEqual(['192x192/any', '512x512/any', '512x512/maskable']);
	});
});

describe('app.html head', () => {
	const once = (re: RegExp) => expect(appHtml.match(re)?.length).toBe(1);
	it('links the manifest, icons and theme colour exactly once', () => {
		once(/<link rel="manifest" href="\/manifest\.webmanifest"/g);
		once(/<link rel="icon" href="\/favicon\.svg"/g);
		once(/<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/g);
		once(/<meta name="theme-color" content="#0b6bcb"/g);
		once(/<meta name="mobile-web-app-capable" content="yes"/g);
	});
});
