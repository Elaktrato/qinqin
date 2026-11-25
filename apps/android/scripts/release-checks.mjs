// Pure checks of the local release script (release-local.sh, #148): parse what apksigner and aapt2 print, and
// compare the signer certificate with the pinned fingerprint. No I/O except the small CLI at the bottom, which the
// shell script calls so that the rules live (and are tested) here, not in grep one-liners.
//   node release-checks.mjs signer <apksigner-output-file>               prints  fingerprint=<64 hex>  (fails otherwise)
//   node release-checks.mjs badging <aapt2-badging-file> <code> <name>   fails when the APK's version differs
//   node release-checks.mjs pin <fingerprint> [<release-fingerprint.txt>]  prints match / mismatch / unpinned
//                                                                         (exit 0 / 1 / 3)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class CheckError extends Error {}

export function normalizeFingerprint(text) {
	const fp = String(text ?? '').replace(/[:\s]/g, '').toLowerCase();
	return /^[0-9a-f]{64}$/.test(fp) ? fp : null;
}

// The pinned fingerprint file: '#' comment lines and blank lines are ignored; exactly one fingerprint (hex, with or
// without colons) must remain. Returns null when the file holds none.
export function readPinned(text) {
	const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
	if (lines.length === 0) return null;
	if (lines.length > 1) throw new CheckError('release-fingerprint.txt must hold exactly one SHA-256 fingerprint');
	const fp = normalizeFingerprint(lines[0]);
	if (!fp) throw new CheckError('release-fingerprint.txt: the line is not a SHA-256 fingerprint (64 hex digits)');
	return fp;
}

// Positive assertions on `apksigner verify --verbose --print-certs`: the v2 scheme verified, one signer with a
// SHA-256 digest, and that signer is not the Android debug certificate.
export function parseApksigner(output) {
	if (!/^Verified using v2 scheme \(APK Signature Scheme v2\): true\s*$/m.test(output)) {
		throw new CheckError('the APK has no verified v2 signature');
	}
	const m = /^Signer #1 certificate SHA-256 digest: *(.+)$/m.exec(output);
	const fingerprint = m ? normalizeFingerprint(m[1]) : null;
	if (!fingerprint) throw new CheckError('no signer certificate SHA-256 digest in the apksigner output');
	if (/Android Debug/i.test(output)) throw new CheckError('the release APK is signed with the Android debug certificate');
	return { fingerprint };
}

export function parseBadging(output) {
	const line = output.split(/\r?\n/).find((l) => l.startsWith('package:')) ?? '';
	const code = /versionCode='([^']*)'/.exec(line)?.[1] ?? null;
	const name = /versionName='([^']*)'/.exec(line)?.[1] ?? null;
	const id = /name='([^']*)'/.exec(line)?.[1] ?? null;
	return { id, versionCode: code, versionName: name };
}

export function checkBadging(output, versionCode, versionName) {
	const b = parseBadging(output);
	if (b.versionCode !== String(versionCode)) throw new CheckError(`versionCode in the APK is ${b.versionCode}, expected ${versionCode}`);
	if (b.versionName !== versionName) throw new CheckError(`versionName in the APK is ${b.versionName}, expected ${versionName}`);
	return b;
}

// 'match', 'mismatch' or 'unpinned' (no file, or only comments in it).
export function comparePinned(fingerprint, pinnedText) {
	if (pinnedText === null) return 'unpinned';
	const pinned = readPinned(pinnedText);
	if (pinned === null) return 'unpinned';
	return pinned === fingerprint ? 'match' : 'mismatch';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [cmd, a, b, c] = process.argv.slice(2);
	try {
		if (cmd === 'signer') {
			console.log(`fingerprint=${parseApksigner(readFileSync(a, 'utf8')).fingerprint}`);
		} else if (cmd === 'badging') {
			const r = checkBadging(readFileSync(a, 'utf8'), b, c);
			console.log(`package=${r.id} versionCode=${r.versionCode} versionName=${r.versionName}`);
		} else if (cmd === 'pin') {
			const fp = normalizeFingerprint(a);
			if (!fp) throw new CheckError('not a SHA-256 fingerprint');
			const r = comparePinned(fp, b && existsSync(b) ? readFileSync(b, 'utf8') : null);
			console.log(r);
			process.exit(r === 'match' ? 0 : r === 'unpinned' ? 3 : 1);
		} else {
			throw new CheckError(`unknown command ${cmd}`);
		}
	} catch (e) {
		if (!(e instanceof CheckError)) throw e;
		console.error(`error: ${e.message}`);
		process.exit(1);
	}
}
