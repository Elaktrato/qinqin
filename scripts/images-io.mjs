// The I/O of the images packs' scripts: pinned downloads and zip reading.
// Needs the `unzip` binary (the Docker stage installs it).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { sha256 } from './images-lib.mjs';

export function die(msg) {
	console.error(`images: ${msg}`);
	process.exit(1);
}

/** Download pin.url into dir (once) and return its bytes; a SHA-256 or size
 * mismatch is fatal: review the change, then update scripts/images/pins.json. */
export async function fetchPinned(pin, dir) {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${pin.sha256.slice(0, 12)}-${basename(new URL(pin.url).pathname)}`);
	let buf;
	if (existsSync(file)) buf = readFileSync(file);
	if (!buf || sha256(buf) !== pin.sha256) {
		let last;
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const res = await fetch(pin.url);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				buf = Buffer.from(await res.arrayBuffer());
				break;
			} catch (e) {
				last = e;
			}
		}
		if (!buf) die(`download failed: ${pin.url}: ${last}`);
		writeFileSync(file, buf);
	}
	const got = sha256(buf);
	if (got !== pin.sha256) die(`${pin.url}: SHA-256 is ${got}, pinned ${pin.sha256}. Refusing; review the change, then update the pin.`);
	if (pin.bytes && buf.length !== pin.bytes) die(`${pin.url}: ${buf.length} bytes, pinned ${pin.bytes}`);
	return { file, buf };
}

/** The member names of a zip. */
export function zipList(zip) {
	return execFileSync('unzip', ['-Z1', zip], { maxBuffer: 64 << 20 }).toString('utf8').split('\n').filter(Boolean);
}

/** Extract a zip into dir (once: a marker file says it is done). */
export function zipExtract(zip, dir) {
	const marker = join(dir, '.extracted');
	if (existsSync(marker)) return dir;
	mkdirSync(dir, { recursive: true });
	execFileSync('unzip', ['-qo', zip, '-d', dir], { maxBuffer: 64 << 20 });
	writeFileSync(marker, '');
	return dir;
}

/** One member of a zip, as a Buffer. */
export function zipRead(zip, name) {
	return execFileSync('unzip', ['-p', zip, name], { maxBuffer: 64 << 20 });
}
