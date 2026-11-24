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

/**
 * avatarObjectUrl: an object URL for the picture file at `path` (an avatarUrl,
 * with `?size=64` for the small one), fetched once per session. A failed load
 * is forgotten, so the next use tries again.
 */
export function avatarObjectUrl(cache: AvatarCache, path: string): Promise<string> {
	if (!isOwnApiPath(path) || !path.startsWith('/api/avatars/')) {
		return Promise.reject(new Error(`avatar: not a picture path: ${path}`));
	}
	const hit = cache.slots.get(path);
	if (hit) return hit.promise;
	const slot: { promise: Promise<string>; url?: string } = {
		promise: apiBlob(path).then((blob) => {
			slot.url = URL.createObjectURL(blob);
			return slot.url;
		})
	};
	slot.promise.catch(() => {
		if (cache.slots.get(path) === slot) cache.slots.delete(path);
	});
	cache.slots.set(path, slot);
	return slot.promise;
}
