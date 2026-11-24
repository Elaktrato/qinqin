// Journal AI and photo routes (server: handlers_journal*.go). Photos are
// temporary: nothing here stores one.

import { ApiError, api, apiBlob } from '$lib/api/client';
import { parseReview } from './review';
import type { Capabilities, Review, Suggestions } from './types';

export async function requestReview(
	workspaceId: number,
	entryId: string,
	signal?: AbortSignal
): Promise<Review> {
	const v = await api<unknown>('/api/journal/review', { body: { workspaceId, entryId }, signal });
	const review = parseReview(v);
	if (review === null) throw new Error('journal: the review reply is not a review');
	return review;
}

export function requestSuggestions(workspaceId: number, signal?: AbortSignal): Promise<Suggestions> {
	return api<Suggestions>('/api/journal/suggestions', { body: { workspaceId }, signal });
}

export function getCapabilities(workspaceId: number): Promise<Capabilities> {
	return api<Capabilities>(`/api/journal/capabilities?workspace=${workspaceId}`);
}

export function uploadPhoto(workspaceId: number, file: Blob): Promise<{ photoId: string }> {
	const form = new FormData();
	form.set('workspace', String(workspaceId));
	form.set('file', file);
	return api<{ photoId: string }>('/api/journal/photos', { body: form });
}

/** The photo as a blob URL (an <img> cannot send the bearer token); the caller revokes it. */
export async function photoObjectUrl(photoId: string): Promise<string> {
	const blob = await apiBlob(`/api/journal/photos/${encodeURIComponent(photoId)}`);
	return URL.createObjectURL(blob);
}

/** Deletes a pending photo; one that is already gone counts as done. */
export async function deletePhoto(photoId: string): Promise<void> {
	try {
		await api(`/api/journal/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' });
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return;
		throw err;
	}
}

export async function keepPhotoAlive(photoId: string): Promise<void> {
	await api(`/api/journal/photos/${encodeURIComponent(photoId)}/keepalive`, { method: 'PUT' });
}

export function transcribe(
	workspaceId: number,
	photoId: string,
	engine: 'ai' | 'offline'
): Promise<{ text: string; engine: string; unreadable: boolean }> {
	return api('/api/journal/transcribe', { body: { workspaceId, photoId, engine } });
}
