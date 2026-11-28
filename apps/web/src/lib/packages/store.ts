// Where the web keeps the packages it installs (#274: the images packages): Cache Storage `qinqin-packages-v1`, one
// response per package under its catalogue path without the revision, the checked zip as the body and what the
// client rule compares (docs/contracts/packages/README.md, "Client rule") in a header. A package is only put here
// after checkPackage; sign-out and "Clear offline data" delete the whole cache (clearPackages).

export const PACKAGE_CACHE = 'qinqin-packages-v1';
const META_HEADER = 'X-Qinqin-Package';

/** What is kept of a catalogue row with the file. */
export interface KeptPackage {
	id: string;
	type: string;
	revision: number;
	contentHash: string;
	formatVersion: number;
	instanceId: string;
	languages: string[];
	bytes: number;
}

interface CacheLike {
	match(request: string): Promise<Response | undefined>;
	put(request: string, response: Response): Promise<void>;
	delete(request: string): Promise<boolean>;
	keys(): Promise<readonly Request[]>;
}

export interface PackageCaches {
	open(name: string): Promise<CacheLike>;
	delete(name: string): Promise<boolean>;
}

/** The platform's Cache Storage, or undefined where there is none (a test, an old browser, a private window). */
export function platformCaches(): PackageCaches | undefined {
	return typeof caches === 'undefined' ? undefined : (caches as unknown as PackageCaches);
}

function isKept(v: unknown): v is KeptPackage {
	if (typeof v !== 'object' || v === null) return false;
	const k = v as Record<string, unknown>;
	return (
		typeof k.id === 'string' &&
		typeof k.type === 'string' &&
		typeof k.revision === 'number' &&
		typeof k.contentHash === 'string' &&
		typeof k.formatVersion === 'number' &&
		typeof k.instanceId === 'string' &&
		Array.isArray(k.languages) &&
		typeof k.bytes === 'number'
	);
}

export class PackageStore {
	readonly #caches: PackageCaches;
	readonly #origin: string;

	constructor(caches: PackageCaches, origin: string) {
		this.#caches = caches;
		this.#origin = origin;
	}

	#key(id: string): string {
		return new URL(`/api/packages/${encodeURIComponent(id)}`, this.#origin).href;
	}

	/** Every kept package (one that cannot be read is left out). */
	async list(): Promise<KeptPackage[]> {
		const cache = await this.#caches.open(PACKAGE_CACHE);
		const out: KeptPackage[] = [];
		for (const req of await cache.keys()) {
			const res = await cache.match(req.url);
			const meta = this.#meta(res);
			if (meta !== null) out.push(meta);
		}
		return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	}

	#meta(res: Response | undefined): KeptPackage | null {
		try {
			const parsed = JSON.parse(res?.headers.get(META_HEADER) ?? 'null') as unknown;
			return isKept(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}

	/** The kept file of a package, or null. */
	async read(id: string): Promise<{ meta: KeptPackage; bytes: Uint8Array } | null> {
		const cache = await this.#caches.open(PACKAGE_CACHE);
		const res = await cache.match(this.#key(id));
		const meta = this.#meta(res);
		if (res === undefined || meta === null) return null;
		return { meta, bytes: new Uint8Array(await res.arrayBuffer()) };
	}

	/** Keeps a checked package, replacing an older one of the same id. */
	async put(meta: KeptPackage, bytes: Uint8Array): Promise<void> {
		const cache = await this.#caches.open(PACKAGE_CACHE);
		await cache.put(this.#key(meta.id), new Response(bytes as BodyInit, { headers: { [META_HEADER]: JSON.stringify(meta), 'Content-Type': 'application/zip' } }));
	}

	async remove(id: string): Promise<void> {
		const cache = await this.#caches.open(PACKAGE_CACHE);
		await cache.delete(this.#key(id));
	}

	/** Deletes every kept package (another server: the client rule's `reset`). */
	async clear(): Promise<void> {
		await this.#caches.delete(PACKAGE_CACHE);
	}
}

/** clearPackages: every kept package (sign-out, "Clear offline data"). Best effort, never throws. */
export async function clearPackages(caches: Pick<PackageCaches, 'delete'> | undefined = platformCaches()): Promise<void> {
	try {
		await caches?.delete(PACKAGE_CACHE);
	} catch {
		// Storage denied: nothing was kept either.
	}
}
