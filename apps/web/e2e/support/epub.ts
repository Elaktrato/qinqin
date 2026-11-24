// A minimal epub (stored zip: mimetype first, container, package document,
// one chapter) for the reader tests; nothing is committed as a binary.

import { crc32 } from 'node:zlib';

interface ZipFile {
	name: string;
	data: Buffer;
}

function zip(files: ZipFile[]): Buffer {
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const f of files) {
		const name = Buffer.from(f.name, 'utf8');
		const crc = crc32(f.data) >>> 0;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(f.data.length, 18);
		local.writeUInt32LE(f.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		parts.push(local, name, f.data);
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50, 0);
		entry.writeUInt16LE(20, 4);
		entry.writeUInt16LE(20, 6);
		entry.writeUInt16LE(0x0800, 8);
		entry.writeUInt32LE(crc, 16);
		entry.writeUInt32LE(f.data.length, 20);
		entry.writeUInt32LE(f.data.length, 24);
		entry.writeUInt16LE(name.length, 28);
		entry.writeUInt32LE(offset, 42);
		central.push(entry, name);
		offset += local.length + name.length + f.data.length;
	}
	const dir = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(dir.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, dir, end]);
}

/** An epub with one chapter of the given paragraphs (plain text, no markup). */
export function epub(title: string, language: string, paragraphs: string[]): Buffer {
	const text = (s: string) => Buffer.from(s, 'utf8');
	return zip([
		{ name: 'mimetype', data: text('application/epub+zip') },
		{
			name: 'META-INF/container.xml',
			data: text(
				'<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
					'<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
			)
		},
		{
			name: 'OEBPS/content.opf',
			data: text(
				'<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">' +
					`<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">e2e-${title}</dc:identifier>` +
					`<dc:title>${title}</dc:title><dc:language>${language}</dc:language></metadata>` +
					'<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>' +
					'<spine><itemref idref="c1"/></spine></package>'
			)
		},
		{
			name: 'OEBPS/c1.xhtml',
			data: text(
				'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml">' +
					`<head><title>${title}</title></head><body>${paragraphs.map((p) => `<p>${p}</p>`).join('')}</body></html>`
			)
		}
	]);
}
