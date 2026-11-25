// The Android release version, from a git tag (#148). Pure rules plus a tiny CLI for the workflow:
//   node scripts/version-code.mjs v0.7.0     prints  versionName=0.7.0  and  versionCode=70099
//
// versionName is the tag without its leading v (it must be semver: MAJOR.MINOR.PATCH[-pre], like the image job's
// guard in .github/workflows/build.yml, with no build metadata).
//
// versionCode = major*1000000 + minor*10000 + patch*100 + slot. slot orders the pre-releases of one version below
// its release, so every later release in semver order gets a larger code (Android only installs upward):
//   alpha[.N] 1..29 (slot N), beta[.N] 30..59 (29+N), rc[.N] 60..89 (59+N, N up to 30), release 99.
// A bare "rc" is rc.1. Any other pre-release label, a N out of range, minor/patch above 99 or major above 209
// (Play's limit is 2100000000) is refused: a wrong code is worse than a failed build.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class VersionError extends Error {}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const SLOTS = { alpha: { base: 0, max: 29 }, beta: { base: 29, max: 30 }, rc: { base: 59, max: 30 } };
const RELEASE_SLOT = 99;

export function parseTag(tag) {
	const name = typeof tag === 'string' && tag.startsWith('v') ? tag.slice(1) : tag;
	const m = typeof name === 'string' ? SEMVER.exec(name) : null;
	if (!m) throw new VersionError(`tag ${tag} is not semver (vMAJOR.MINOR.PATCH[-pre])`);
	return { name, major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}

function preSlot(pre) {
	const m = /^(alpha|beta|rc)(?:\.?(\d+))?$/.exec(pre);
	if (!m) throw new VersionError(`pre-release "${pre}" has no Android version slot (use alpha.N, beta.N or rc.N)`);
	const { base, max } = SLOTS[m[1]];
	const n = m[2] === undefined ? 1 : Number(m[2]);
	if (n < 1 || n > max) throw new VersionError(`pre-release "${pre}": the number must be 1..${max}`);
	return base + n;
}

export function androidVersion(tag) {
	const { name, major, minor, patch, pre } = parseTag(tag);
	if (major > 209 || minor > 99 || patch > 99) {
		throw new VersionError(`version ${name} is outside the versionCode scheme (major <= 209, minor <= 99, patch <= 99)`);
	}
	const slot = pre === null ? RELEASE_SLOT : preSlot(pre);
	return { versionName: name, versionCode: major * 1000000 + minor * 10000 + patch * 100 + slot };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const { versionName, versionCode } = androidVersion(process.argv[2] ?? '');
		const lines = `versionName=${versionName}\nversionCode=${versionCode}\n`;
		process.stdout.write(lines);
		if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
	} catch (e) {
		if (!(e instanceof VersionError)) throw e;
		console.error(`::error::${e.message}`);
		process.exit(1);
	}
}
