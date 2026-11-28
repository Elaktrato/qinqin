// Checking a downloaded package before it is used (docs/contracts/packages/README.md, "Verification", in its
// order): the file's SHA-256 is the catalogue's, the manifest names the catalogue row and the server, every listed
// file has its size and SHA-256, and the format version is one this client knows. A package that fails any step is
// thrown away whole (PackageCheckError); nothing of it is used.
import type { CatalogueRow } from '../api/packages';
import { readZip, zipMember, ZipError } from './zip';

export class PackageCheckError extends Error {}

export interface PackageManifest {
	format: string;
	formatVersion: number;
	id: string;
	type: string;
	languages: string[];
	revision: number;
	contentHash: string;
	instanceId: string;
	files: { name: string; bytes: number; sha256: string }[];
}

export interface CheckedPackage {
	manifest: PackageManifest;
	/** Every listed file, uncompressed. */
	files: Map<string, Uint8Array>;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
	let hex = '';
	for (const b of digest) hex += b.toString(16).padStart(2, '0');
	return hex;
}

function isManifest(raw: unknown): raw is PackageManifest {
	if (typeof raw !== 'object' || raw === null) return false;
	const m = raw as Record<string, unknown>;
	return (
		m.format === 'qinqin-package' &&
		typeof m.formatVersion === 'number' &&
		typeof m.id === 'string' &&
		typeof m.revision === 'number' &&
		typeof m.contentHash === 'string' &&
		typeof m.instanceId === 'string' &&
		Array.isArray(m.files) &&
		m.files.every(
			(f) => typeof f === 'object' && f !== null && typeof (f as Record<string, unknown>).name === 'string' && typeof (f as Record<string, unknown>).bytes === 'number' && typeof (f as Record<string, unknown>).sha256 === 'string'
		)
	);
}

export async function checkPackage(
	bytes: Uint8Array,
	row: Pick<CatalogueRow, 'id' | 'revision' | 'contentHash' | 'sha256'>,
	instanceId: string,
	knownFormats: readonly number[]
): Promise<CheckedPackage> {
	if ((await sha256Hex(bytes)) !== row.sha256) throw new PackageCheckError('the file is not the one the catalogue lists');
	try {
		const members = readZip(bytes);
		const manifestMember = members.get('manifest.json');
		if (!manifestMember) throw new PackageCheckError('no manifest.json');
		let manifest: unknown;
		try {
			manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await zipMember(bytes, manifestMember)));
		} catch {
			throw new PackageCheckError('manifest.json is not JSON');
		}
		if (!isManifest(manifest)) throw new PackageCheckError('manifest.json is not a package manifest');
		if (manifest.id !== row.id || manifest.revision !== row.revision || manifest.contentHash !== row.contentHash || manifest.instanceId !== instanceId) {
			throw new PackageCheckError('the manifest names another package or server');
		}
		const files = new Map<string, Uint8Array>();
		for (const f of manifest.files) {
			const member = members.get(f.name);
			if (!member || f.name === 'manifest.json' || files.has(f.name)) throw new PackageCheckError(`listed file ${f.name} is missing`);
			const data = await zipMember(bytes, member);
			if (data.length !== f.bytes || (await sha256Hex(data)) !== f.sha256) throw new PackageCheckError(`${f.name} does not match the manifest`);
			files.set(f.name, data);
		}
		if (!knownFormats.includes(manifest.formatVersion)) throw new PackageCheckError(`format version ${manifest.formatVersion} is not known`);
		return { manifest, files };
	} catch (err) {
		if (err instanceof ZipError) throw new PackageCheckError('the zip file cannot be read', { cause: err });
		throw err;
	}
}
