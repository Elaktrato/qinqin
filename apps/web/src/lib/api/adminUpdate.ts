import { api } from './client';

export type UpdateState = 'disabled' | 'unchecked' | 'ok' | 'error';
export type UpdateError = 'offline' | 'rate_limited' | 'bad_response';
export type UpdateRelation = 'available' | 'current' | 'ahead' | 'unknown';

export interface LatestRelease {
	version: string;
	tag: string;
	name: string;
	url: string;
	publishedAt: string;
	prerelease: boolean;
	notes: string;
}

/** GET /api/admin/update (docs/contracts/version/update-check.json `answer`). */
export interface UpdateStatus {
	installed: { version: string; commit: string; buildDate: string };
	settings: { enabled: boolean; prereleases: boolean };
	check: {
		state: UpdateState;
		error?: UpdateError;
		stale: boolean;
		latest: LatestRelease | null;
		update: UpdateRelation;
		checkedAt: string | null;
	};
}

export function getUpdateStatus(): Promise<UpdateStatus> {
	return api('/api/admin/update');
}

export function patchUpdateSettings(patch: Partial<UpdateStatus['settings']>): Promise<UpdateStatus> {
	return api('/api/admin/update/settings', { method: 'PATCH', body: patch });
}

export function checkUpdateNow(): Promise<UpdateStatus> {
	return api('/api/admin/update/check', { method: 'POST' });
}
