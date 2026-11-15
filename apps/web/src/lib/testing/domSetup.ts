// Setup for the jsdom (`*.dom.test.ts`) project only.
//
// Node >= 25 ships an experimental global `localStorage`/`sessionStorage`
// that, without --localstorage-file, is missing or broken and shadows the
// Storage jsdom provides. When the global is not a working Storage, install
// an in-memory one on globalThis and window, emptied before every test.
import { beforeEach } from 'vitest';

class MemoryStorage implements Storage {
	#data = new Map<string, string>();
	get length() {
		return this.#data.size;
	}
	clear() {
		this.#data.clear();
	}
	getItem(key: string) {
		return this.#data.get(String(key)) ?? null;
	}
	key(index: number) {
		return [...this.#data.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.#data.delete(String(key));
	}
	setItem(key: string, value: string) {
		this.#data.set(String(key), String(value));
	}
}

function works(name: 'localStorage' | 'sessionStorage'): boolean {
	try {
		const s = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
		return (
			!!s &&
			typeof s.clear === 'function' &&
			typeof s.getItem === 'function' &&
			typeof s.setItem === 'function'
		);
	} catch {
		return false;
	}
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
	if (works(name)) continue;
	const storage = new MemoryStorage();
	for (const target of [globalThis, globalThis.window].filter(Boolean)) {
		Object.defineProperty(target, name, { value: storage, configurable: true, writable: true });
	}
	beforeEach(() => storage.clear());
}
