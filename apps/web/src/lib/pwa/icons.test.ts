import { describe, expect, it } from 'vitest';
import { encodePng, rasterize } from '../../../scripts/icons/raster.mjs';
import { ICONS, faviconSvg, markShapes } from '../../../scripts/icons/shapes.mjs';
import icon192 from '../../../static/icons/icon-192.png?inline';
import icon512 from '../../../static/icons/icon-512.png?inline';
import maskable512 from '../../../static/icons/maskable-512.png?inline';
import appleTouch from '../../../static/icons/apple-touch-icon.png?inline';
import faviconShipped from '../../../static/favicon.svg?raw';

const COMMITTED: Record<string, string> = {
	'icons/icon-192.png': icon192,
	'icons/icon-512.png': icon512,
	'icons/maskable-512.png': maskable512,
	'icons/apple-touch-icon.png': appleTouch
};

function fromDataUrl(url: string): Uint8Array {
	const bin = atob(url.slice(url.indexOf(',') + 1));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Test helper: decode a PNG written by encodePng (8-bit RGBA, filter 0 only). */
async function decodePng(png: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8Array }> {
	expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	let pos = 8;
	let width = 0;
	let height = 0;
	const idat: Uint8Array[] = [];
	while (pos < png.length) {
		const len = view.getUint32(pos);
		const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
		const body = png.subarray(pos + 8, pos + 8 + len);
		if (type === 'IHDR') {
			width = view.getUint32(pos + 8);
			height = view.getUint32(pos + 12);
			expect(body[8]).toBe(8);
			expect(body[9]).toBe(6);
		}
		if (type === 'IDAT') idat.push(body);
		pos += 12 + len;
	}
	const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const c of idat) {
		joined.set(c, at);
		at += c.length;
	}
	const raw = await inflate(joined);
	const rgba = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		expect(raw[y * (width * 4 + 1)]).toBe(0);
		rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
	}
	return { width, height, rgba };
}

describe('png encoder', () => {
	it('round-trips known pixels', async () => {
		const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 8, 7, 255]);
		const decoded = await decodePng(encodePng(2, 2, pixels));
		expect([decoded.width, decoded.height]).toEqual([2, 2]);
		expect([...decoded.rgba]).toEqual([...pixels]);
	});

	it('writes valid chunk CRCs', () => {
		const png = encodePng(1, 1, new Uint8Array([1, 2, 3, 255]));
		// IHDR CRC over type + 13 header bytes, computed independently here
		let crc = ~0;
		for (const b of png.subarray(12, 29)) {
			crc ^= b;
			for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
		}
		expect(new DataView(png.buffer, png.byteOffset).getUint32(29)).toBe(~crc >>> 0);
	});
});

describe('rasterize', () => {
	it('paints a filled square and leaves the corner transparent', () => {
		const px = rasterize(8, 8, [{ type: 'rrect', x: 0, y: 0, w: 1, h: 1, r: 0.5, color: [10, 20, 30] }]);
		const at = (x: number, y: number) => [...px.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
		expect(at(4, 4)).toEqual([10, 20, 30, 255]);
		expect(at(0, 0)[3]).toBe(0);
	});
});

describe('committed icons', () => {
	it('match a regeneration (decoded pixels and header, not zlib bytes)', async () => {
		for (const icon of ICONS) {
			const fresh = rasterize(icon.size, icon.size, markShapes({ maskable: icon.maskable }));
			const committed = await decodePng(fromDataUrl(COMMITTED[icon.file]));
			expect(committed.width).toBe(icon.size);
			expect(committed.height).toBe(icon.size);
			expect([...committed.rgba]).toEqual([...fresh]);
		}
	});

	it('maskable icon is full-bleed (opaque corners)', async () => {
		const m = await decodePng(fromDataUrl(maskable512));
		expect(m.rgba[3]).toBe(255);
	});

	it('favicon.svg is committed, self-contained and has no text', () => {
		expect(faviconShipped).toBe(faviconSvg());
		expect(faviconShipped).not.toMatch(/<text|href=|url\(|<image|<script/);
	});
});
