// The faces of the installed font packs (GET /api/fonts, docs/contracts/fonts),
// registered with the FontFace API under `qq-<face>-<script>`, one FontFace per
// slice with its unicode-range: the browser then downloads only the slices whose
// characters a page shows (the service worker keeps them, `qinqin-fonts-v1`).
// Only the faces somebody needs are registered — the app-wide choice and the
// reader's own font — so another face's slices are never fetched. Any failure
// (no list, a bad descriptor, a slice that does not load) leaves the system
// stack that follows the pack family in hanziStack: silent by design.

import { getFonts, type FontList, type InstalledFontFace } from '$lib/api/fonts';
import { installedFaces, packFamily, type HanziFace, type InstalledFaces } from './hanzi';

/** The slice of a FontFaceSet (document.fonts) used here. */
export interface FontFaceSetLike {
	add(face: FontFace): unknown;
	delete(face: FontFace): boolean;
}

export interface PackFacesDeps {
	fetchFonts(): Promise<FontList>;
	fontSet(): FontFaceSetLike | null;
	createFace(family: string, source: string, descriptors: FontFaceDescriptors): FontFace;
}

const SLICE_URL = /^\/fonts\/[0-9a-f]{64}\.woff2$/;

const defaultDeps: PackFacesDeps = {
	fetchFonts: getFonts,
	fontSet: () => (typeof document === 'undefined' || !document.fonts ? null : document.fonts),
	createFace: (family, source, descriptors) => new FontFace(family, source, descriptors)
};

interface Wanted {
	family: string;
	source: string;
	descriptors: FontFaceDescriptors;
}

export function createPackFaces(overrides: Partial<PackFacesDeps> = {}) {
	const deps: PackFacesDeps = { ...defaultDeps, ...overrides };
	let faces = $state.raw<readonly InstalledFontFace[]>([]);
	const installed = $derived(installedFaces(faces));
	const needs = new Map<string, ReadonlySet<HanziFace>>();
	const registered = new Map<string, FontFace>();

	function wanted(): Map<string, Wanted> {
		const need = new Set<string>();
		for (const list of needs.values()) for (const f of list) need.add(f);
		const out = new Map<string, Wanted>();
		for (const f of faces) {
			if (!need.has(f.face)) continue;
			const family = packFamily(f.face, f.script);
			for (const s of f.slices ?? []) {
				if (typeof s?.url !== 'string' || !SLICE_URL.test(s.url)) continue;
				const key = `${family}|${f.weight}|${f.style}|${s.url}|${s.unicodeRange}`;
				out.set(key, {
					family,
					source: `url("${s.url}") format("woff2")`,
					descriptors: { unicodeRange: s.unicodeRange, weight: f.weight, style: f.style, display: 'swap' }
				});
			}
		}
		return out;
	}

	/** sync makes document.fonts hold exactly the wanted slices (idempotent). */
	function sync(): void {
		const set = deps.fontSet();
		if (set === null) return;
		const want = wanted();
		for (const [key, face] of registered) {
			if (want.has(key)) continue;
			try {
				set.delete(face);
			} catch {
				// Already gone.
			}
			registered.delete(key);
		}
		for (const [key, w] of want) {
			if (registered.has(key)) continue;
			try {
				const face = deps.createFace(w.family, w.source, w.descriptors);
				// A slice that fails to load falls through to the system stack.
				face.loaded?.catch(() => undefined);
				set.add(face);
				registered.set(key, face);
			} catch {
				// A descriptor the browser refuses: that slice is skipped.
			}
		}
	}

	return {
		/** The installed faces as `<face>-<script>` keys (hanziStack's `installed`). */
		get installed(): InstalledFaces {
			return installed;
		},
		/** load reads the list (again after a pack change); a failure keeps what is known. */
		async load(): Promise<void> {
			try {
				const list = await deps.fetchFonts();
				faces = Array.isArray(list?.faces) ? list.faces : [];
			} catch {
				// Offline without a saved copy, or a server error: the system stacks stay.
			}
			sync();
		},
		/** need: the faces `owner` (the app's choice, the reader) wants registered now. */
		need(owner: string, list: readonly HanziFace[]): void {
			needs.set(owner, new Set(list));
			sync();
		},
		/** clear forgets the list (sign-out) and unregisters every slice. */
		clear(): void {
			faces = [];
			sync();
		}
	};
}

export type PackFaces = ReturnType<typeof createPackFaces>;

