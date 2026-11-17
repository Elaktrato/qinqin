// The package catalogue (GET /api/packages, docs/contracts/packages/). The web
// reads it to show what the server has built; it installs no packages (a
// native client does). Decoding is strict: a catalogue that does not match the
// contract is refused whole, never guessed at.
import { api } from './client';
import type { StrokePack } from './types';

export type PackageType = 'lexicon' | 'levels' | 'sentences' | 'frequency' | 'components' | 'audio' | 'grammar' | 'strokes';
export type PackageState = 'building' | 'ready' | 'failed' | 'deleted';

export interface PackageSource {
	type: string;
	packId: string;
	name: string;
	version: string;
	license: string;
	attribution: string;
	notice: string;
}

export interface CatalogueRow {
	id: string;
	type: PackageType;
	languages: string[];
	formatVersion: number;
	revision: number;
	contentHash: string;
	sha256: string;
	bytes: number;
	url: string | null;
	state: PackageState;
	builtAt: string | null;
	requires: string[];
	optional: boolean;
	licenseTexts: boolean;
	sources: PackageSource[];
	updatedAt: string;
	deletedAt: string | null;
	/** Only in an administrator's catalogue, on a row whose last build failed. */
	error?: string;
}

export interface Catalogue {
	format: 1;
	instanceId: string;
	languages: string[];
	building: boolean;
	packages: CatalogueRow[];
}

const TYPES: readonly string[] = ['lexicon', 'levels', 'sentences', 'frequency', 'components', 'audio', 'grammar', 'strokes'];
const STATES: readonly string[] = ['building', 'ready', 'failed', 'deleted'];
const ID = /^(lexicon\.[a-z]{2,3}(-[a-z0-9]+)*|(levels|sentences|frequency|components|audio|grammar|strokes)\.[a-z][a-z0-9]*(-[a-z0-9]+)*)$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{64}$/;
const TOP_KEYS = ['format', 'instanceId', 'languages', 'building', 'packages'];
const ROW_KEYS = ['id', 'type', 'languages', 'formatVersion', 'revision', 'contentHash', 'sha256', 'bytes', 'url', 'state', 'builtAt', 'requires', 'optional', 'licenseTexts', 'sources', 'updatedAt', 'deletedAt'];
const SOURCE_KEYS = ['type', 'packId', 'name', 'version', 'license', 'attribution', 'notice'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && TIME.test(v);
const isInt = (v: unknown, min: number): v is number => Number.isInteger(v) && (v as number) >= min;
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
const sorted = (list: string[], strict: boolean) => list.every((s, i) => i === 0 || (strict ? list[i - 1] < s : list[i - 1] <= s));
const keysOk = (o: Record<string, unknown>, keys: readonly string[], extra: readonly string[] = []) => {
	const have = Object.keys(o);
	return keys.every((k) => k in o) && have.every((k) => keys.includes(k) || extra.includes(k));
};

function sourceOk(raw: unknown): raw is PackageSource {
	return isRecord(raw) && keysOk(raw, SOURCE_KEYS) && SOURCE_KEYS.every((k) => typeof raw[k] === 'string');
}

function rowOk(raw: unknown): raw is CatalogueRow {
	if (!isRecord(raw) || !keysOk(raw, ROW_KEYS, ['error'])) return false;
	const r = raw;
	if (typeof r.id !== 'string' || !ID.test(r.id) || typeof r.type !== 'string' || !TYPES.includes(r.type)) return false;
	if (r.id.split('.')[0] !== r.type) return false;
	if (!isStrings(r.languages) || r.languages.length === 0 || !sorted(r.languages, true)) return false;
	if (!isInt(r.formatVersion, 1) || !isInt(r.revision, 0) || !isInt(r.bytes, 0)) return false;
	if (typeof r.state !== 'string' || !STATES.includes(r.state)) return false;
	if (typeof r.contentHash !== 'string' || typeof r.sha256 !== 'string') return false;
	if (r.builtAt !== null && !isTime(r.builtAt)) return false;
	if (!isStrings(r.requires) || typeof r.optional !== 'boolean' || typeof r.licenseTexts !== 'boolean') return false;
	if (!Array.isArray(r.sources) || !r.sources.every(sourceOk)) return false;
	if (!isTime(r.updatedAt) || (r.deletedAt !== null && !isTime(r.deletedAt))) return false;
	if ('error' in r && (typeof r.error !== 'string' || r.error === '')) return false;
	const built = r.revision >= 1;
	if (built) {
		if (!CONTENT_HASH.test(r.contentHash) || !SHA.test(r.sha256) || r.builtAt === null) return false;
	} else if (r.contentHash !== '' || r.sha256 !== '' || r.bytes !== 0 || r.builtAt !== null) {
		return false;
	}
	switch (r.state) {
		case 'ready':
			return built && r.url === `/api/packages/${r.id}/${r.revision}` && r.deletedAt === null;
		case 'deleted':
			return r.url === null && r.deletedAt !== null;
		default: // building, failed: the first build has not produced a file
			return !built && r.url === null && r.deletedAt === null;
	}
}

/** parseCatalogue decodes one GET /api/packages answer, or null if anything is off. */
export function parseCatalogue(raw: unknown): Catalogue | null {
	if (!isRecord(raw) || !keysOk(raw, TOP_KEYS) || Object.keys(raw).length !== TOP_KEYS.length) return null;
	if (raw.format !== 1 || typeof raw.instanceId !== 'string' || !ULID.test(raw.instanceId)) return null;
	if (!isStrings(raw.languages) || !sorted(raw.languages, true) || typeof raw.building !== 'boolean') return null;
	const list = raw.packages;
	if (!Array.isArray(list) || !list.every(rowOk)) return null;
	const ids = (list as CatalogueRow[]).map((r) => r.id);
	if (!sorted(ids, true)) return null;
	return raw as unknown as Catalogue;
}

/** getCatalogue reads every package the server lists (`languages=all`), for the Settings page. */
export async function getCatalogue(): Promise<Catalogue> {
	const catalogue = parseCatalogue(await api<unknown>('/api/packages?languages=all'));
	if (catalogue === null) throw new Error('the package catalogue does not match the contract');
	return catalogue;
}

/** getStrokePacks reads GET /api/stroke-packs: the installed stroke packs' credit lines (public). */
export function getStrokePacks(): Promise<StrokePack[]> {
	return api<StrokePack[]>('/api/stroke-packs', { auth: false });
}
