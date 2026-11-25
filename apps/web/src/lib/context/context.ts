// How components reach the app's state (record 0009): Svelte context, never a
// module-level instance. The root layout provides the app context; the current
// session is the app context's, and the layout mounts a new page tree for a new
// session, so a component reads the session it was created in.

import { getContext, setContext } from 'svelte';
import type { AppContext } from './app.svelte';
import type { Session } from './session.svelte';

const APP = Symbol('qinqin.app');

/** provideApp makes `app` the context of the calling component's subtree. */
export function provideApp(app: AppContext): AppContext {
	return setContext(APP, app);
}

/** existingApp: the app context a parent provided, or null (the root layout creates one then). */
export function existingApp(): AppContext | null {
	return getContext<AppContext | undefined>(APP) ?? null;
}

/** useApp: the app context; throws outside one (render with lib/testing/context.ts in tests). */
export function useApp(): AppContext {
	const app = existingApp();
	if (app === null) throw new Error('useApp: no app context (the root layout provides it; tests use testContext())');
	return app;
}

/** useSession: the current session; throws when signed out (signed-in pages only). */
export function useSession(): Session {
	const session = useApp().session;
	if (session === null) throw new Error('useSession: no session (signed out)');
	return session;
}

/** useOptionalSession: the current session, or null signed out (pages open to both). */
export function useOptionalSession(): Session | null {
	return useApp().session;
}

/** contextOf: the context map a component mounts with to see `app` (tests, mount()). */
export function contextOf(app: AppContext): Map<unknown, unknown> {
	return new Map<unknown, unknown>([[APP, app]]);
}
