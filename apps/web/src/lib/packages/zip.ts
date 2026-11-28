// A small zip reader for package files (docs/contracts/packages/README.md, "The package file": Store or Deflate, no
// encryption). It reads the central directory, so the data descriptors the server's writer uses (sizes after the
// data) need no special case. Deflate goes through the platform's DecompressionStream ("deflate-raw"). Anything it
// does not know (zip64, encryption, another method, a name that is not UTF-8 or plain ASCII) is refused: a package
// is used whole or not at all.

export interface ZipMember {
	name: string;
	method: 0 | 8;
	compressedSize: number;
	size: number;
	/** Offset of the member's local header. */
	offset: number;
}

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** The end record is at most this far from the end (22 bytes plus a 64 KiB comment). */
const EOCD_SEARCH = 22 + 0xffff;

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** readZip lists the members of a zip file by name. Throws ZipError for a file it cannot read. */
export function readZip(bytes: Uint8Array): Map<string, ZipMember> {
	const v = view(bytes);
	let end = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - EOCD_SEARCH); i--) {
		if (v.getUint32(i, true) === EOCD) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new ZipError('no end of central directory');
	const count = v.getUint16(end + 10, true);
	const dirSize = v.getUint32(end + 12, true);
	let at = v.getUint32(end + 16, true);
	if (count === 0xffff || at === 0xffffffff || at + dirSize > end) throw new ZipError('zip64 or a broken directory');
	const members = new Map<string, ZipMember>();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	for (let n = 0; n < count; n++) {
		if (at + 46 > bytes.length || v.getUint32(at, true) !== CENTRAL) throw new ZipError('broken central directory');
		const flags = v.getUint16(at + 8, true);
		const method = v.getUint16(at + 10, true);
		const compressedSize = v.getUint32(at + 20, true);
		const size = v.getUint32(at + 24, true);
		const nameLen = v.getUint16(at + 28, true);
		const extraLen = v.getUint16(at + 30, true);
		const commentLen = v.getUint16(at + 32, true);
		const offset = v.getUint32(at + 42, true);
		if (flags & 0x1) throw new ZipError('encrypted member');
		if (method !== 0 && method !== 8) throw new ZipError(`compression method ${method}`);
		if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipError('zip64 member');
		let name: string;
		try {
			name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
		} catch {
			throw new ZipError('member name is not UTF-8');
		}
		if (members.has(name)) throw new ZipError(`duplicate member ${name}`);
		members.set(name, { name, method: method as 0 | 8, compressedSize, size, offset });
		at += 46 + nameLen + extraLen + commentLen;
	}
	return members;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const source = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(data);
			controller.close();
		}
	});
	const reader = source.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.length;
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

/** zipMember returns the uncompressed bytes of one member; its size must be the directory's. */
export async function zipMember(bytes: Uint8Array, member: ZipMember): Promise<Uint8Array> {
	const v = view(bytes);
	const at = member.offset;
	if (at + 30 > bytes.length || v.getUint32(at, true) !== LOCAL) throw new ZipError(`no local header for ${member.name}`);
	const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
	if (start + member.compressedSize > bytes.length) throw new ZipError(`${member.name} is cut off`);
	const raw = bytes.subarray(start, start + member.compressedSize);
	let out: Uint8Array;
	try {
		out = member.method === 0 ? raw : await inflateRaw(raw);
	} catch {
		throw new ZipError(`${member.name} does not inflate`);
	}
	if (out.length !== member.size) throw new ZipError(`${member.name}: ${out.length} bytes, the directory says ${member.size}`);
	return out;
}
