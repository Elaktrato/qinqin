// The faces.json and pack rules of docs/contracts/fonts/README.md, in
// JavaScript: scripts/prepare-font-pack.mjs checks every pack it writes
// with them, so a pack the script builds is one the server accepts. The
// Go side (server/internal/fonts) and this file both pass the fixtures
// faces-valid.json and faces-invalid.json.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_FACES_BYTES = 4 << 20;
export const MAX_FACES = 16;
export const MAX_SLICES = 1500;
export const MAX_SLICE_BYTES = 2 << 20;
export const FACES = ['sans', 'serif', 'kai'];
export const SCRIPTS = ['Hans', 'Hant', 'Jpan'];
export const STYLES = ['normal', 'italic'];

const FILE = /^slices\/([0-9a-f]{64})\.woff2$/;
const WEIGHT = /^([1-9][0-9]{0,3})(?: ([1-9][0-9]{0,3}))?$/;
const RANGE = /^U\+(0|[1-9A-F][0-9A-F]{0,5})(?:-(0|[1-9A-F][0-9A-F]{0,5}))?$/;

export class FacesError extends Error {
	constructor(code, path) {
		super(`${code} at ${path}`);
		this.code = code;
		this.path = path;
	}
}
const fail = (code, path) => {
	throw new FacesError(code, path);
};

/** parseWeight returns [lo, hi] of a CSS weight "N" or "N M", or null. */
export function parseWeight(s) {
	const m = typeof s === 'string' ? WEIGHT.exec(s) : null;
	if (!m) return null;
	const lo = Number(m[1]);
	const hi = m[2] ? Number(m[2]) : lo;
	return hi > 1000 || lo > hi ? null : [lo, hi];
}

/** parseUnicodeRange returns the [lo, hi] spans of a contract unicode-range, or null. */
export function parseUnicodeRange(s) {
	if (typeof s !== 'string' || s === '') return null;
	const out = [];
	for (const part of s.split(',')) {
		const m = RANGE.exec(part);
		if (!m) return null;
		const lo = parseInt(m[1], 16);
		const hi = m[2] ? parseInt(m[2], 16) : lo;
		if ((m[2] && hi <= lo) || hi > 0x10ffff) return null;
		out.push([lo, hi]);
	}
	return out;
}

/** unicodeRange writes sorted, distinct code points as a contract unicode-range (contiguous runs merged). */
export function unicodeRange(points) {
	const parts = [];
	const hex = (n) => n.toString(16).toUpperCase();
	for (let i = 0; i < points.length; ) {
		let j = i;
		while (j + 1 < points.length && points[j + 1] === points[j] + 1) j++;
		parts.push(i === j ? `U+${hex(points[i])}` : `U+${hex(points[i])}-${hex(points[j])}`);
		i = j + 1;
	}
	return parts.join(',');
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A strict member scan of the raw JSON text: JSON.parse keeps the last of
// a repeated member silently, so repeats are found on the text itself.
function duplicateMember(text) {
	let i = 0;
	const ws = () => {
		while (i < text.length && ' \t\r\n'.includes(text[i])) i++;
	};
	const str = () => {
		const start = i;
		i++;
		while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
		i++;
		return JSON.parse(text.slice(start, i));
	};
	const value = (p) => {
		ws();
		const c = text[i];
		if (c === '{') {
			i++;
			const keys = new Set();
			ws();
			if (text[i] === '}') {
				i++;
				return null;
			}
			for (;;) {
				ws();
				const key = str();
				if (keys.has(key)) return `${p}.${key}`;
				keys.add(key);
				ws();
				i++; // :
				const found = value(`${p}.${key}`);
				if (found) return found;
				ws();
				if (text[i++] === '}') return null;
			}
		}
		if (c === '[') {
			i++;
			ws();
			if (text[i] === ']') {
				i++;
				return null;
			}
			for (let n = 0; ; n++) {
				const found = value(`${p}[${n}]`);
				if (found) return found;
				ws();
				if (text[i++] === ']') return null;
			}
		}
		if (c === '"') {
			str();
			return null;
		}
		while (i < text.length && !',}] \t\r\n'.includes(text[i])) i++;
		return null;
	};
	return value('$');
}

function strict(obj, path, want) {
	if (!isObject(obj)) fail('not-an-object', path);
	for (const k of Object.keys(obj)) if (!want.includes(k)) fail('unknown-member', `${path}.${k}`);
	for (const k of want) if (!(k in obj)) fail('missing-member', `${path}.${k}`);
}

function validName(s) {
	if (typeof s !== 'string') return false;
	const n = [...s].length;
	return n > 0 && n <= 128 && s.trim() === s && !/\p{Cc}/u.test(s);
}

/**
 * parseFaces validates a faces.json text and returns its faces
 * ({face, script, original, weight, style, slices: [{file, sha, unicodeRange}]}).
 * Throws FacesError with the first problem in the contract's order.
 */
export function parseFaces(text) {
	if (Buffer.byteLength(text) > MAX_FACES_BYTES) fail('too-large', '$');
	let doc;
	try {
		doc = JSON.parse(text);
	} catch {
		fail('bad-json', '$');
	}
	// The first repeated member in document order; it is reported when the
	// validation reaches its object (an object's repeats come before its
	// unknown and missing members), as the server's object reader does.
	const dup = duplicateMember(text);
	const dupAt = (path) => {
		if (dup && dup.startsWith(path + '.') && !/[.[]/.test(dup.slice(path.length + 1))) fail('duplicate-member', dup);
	};
	if (!isObject(doc)) fail('not-an-object', '$');
	dupAt('$');
	strict(doc, '$', ['version', 'faces']);
	if (doc.version !== 1) fail('bad-version', '$.version');
	if (!Array.isArray(doc.faces) || doc.faces.length === 0) fail('no-faces', '$.faces');
	if (doc.faces.length > MAX_FACES) fail('too-many-faces', '$.faces');
	const out = [];
	const files = new Set();
	let total = 0;
	doc.faces.forEach((f, i) => {
		const path = `$.faces[${i}]`;
		if (!isObject(f)) fail('not-an-object', path);
		dupAt(path);
		strict(f, path, ['face', 'script', 'original', 'weight', 'style', 'slices']);
		if (!FACES.includes(f.face)) fail('bad-face', `${path}.face`);
		if (!SCRIPTS.includes(f.script)) fail('bad-script', `${path}.script`);
		if (!validName(f.original)) fail('bad-original', `${path}.original`);
		const w = parseWeight(f.weight);
		if (!w) fail('bad-weight', `${path}.weight`);
		if (!STYLES.includes(f.style)) fail('bad-style', `${path}.style`);
		for (const g of out) {
			if (g.face === f.face && g.script === f.script && g.style === f.style && w[0] <= g.hi && g.lo <= w[1]) {
				fail('duplicate-face', path);
			}
		}
		if (!Array.isArray(f.slices) || f.slices.length === 0) fail('no-slices', `${path}.slices`);
		const cover = [];
		const face = { face: f.face, script: f.script, original: f.original, weight: f.weight, style: f.style, lo: w[0], hi: w[1], slices: [] };
		f.slices.forEach((s, j) => {
			const sp = `${path}.slices[${j}]`;
			if (++total > MAX_SLICES) fail('too-many-slices', sp);
			if (!isObject(s)) fail('not-an-object', sp);
			dupAt(sp);
			strict(s, sp, ['file', 'unicodeRange']);
			const m = typeof s.file === 'string' ? FILE.exec(s.file) : null;
			if (!m) fail('bad-file', `${sp}.file`);
			if (files.has(s.file)) fail('duplicate-file', `${sp}.file`);
			files.add(s.file);
			const spans = parseUnicodeRange(s.unicodeRange);
			if (!spans) fail('bad-range', `${sp}.unicodeRange`);
			for (const r of spans) {
				if (!addSpan(cover, r)) fail('overlapping-range', `${sp}.unicodeRange`);
			}
			face.slices.push({ file: s.file, sha: m[1], unicodeRange: s.unicodeRange });
		});
		out.push(face);
	});
	return out;
}

// addSpan inserts r into the sorted disjoint list unless it overlaps.
function addSpan(list, r) {
	let lo = 0;
	let hi = list.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (list[mid][1] >= r[0]) hi = mid;
		else lo = mid + 1;
	}
	if (lo < list.length && list[lo][0] <= r[1]) return false;
	list.splice(lo, 0, r);
	return true;
}

/** checkPackDir checks a built pack directory as the server's import does; throws on the first problem. */
export function checkPackDir(dir) {
	const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
	if (manifest.type !== 'font' || manifest.format !== 'font-slices' || 'language' in manifest || 'languages' in manifest) {
		throw new Error('manifest.json: not a font pack (type font, format font-slices, no language)');
	}
	for (const k of ['id', 'name', 'version', 'license', 'attribution']) {
		if (typeof manifest[k] !== 'string' || manifest[k].trim() === '') throw new Error(`manifest.json: ${k} is required`);
	}
	const faces = parseFaces(readFileSync(join(dir, 'faces.json'), 'utf8'));
	for (const f of faces) {
		for (const s of f.slices) {
			const path = join(dir, s.file);
			const st = lstatSync(path);
			if (!st.isFile()) throw new Error(`${s.file}: not a regular file`);
			if (st.size > MAX_SLICE_BYTES) throw new Error(`${s.file}: ${st.size} bytes exceeds the ${MAX_SLICE_BYTES} byte limit`);
			const data = readFileSync(path);
			if (data.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`${s.file}: does not start with wOF2`);
			if (createHash('sha256').update(data).digest('hex') !== s.sha) throw new Error(`${s.file}: its sha256 does not match its name`);
		}
	}
	return { manifest, faces };
}
