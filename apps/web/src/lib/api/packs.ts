import { ApiError, api } from './client';
import { uploadWithProgress, type UploadProgress } from './upload';

import type { Check } from '$lib/theme/contrast';

export type PackType =
	| 'dictionary'
	| 'frequency'
	| 'levels'
	| 'sentences'
	| 'grammar'
	| 'audio'
	| 'components'
	| 'strokes'
	| 'lemma-rules'
	| 'font'
	| 'theme'
	| 'images'
	| 'course';

/** One theme of a staged theme pack with its measured contrast (docs/contracts/themes/README.md, Contrast). */
export interface StagedTheme {
	id: string;
	name: string;
	family: string;
	scheme: 'light' | 'dark';
	checks: Check[];
	failing: number;
}

export interface InstalledPack {
	type: PackType;
	packId: string;
	name: string;
	version: string;
	language: string;
	/** A strokes pack's languages (it has no single language); absent on other types. */
	languages?: string[];
	license: string;
	attribution: string;
	notice: string;
	updatedAt: string;
}

export interface StagedPack {
	token: string;
	expiresAt: string;
	manifest: {
		id: string;
		name: string;
		version: string;
		type: PackType;
		language: string;
		languages?: string[];
		license: string;
		attribution: string;
		notice: string;
		format: string;
	};
	replaces: { version: string; license: string; attribution: string } | null;
	files: number;
	bytes: number;
	/** A theme pack's themes in file order (absent for other types). */
	themes?: StagedTheme[];
}

/** The server's upload cap; a bigger zip is refused before it is sent. */
export const MAX_PACK_UPLOAD = 128 * 1024 * 1024;

export interface StagedStatus {
	status: 'staged' | 'importing' | 'done' | 'failed';
	pack?: InstalledPack;
	summary?: string;
	error?: string;
	/** Set on a done import whose files could not be moved into place. */
	warning?: string;
}

export interface SentencePack {
	packId: string;
	name: string;
	version: string;
	language: string;
	license: string;
	attribution: string;
	notice: string;
}

/** listPacks queries GET /api/admin/packs: every installed pack (admin only). */
export function listPacks(): Promise<InstalledPack[]> {
	return api<InstalledPack[]>('/api/admin/packs');
}

/** stagePack uploads a pack zip; the server validates it and answers with the manifest it parsed. */
export function stagePack(
	file: File,
	opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {}
): Promise<StagedPack> {
	if (file.size > MAX_PACK_UPLOAD) {
		return Promise.reject(
			new ApiError(413, 'pack zip larger than 128 MiB — use qinqin seed for larger packs')
		);
	}
	const form = new FormData();
	form.append('pack', file, file.name);
	return uploadWithProgress<StagedPack>('/api/admin/packs', form, opts);
}

/** installStaged starts the background import; it resolves when the server accepts (202). */
export async function installStaged(token: string, license: string): Promise<void> {
	await api(`/api/admin/packs/staged/${encodeURIComponent(token)}`, { method: 'POST', body: { license } });
}

export function stagedStatus(token: string, signal?: AbortSignal): Promise<StagedStatus> {
	return api<StagedStatus>(`/api/admin/packs/staged/${encodeURIComponent(token)}`, { signal });
}

function abortError(): DOMException {
	return new DOMException('Stopped waiting for the import.', 'AbortError');
}

/** waitForImport polls the status every 2 s until the import is done or failed. */
export async function waitForImport(
	token: string,
	opts: { intervalMs?: number; signal?: AbortSignal; sleep?: (ms: number) => Promise<void> } = {}
): Promise<StagedStatus> {
	const interval = opts.intervalMs ?? 2000;
	const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	for (;;) {
		if (opts.signal?.aborted) throw abortError();
		const status = await stagedStatus(token, opts.signal);
		if (status.status === 'done' || status.status === 'failed') return status;
		await sleep(interval);
	}
}

export async function discardStaged(token: string): Promise<void> {
	await api(`/api/admin/packs/staged/${encodeURIComponent(token)}`, { method: 'DELETE' });
}

export async function uninstallPack(type: PackType, packId: string): Promise<void> {
	await api(`/api/admin/packs/${encodeURIComponent(type)}/${encodeURIComponent(packId)}`, { method: 'DELETE' });
}

/** listSentencePacks queries the public GET /api/sentence-packs for the Sources page. */
export function listSentencePacks(): Promise<SentencePack[]> {
	return api<SentencePack[]>('/api/sentence-packs', { auth: false });
}
