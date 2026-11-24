// The map moved under Stats. Old links and bookmarks land there; the
// redirect replaces this history entry, so Back skips the old URL.
import { redirect } from '@sveltejs/kit';
import { legacyRedirect } from '$lib/routing/legacyRoutes';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	redirect(308, legacyRedirect(url) ?? '/stats/characters');
};
