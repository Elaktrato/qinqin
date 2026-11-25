// The old plugin URLs: the four core features were plugins at /p/<slug>
// (#199). Their links land on the core routes, the redirect replacing this
// history entry; every other plugin id is gone.
import { error, redirect } from '@sveltejs/kit';
import { legacyRedirect } from '$lib/routing/legacyRoutes';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const moved = legacyRedirect(url);
	if (moved === null) error(404);
	redirect(308, moved);
};
