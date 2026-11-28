// An images package (docs/contracts/images/README.md, "Offline") read into memory, and the picture of an entry found
// in the packages a device holds with the server's rule (images/resolve.json, "Resolution"). Pure: the store and the
// fetches are elsewhere (store.ts, offlinePictures.ts).
import type { EntryPicture } from '../api/images';
import { openSqlite, SqliteError } from './sqlite';

/** The data.sqlite format versions of an images package this client reads. */
export const IMAGES_FORMATS: readonly number[] = [1];

export interface MapRow {
	language: string;
	target: string;
	sense: number;
	concept: string;
	score: number;
	basis: string;
}

export interface ImagesIndex {
	packId: string;
	license: string;
	attribution: string;
	pictures: Map<string, { label: string; credit: string; svg: string }>;
	/** language -> target -> rows */
	map: Map<string, Map<string, MapRow[]>>;
}

export interface PictureKey {
	packId: string;
	concept: string;
}

/** The most targets one lookup asks for (the server's maxTargets). */
const MAX_TARGETS = 24;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);

/** indexOf builds the index of one pack from its rows. */
export function indexOf(packId: string, license: string, attribution: string, pictures: { concept: string; label: string; credit: string; svg: string }[], rows: MapRow[]): ImagesIndex {
	const index: ImagesIndex = { packId, license, attribution, pictures: new Map(), map: new Map() };
	for (const p of pictures) index.pictures.set(p.concept, { label: p.label, credit: p.credit, svg: p.svg });
	for (const r of rows) {
		let byTarget = index.map.get(r.language);
		if (!byTarget) index.map.set(r.language, (byTarget = new Map()));
		const list = byTarget.get(r.target);
		if (list) list.push(r);
		else byTarget.set(r.target, [r]);
	}
	return index;
}

/** readImagesPackage reads a checked package's data.sqlite; throws SqliteError for one it cannot read. */
export function readImagesPackage(data: Uint8Array): ImagesIndex {
	const db = openSqlite(data);
	const source = db.rows('qq_sources')[0];
	if (!source) throw new SqliteError('an images package without its source');
	const pictures = db.rows('pictures').map((r) => ({ concept: str(r.concept), label: str(r.label), credit: str(r.credit), svg: str(r.svg) }));
	const rows = db.rows('map').map((r) => ({
		language: str(r.language),
		target: str(r.target),
		sense: num(r.sense),
		concept: str(r.concept),
		score: num(r.score),
		basis: str(r.basis)
	}));
	return indexOf(str(source.pack_id), str(source.license), str(source.attribution), pictures, rows);
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * resolvePicture: the picture of an entry among the packs held, by the server's rule — the targets (trimmed, blank
 * and repeated ones dropped, at most 24), with a sense only that sense's and entry-wide rows (the sense's own
 * first), then the higher score, the lower sense, the pack id and the concept. A picture in `skip` (reported) is
 * passed over; so is a row whose picture the package does not hold. null for none.
 */
export function resolvePicture(
	indexes: readonly ImagesIndex[],
	language: string,
	targets: readonly string[],
	sense: number,
	skip: readonly PictureKey[] = []
): EntryPicture | null {
	const wanted: string[] = [];
	for (const raw of targets) {
		const t = raw.trim();
		if (t !== '' && !wanted.includes(t) && wanted.length < MAX_TARGETS) wanted.push(t);
	}
	let best: { index: ImagesIndex; row: MapRow } | null = null;
	const better = (a: { index: ImagesIndex; row: MapRow }, b: { index: ImagesIndex; row: MapRow }): boolean => {
		if (sense > 0 && (a.row.sense === sense) !== (b.row.sense === sense)) return a.row.sense === sense;
		if (a.row.score !== b.row.score) return a.row.score > b.row.score;
		if (a.row.sense !== b.row.sense) return a.row.sense < b.row.sense;
		const pack = cmp(a.index.packId, b.index.packId);
		return pack !== 0 ? pack < 0 : cmp(a.row.concept, b.row.concept) < 0;
	};
	for (const index of indexes) {
		const byTarget = index.map.get(language);
		if (!byTarget) continue;
		for (const target of wanted) {
			for (const row of byTarget.get(target) ?? []) {
				if (sense > 0 && row.sense !== 0 && row.sense !== sense) continue;
				if (!index.pictures.has(row.concept)) continue;
				if (skip.some((k) => k.packId === index.packId && k.concept === row.concept)) continue;
				const candidate = { index, row };
				if (best === null || better(candidate, best)) best = candidate;
			}
		}
	}
	if (best === null) return null;
	const pic = best.index.pictures.get(best.row.concept)!;
	return {
		packId: best.index.packId,
		concept: best.row.concept,
		label: pic.label,
		credit: pic.credit,
		license: best.index.license,
		attribution: best.index.attribution,
		basis: best.row.basis,
		sense: best.row.sense,
		score: best.row.score,
		svg: pic.svg
	};
}
