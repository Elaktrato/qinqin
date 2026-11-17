// Minimal SFNT (TrueType/OpenType) reading and writing for
// scripts/prepare-font-pack.mjs: the table directory, the cmap (formats 4
// and 12), the name table, the wght axis of fvar and OS/2's weight class.
// Pure JavaScript, no dependency: the renaming the OFL asks of a modified
// version (plan Ruling 3) rewrites the name table of each subset slice
// before it is compressed to WOFF2.

/** parseSfnt splits a font into its tables: {version, tables: Map<tag, Buffer>}. */
export function parseSfnt(buf) {
	const b = Buffer.from(buf);
	const version = b.readUInt32BE(0);
	if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) {
		throw new Error('not a TrueType/OpenType font (a collection or a web font must be converted first)');
	}
	const n = b.readUInt16BE(4);
	const tables = new Map();
	for (let i = 0; i < n; i++) {
		const rec = 12 + i * 16;
		const tag = b.toString('latin1', rec, rec + 4);
		const offset = b.readUInt32BE(rec + 8);
		const length = b.readUInt32BE(rec + 12);
		if (offset + length > b.length) throw new Error(`table ${tag} runs past the end of the font`);
		tables.set(tag, b.subarray(offset, offset + length));
	}
	return { version, tables };
}

function checksum(buf) {
	let sum = 0;
	const padded = buf.length % 4 === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]);
	for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
	return sum;
}

/** buildSfnt writes a font from its tables (sorted by tag) with fresh checksums and head.checkSumAdjustment. */
export function buildSfnt({ version, tables }) {
	const tags = [...tables.keys()].sort();
	const n = tags.length;
	let pow = 1;
	let log = 0;
	while (pow * 2 <= n) {
		pow *= 2;
		log++;
	}
	const header = Buffer.alloc(12 + n * 16);
	header.writeUInt32BE(version, 0);
	header.writeUInt16BE(n, 4);
	header.writeUInt16BE(pow * 16, 6);
	header.writeUInt16BE(log, 8);
	header.writeUInt16BE(n * 16 - pow * 16, 10);
	const bodies = [];
	let offset = header.length;
	let headOffset = -1;
	tags.forEach((tag, i) => {
		let data = Buffer.from(tables.get(tag));
		if (tag === 'head') {
			data = Buffer.from(data);
			data.writeUInt32BE(0, 8); // checkSumAdjustment is computed last
			headOffset = offset;
		}
		const rec = 12 + i * 16;
		header.write(tag, rec, 'latin1');
		header.writeUInt32BE(checksum(data), rec + 4);
		header.writeUInt32BE(offset, rec + 8);
		header.writeUInt32BE(data.length, rec + 12);
		const pad = (4 - (data.length % 4)) % 4;
		bodies.push(data, Buffer.alloc(pad));
		offset += data.length + pad;
	});
	const out = Buffer.concat([header, ...bodies]);
	if (headOffset >= 0) out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, headOffset + 8);
	return out;
}

/** readCmap returns the sorted code points the font maps to a glyph other than .notdef. */
export function readCmap(cmap) {
	const points = new Set();
	const n = cmap.readUInt16BE(2);
	const seen = new Set();
	for (let i = 0; i < n; i++) {
		const platform = cmap.readUInt16BE(4 + i * 8);
		const encoding = cmap.readUInt16BE(6 + i * 8);
		const offset = cmap.readUInt32BE(8 + i * 8);
		const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
		if (!unicode || seen.has(offset)) continue;
		seen.add(offset);
		const format = cmap.readUInt16BE(offset);
		if (format === 4) readFormat4(cmap, offset, points);
		else if (format === 12) readFormat12(cmap, offset, points);
	}
	return [...points].sort((a, b) => a - b);
}

function readFormat4(b, off, out) {
	const segX2 = b.readUInt16BE(off + 6);
	const ends = off + 14;
	const starts = ends + segX2 + 2;
	const deltas = starts + segX2;
	const rangeOffsets = deltas + segX2;
	for (let s = 0; s < segX2; s += 2) {
		const end = b.readUInt16BE(ends + s);
		const start = b.readUInt16BE(starts + s);
		const delta = b.readInt16BE(deltas + s);
		const ro = b.readUInt16BE(rangeOffsets + s);
		for (let c = start; c <= end && c !== 0xffff; c++) {
			let glyph;
			if (ro === 0) glyph = (c + delta) & 0xffff;
			else {
				const g = b.readUInt16BE(rangeOffsets + s + ro + (c - start) * 2);
				glyph = g === 0 ? 0 : (g + delta) & 0xffff;
			}
			if (glyph !== 0) out.add(c);
		}
	}
}

function readFormat12(b, off, out) {
	const groups = b.readUInt32BE(off + 12);
	for (let i = 0; i < groups; i++) {
		const g = off + 16 + i * 12;
		const start = b.readUInt32BE(g);
		const end = b.readUInt32BE(g + 4);
		const glyph = b.readUInt32BE(g + 8);
		for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) out.add(c);
	}
}

/** readNames returns the name records as {platformID, encodingID, languageID, nameID, value}. */
export function readNames(name) {
	const count = name.readUInt16BE(2);
	const strings = name.readUInt16BE(4);
	const out = [];
	for (let i = 0; i < count; i++) {
		const r = 6 + i * 12;
		const rec = {
			platformID: name.readUInt16BE(r),
			encodingID: name.readUInt16BE(r + 2),
			languageID: name.readUInt16BE(r + 4),
			nameID: name.readUInt16BE(r + 6)
		};
		const len = name.readUInt16BE(r + 8);
		const off = strings + name.readUInt16BE(r + 10);
		const raw = name.subarray(off, off + len);
		rec.value = rec.platformID === 0 || rec.platformID === 3 ? utf16be(raw) : raw.toString('latin1');
		out.push(rec);
	}
	return out;
}

function utf16be(raw) {
	const swapped = Buffer.from(raw);
	swapped.swap16();
	return swapped.toString('utf16le');
}

/** buildNames writes a format 0 name table of Windows Unicode BMP (3, 1) records in language 0x409. */
export function buildNames(records) {
	const sorted = [...records].sort((a, b) => a.nameID - b.nameID);
	const header = Buffer.alloc(6 + sorted.length * 12);
	header.writeUInt16BE(0, 0);
	header.writeUInt16BE(sorted.length, 2);
	header.writeUInt16BE(header.length, 4);
	const parts = [];
	let offset = 0;
	sorted.forEach((rec, i) => {
		const data = Buffer.from(rec.value, 'utf16le');
		data.swap16();
		const r = 6 + i * 12;
		header.writeUInt16BE(3, r);
		header.writeUInt16BE(1, r + 2);
		header.writeUInt16BE(0x409, r + 4);
		header.writeUInt16BE(rec.nameID, r + 6);
		header.writeUInt16BE(data.length, r + 8);
		header.writeUInt16BE(offset, r + 10);
		parts.push(data);
		offset += data.length;
	});
	return Buffer.concat([header, ...parts]);
}

/** weightOf is the CSS weight of a font: the fvar wght axis range ("100 900"), else OS/2 usWeightClass ("400"). */
export function weightOf(tables) {
	const fvar = tables.get('fvar');
	if (fvar) {
		const axesOffset = fvar.readUInt16BE(4);
		const axisCount = fvar.readUInt16BE(8);
		const axisSize = fvar.readUInt16BE(10);
		for (let i = 0; i < axisCount; i++) {
			const a = axesOffset + i * axisSize;
			if (fvar.toString('latin1', a, a + 4) === 'wght') {
				const min = Math.round(fvar.readInt32BE(a + 4) / 65536);
				const max = Math.round(fvar.readInt32BE(a + 12) / 65536);
				return min === max ? String(min) : `${min} ${max}`;
			}
		}
	}
	const os2 = tables.get('OS/2');
	return String(os2 ? os2.readUInt16BE(4) : 400);
}
