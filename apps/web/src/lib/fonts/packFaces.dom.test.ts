import { describe, expect, it, vi } from 'vitest';
import type { FontList, InstalledFontFace } from '$lib/api/fonts';
import { createPackFaces, type FontFaceSetLike } from './packFaces.svelte';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function face(over: Partial<InstalledFontFace>): InstalledFontFace {
	return {
		packId: 'p',
		face: 'sans',
		script: 'Hans',
		original: 'Noto Sans SC',
		weight: '200 900',
		style: 'normal',
		license: 'OFL-1.1',
		attribution: '',
		slices: [],
		...over
	};
}

const LIST: FontList = {
	faces: [
		face({ slices: [{ url: `/fonts/${SHA_A}.woff2`, unicodeRange: 'U+20-7E' }, { url: `/fonts/${SHA_B}.woff2`, unicodeRange: 'U+4E00' }] }),
		face({ face: 'kai', script: 'Jpan', weight: '400', original: 'Klee One', slices: [{ url: `/fonts/${SHA_C}.woff2`, unicodeRange: 'U+3042' }] })
	],
	packs: []
};

class FakeFace {
	loaded: Promise<unknown>;
	constructor(
		public family: string,
		public source: string,
		public descriptors: Record<string, string>
	) {
		if (descriptors.unicodeRange === 'bad') throw new SyntaxError('bad range');
		// A slice that fails to load must not surface as an unhandled rejection.
		this.loaded = source.includes(SHA_B) ? Promise.reject(new Error('network')) : Promise.resolve(this);
	}
}

function setup(list: FontList | Error = LIST) {
	const added = new Set<FakeFace>();
	const set: FontFaceSetLike = {
		add: (f) => void added.add(f as unknown as FakeFace),
		delete: (f) => added.delete(f as unknown as FakeFace)
	};
	const fetchFonts = vi.fn(async () => {
		if (list instanceof Error) throw list;
		return list;
	});
	const store = createPackFaces({
		fetchFonts,
		fontSet: () => set,
		createFace: (family, source, descriptors) => new FakeFace(family, source, descriptors as Record<string, string>) as unknown as FontFace
	});
	return { store, added, fetchFonts };
}

describe('packFaces', () => {
	it('knows the installed faces, and registers nothing until a face is needed', async () => {
		const { store, added } = setup();
		await store.load();
		expect([...store.installed].sort()).toEqual(['kai-Jpan', 'sans-Hans']);
		expect(added.size).toBe(0);
	});

	it('registers every slice of a needed face under qq-<face>-<script>, lazily by unicode-range', async () => {
		const { store, added } = setup();
		await store.load();
		store.need('app', ['sans']);
		const faces = [...added];
		expect(faces.map((f) => f.family)).toEqual(['qq-sans-Hans', 'qq-sans-Hans']);
		expect(faces[0].source).toBe(`url("/fonts/${SHA_A}.woff2") format("woff2")`);
		expect(faces[0].descriptors).toEqual({ unicodeRange: 'U+20-7E', weight: '200 900', style: 'normal', display: 'swap' });
		expect(faces[1].descriptors.unicodeRange).toBe('U+4E00');
	});

	it('registers the union of every owner, and drops a face no owner needs any more', async () => {
		const { store, added } = setup();
		await store.load();
		store.need('app', ['sans']);
		store.need('reader', ['kai']);
		expect([...added].map((f) => f.family).sort()).toEqual(['qq-kai-Jpan', 'qq-sans-Hans', 'qq-sans-Hans']);
		store.need('app', ['serif']);
		expect([...added].map((f) => f.family)).toEqual(['qq-kai-Jpan']);
		store.need('reader', []);
		expect(added.size).toBe(0);
	});

	it('is idempotent: a reload after a pack change replaces the set', async () => {
		const { store, added, fetchFonts } = setup();
		await store.load();
		store.need('app', ['sans', 'kai']);
		const before = [...added];
		await store.load();
		expect([...added]).toEqual(before);
		fetchFonts.mockResolvedValueOnce({ faces: [LIST.faces[1]], packs: [] });
		await store.load();
		expect([...added].map((f) => f.family)).toEqual(['qq-kai-Jpan']);
		expect([...store.installed]).toEqual(['kai-Jpan']);
	});

	it('takes only same-origin content-addressed slice URLs', async () => {
		const { store, added } = setup({
			faces: [
				face({
					slices: [
						{ url: 'https://fonts.example/x.woff2', unicodeRange: 'U+20' },
						{ url: '/fonts/../secret.woff2', unicodeRange: 'U+21' },
						{ url: `/fonts/${SHA_A}.woff2`, unicodeRange: 'U+22' }
					]
				})
			],
			packs: []
		});
		await store.load();
		store.need('app', ['sans']);
		expect([...added].map((f) => f.descriptors.unicodeRange)).toEqual(['U+22']);
	});

	it('fails silently: a bad descriptor is skipped, a failed list keeps the system stacks', async () => {
		const bad = setup({ faces: [face({ slices: [{ url: `/fonts/${SHA_A}.woff2`, unicodeRange: 'bad' }] })], packs: [] });
		await bad.store.load();
		expect(() => bad.store.need('app', ['sans'])).not.toThrow();
		expect(bad.added.size).toBe(0);

		const offline = setup(new Error('offline'));
		await expect(offline.store.load()).resolves.toBeUndefined();
		expect(offline.store.installed.size).toBe(0);
	});

	it('clear (sign-out) forgets the faces and unregisters them', async () => {
		const { store, added } = setup();
		await store.load();
		store.need('app', ['sans']);
		store.clear();
		expect(added.size).toBe(0);
		expect(store.installed.size).toBe(0);
	});

	it('a malformed answer counts as no faces', async () => {
		const { store } = setup({} as FontList);
		await store.load();
		expect(store.installed.size).toBe(0);
	});
});
