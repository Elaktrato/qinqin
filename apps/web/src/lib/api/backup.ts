import { api } from './client';
import { uploadWithProgress, type UploadProgress } from './upload';
import type { StageView } from '$lib/account/backupView';

export interface TicketReply {
	url: string;
	expiresInSeconds: number;
}

/** Asks for a one-time download link of the caller's own data. */
export function requestExport(): Promise<TicketReply> {
	return api('/api/account/export', { method: 'POST' });
}

/** Starts the download: the ticket URL needs no bearer token. */
export async function downloadMyData(assign: (url: string) => void = (u) => location.assign(u)): Promise<void> {
	const t = await requestExport();
	assign(t.url);
}

export function uploadRestore(file: Blob, onProgress?: (p: UploadProgress) => void): Promise<{ token: string }> {
	return uploadWithProgress('/api/account/restore', file, { contentType: 'application/zip', onProgress });
}

export function restoreStatus(token: string): Promise<StageView> {
	return api(`/api/account/restore/${encodeURIComponent(token)}`);
}

export interface ApplyBody {
	confirm: string;
	password: string;
	code?: string;
	unresolved?: 'drop';
}

export function applyRestore(token: string, body: ApplyBody): Promise<{ status: string }> {
	return api(`/api/account/restore/${encodeURIComponent(token)}`, { method: 'POST', body });
}

export function discardRestore(token: string): Promise<void> {
	return api(`/api/account/restore/${encodeURIComponent(token)}`, { method: 'DELETE' });
}

export function safetyExportTicket(): Promise<TicketReply> {
	return api('/api/account/restore/safety-export', { method: 'POST' });
}

export interface ServerBackupBody {
	currentPassword: string;
	include: string[];
}

export function createServerBackup(body: ServerBackupBody): Promise<TicketReply & { include: string[] }> {
	return api('/api/admin/backup', { method: 'POST', body });
}
