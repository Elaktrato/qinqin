// In-memory CacheStorage for tests of the service worker modules and their
// page-side helpers. Keys keep insertion order, like the real Cache.keys().

export class FakeCache {
	entries = new Map<string, Response>();
	/** When set, put() rejects with this error (a full disk). */
	putError: Error | null = null;

	private key(request: Request | string): string {
		return typeof request === 'string' ? new URL(request, 'https://x.test').href : request.url;
	}

	async match(request: Request | string): Promise<Response | undefined> {
		return this.entries.get(this.key(request))?.clone();
	}

	async put(request: Request | string, response: Response): Promise<void> {
		if (this.putError) throw this.putError;
		const key = this.key(request);
		// Re-putting a key keeps its original position only in browsers that
		// replace in place; delete first so tests see "newest last" like add().
		this.entries.delete(key);
		this.entries.set(key, response.clone());
	}

	async delete(request: Request | string): Promise<boolean> {
		return this.entries.delete(this.key(request));
	}

	async keys(): Promise<Request[]> {
		return [...this.entries.keys()].map((url) => new Request(url));
	}

	async add(request: Request | string): Promise<void> {
		throw new Error(`FakeCache.add is not supported (${String(request)})`);
	}
}

export class FakeCacheStorage {
	stores = new Map<string, FakeCache>();

	async open(name: string): Promise<FakeCache> {
		let cache = this.stores.get(name);
		if (!cache) {
			cache = new FakeCache();
			this.stores.set(name, cache);
		}
		return cache;
	}

	async has(name: string): Promise<boolean> {
		return this.stores.has(name);
	}

	async keys(): Promise<string[]> {
		return [...this.stores.keys()];
	}

	async delete(name: string): Promise<boolean> {
		return this.stores.delete(name);
	}

	async match(request: Request | string): Promise<Response | undefined> {
		for (const cache of this.stores.values()) {
			const hit = await cache.match(request);
			if (hit) return hit;
		}
		return undefined;
	}
}
