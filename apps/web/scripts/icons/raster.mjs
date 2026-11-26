// A tiny rasteriser for the app icons: filled rounded rectangles and filled
// polygons (non-zero winding, like an SVG path) in unit coordinates, 4x4
// supersampling, PNG written with node:zlib. No dependency.
import { deflateSync } from 'node:zlib';

/** Sorted edge crossings of a polygon shape on every supersampled row (built once per rasterize call). */
function polyRows(shape, rows) {
	const out = Array.from({ length: rows }, () => []);
	for (const sp of shape.subpaths) {
		for (let i = 0; i < sp.length; i++) {
			const [x1, y1] = sp[i];
			const [x2, y2] = sp[(i + 1) % sp.length];
			if (y1 === y2) continue;
			const lo = Math.min(y1, y2);
			const hi = Math.max(y1, y2);
			const first = Math.max(0, Math.ceil(lo * rows - 0.5));
			const last = Math.min(rows - 1, Math.ceil(hi * rows - 0.5) - 1);
			for (let r = first; r <= last; r++) {
				const yy = (r + 0.5) / rows;
				out[r].push([x1 + ((yy - y1) * (x2 - x1)) / (y2 - y1), y2 > y1 ? 1 : -1]);
			}
		}
	}
	for (const r of out) r.sort((a, b) => a[0] - b[0]);
	return out;
}

function insidePoly(crossings, px) {
	let w = 0;
	for (const [cx, dir] of crossings) {
		if (cx > px) break;
		w += dir;
	}
	return w !== 0;
}

function inside(shape, px, py, row) {
	if (shape.type === 'poly') return insidePoly(shape.rows[row], px);
	const { x, y, w, h } = shape;
	if (px < x || px >= x + w || py < y || py >= y + h) return false;
	const r = Math.min(shape.r, w / 2, h / 2);
	const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
	const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
	return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/** rasterize paints `shapes` in order (later on top); returns non-premultiplied RGBA. */
export function rasterize(width, height, shapes, supersample = 4) {
	const out = new Uint8Array(width * height * 4);
	const n = supersample * supersample;
	shapes = shapes.map((sh) => (sh.type === 'poly' ? { ...sh, rows: polyRows(sh, height * supersample) } : sh));
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let sy = 0; sy < supersample; sy++) {
				for (let sx = 0; sx < supersample; sx++) {
					const ux = (x + (sx + 0.5) / supersample) / width;
					const uy = (y + (sy + 0.5) / supersample) / height;
					for (let i = shapes.length - 1; i >= 0; i--) {
						if (inside(shapes[i], ux, uy, y * supersample + sy)) {
							[r, g, b] = [r + shapes[i].color[0], g + shapes[i].color[1], b + shapes[i].color[2]];
							a++;
							break;
						}
					}
				}
			}
			const o = (y * width + x) * 4;
			if (a > 0) {
				out[o] = Math.round(r / a);
				out[o + 1] = Math.round(g / a);
				out[o + 2] = Math.round(b / a);
			}
			out[o + 3] = Math.round((255 * a) / n);
		}
	}
	return out;
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buf) {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(type, 4, 'ascii');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
	return Buffer.concat([head, body, crc]);
}

/** encodePng writes an 8-bit RGBA PNG (filter 0 on every row). */
export function encodePng(width, height, rgba) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}
