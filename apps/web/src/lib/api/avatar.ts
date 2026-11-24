// Profile pictures (#189, docs/contracts/auth/avatar.json). A picture is
// served only with the bearer token, so an <img> shows it through an object
// URL the session's AvatarCache holds (revoked when the session ends).

import type { AvatarCache } from '$lib/context/caches';
import { api, apiBlob, isOwnApiPath } from './client';

/** uploadAvatar sends the (already cropped) picture; the server answers its new avatarUrl. */
export async function uploadAvatar(picture: Blob): Promise<string> {
	const form = new FormData();
	form.set('file', picture, 'avatar.png');
	const out = await api<{ avatarUrl: string }>('/api/account/avatar', { method: 'POST', body: form });
	return out.avatarUrl;
}

/** removeAvatar removes your own picture (204 also when there is none). */
export async function removeAvatar(): Promise<void> {
	await api('/api/account/avatar', { method: 'DELETE' });
}

/** removeUserAvatar: an administrator removes user `id`'s picture (audited). */
export async function removeUserAvatar(id: number): Promise<void> {
	await api(`/api/admin/users/${id}/avatar`, { method: 'DELETE' });
}

/** The picture a path names, without the size: `/api/avatars/{user}/{hash}`. */
function pictureOf(path: string): string {
	return path.split('?')[0];
}

/** The user segment of a picture path: `/api/avatars/{user}/`. */
function ownerOf(path: string): string {
	return pictureOf(path).replace(/[^/]*$/, '');
}

/**
 * avatarObjectUrl: an object URL for the picture file at `path` (an avatarUrl,
 * with `?size=64` for the small one), fetched once per session. A failed load
 * is forgotten, so the next use tries again. A new picture of a user revokes
 * that user's earlier one; a picture that arrives after its slot is gone (the
 * session ended, or a newer picture replaced it) is revoked at once.
 */
export function avatarObjectUrl(cache: AvatarCache, path: string): Promise<string> {
	if (!isOwnApiPath(path) || !path.startsWith('/api/avatars/')) {
		return Promise.reject(new Error(`avatar: not a picture path: ${path}`));
	}
	const hit = cache.slots.get(path);
	if (hit) return hit.promise;
	for (const [other, old] of cache.slots) {
		if (ownerOf(other) === ownerOf(path) && pictureOf(other) !== pictureOf(path)) {
			if (old.url) URL.revokeObjectURL(old.url);
			cache.slots.delete(other);
		}
	}
	const slot: { promise: Promise<string>; url?: string } = {
		promise: apiBlob(path).then((blob) => {
			const url = URL.createObjectURL(blob);
			if (cache.slots.get(path) === slot) slot.url = url;
			else URL.revokeObjectURL(url);
			return url;
		})
	};
	slot.promise.catch(() => {
		if (cache.slots.get(path) === slot) cache.slots.delete(path);
	});
	cache.slots.set(path, slot);
	return slot.promise;
}
