<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { APP_NAME, APP_NAME_HANZI } from '$lib/app';
	import { t } from '$lib/i18n';
	import NavIcon from '$lib/components/NavIcon.svelte';
	import { iconFor } from '$lib/components/navIcons';
	import WorkspaceCreateForm from '$lib/components/WorkspaceCreateForm.svelte';
	import WorkspacePicker from '$lib/components/WorkspacePicker.svelte';
	import { auth, loadMe, restriction, user } from '$lib/auth';
	import { navLinks } from '$lib/features';
	import { setHookStates } from '$lib/plugins/hooks';
	import { loadPluginStates, pluginStates, resetPluginStates } from '$lib/plugins/states';
	import { recordSessionWhenSettled } from '$lib/events';
	import { syncStudyDayUser } from '$lib/time/zone';
	import { dismissNotice, notice } from '$lib/notices';
	import {
		allowed as routeAllowed,
		normalizePath,
		redirectTarget,
		restrictedTarget,
		routeAccess
	} from '$lib/routeAccess';
	import { startReviewOutbox } from '$lib/study/events';
	import UpdateBanner from '$lib/pwa/UpdateBanner.svelte';
	import OfflineBanner from '$lib/pwa/OfflineBanner.svelte';
	import { registerWorker } from '$lib/pwa/register';
	import { captureInstallPrompt, persistOnceNow } from '$lib/pwa/install';
	import { prepareActiveWorkspace } from '$lib/pwa/prepareRuntime';
	import Logo from '$lib/components/Logo.svelte';
	import LogoutDialog from '$lib/account/LogoutDialog.svelte';
	import { requestSignOut } from '$lib/account/signOut';
	import { logoutPrompt } from '$lib/account/logoutFlow';
	import { watchDeletedWorkspaces } from '$lib/workspaceGone';
	import { themeStore } from '$lib/theme/store.svelte';
	import ThemeSwitch from '$lib/theme/ThemeSwitch.svelte';
	import {
		load as loadWorkspaces,
		workspaces,
		workspacesLoadError,
		workspacesLoaded
	} from '$lib/workspaces';
	import '../app.css';

	let { children } = $props();

	let booted = $state(false);
	// The token whose workspaces are loaded; guards the effect below
	// against refetching on unrelated re-runs.
	let loadedToken = $state<string | null>(null);
	const workspaceError = $derived($workspacesLoadError);

	const path = $derived(normalizePath(page.url.pathname));
	// The core features first, then the enabled plugins in the user's order.
	const pluginLinks = $derived(navLinks($pluginStates));
	// The study-event hook delivers only to plugins the user enabled.
	$effect(() => {
		setHookStates($pluginStates.status === 'ready' ? $pluginStates.list : []);
	});
	const signedIn = $derived($auth.token !== null);
	// An open page (the Sources page) seen signed out gets a minimal
	// shell: the brand, a sign-in link and the footer, nothing private.
	const openSignedOut = $derived(!signedIn && routeAccess(path) === 'open');
	// Render a route only when the session matches it: protected pages
	// never flash while a redirect is in flight, auth pages do not show
	// once signed in, and open pages show either way (lib/routeAccess.ts).
	// A restricted session (forced password change, MFA enrolment) sees only
	// its own page and the open Sources page, and loads nothing of the app.
	const restricted = $derived(signedIn && $restriction !== null);
	const allowed = $derived(
		routeAllowed(path, signedIn, booted) && restrictedTarget(path, $restriction) === null
	);
	// Stats (and its Characters view, the map) is one nav item for
	// every workspace; the tab itself appears only for Han languages.
	const inStats = $derived(path === '/stats' || path.startsWith('/stats/'));
	const noWorkspaces = $derived(
		$workspacesLoaded && !workspaceError && $workspaces.list.length === 0
	);

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	// A guard redirect replaces the history entry it leaves: Back from
	// home after signing in must not land on /login only to be sent home
	// again (a trap that also swallows the page before /login).
	async function navigate(target: string): Promise<void> {
		try {
			await goto(target, { replaceState: true });
		} catch {
			// A redirect from the API layer is already in flight.
		}
	}

	// Focus the content itself (not just scroll to it), so the next Tab
	// continues from there; the URL keeps no #main-content fragment.
	function skipToContent(event: MouseEvent): void {
		const target = document.getElementById('main-content');
		if (!target) return;
		event.preventDefault();
		target.focus();
	}

	// Loads the workspace list; a failure shows a message with "Try again"
	// (the session's token stays, so a transient error is recoverable).
	async function loadShellWorkspaces(): Promise<void> {
		workspacesLoadError.set('');
		try {
			await loadWorkspaces();
		} catch (err) {
			workspacesLoadError.set(message(err, t('app.workspaces.loadFailed')));
		}
	}

	onMount(async () => {
		// A workspace deleted in another tab or on another device: the
		// first "workspace not found" reloads the list and falls back.
		watchDeletedWorkspaces();
		// Installable app: a no-op outside secure contexts (see lib/pwa/register.ts).
		void registerWorker();
		captureInstallPrompt(window); // the root layout lives as long as the page
		void persistOnceNow();
		// The theme list and the device's light/dark switch, signed in or out.
		void themeStore.start();
		// Rehydrate the session from qinqin.token before guarding.
		try {
			await loadMe();
		} catch {
			// api() has already cleared the token and redirected on 401.
		}
		booted = true;
	});

	// Load the user's workspaces once per session, and drop them on
	// logout so another account never sees the previous user's list.
	$effect(() => {
		if (!booted) return;
		const token = $auth.token;
		if (token === null) {
			loadedToken = null;
			workspacesLoaded.set(false);
			workspacesLoadError.set('');
			resetPluginStates();
			dismissNotice();
			workspaces.set({ list: [], current: null });
			return;
		}
		// Nothing of the app loads for a restricted session; the effect runs
		// again when the restriction clears.
		if ($restriction !== null) return;
		if (token === loadedToken) return;
		loadedToken = token;
		workspacesLoaded.set(false);
		// Drain reviews queued while offline as soon as a session exists,
		// on whichever route the user opens. Never blocks the boot.
		startReviewOutbox();
		void loadPluginStates();
		void loadShellWorkspaces();
	});

	// Keep today's study queue available offline: a few seconds after the
	// active workspace is up, and again whenever the app comes back to the
	// front (throttled inside; a no-op without a controlling worker).
	$effect(() => {
		const id = $workspacesLoaded && $restriction === null ? ($workspaces.current?.id ?? null) : null;
		if (id === null) return;
		const run = () => void prepareActiveWorkspace();
		const timer = setTimeout(run, 4000);
		const onVisible = () => {
			if (document.visibilityState === 'visible') run();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearTimeout(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	// The person's appearance row: loaded once per signed-in user (not for a
	// restricted session); signing out forgets it and keeps what is painted.
	let themeUser: number | null | undefined = undefined;
	$effect(() => {
		const id = booted && signedIn && $restriction === null ? ($user?.id ?? null) : null;
		if (id === themeUser) return;
		themeUser = id;
		void themeStore.setUser(id);
	});

	// The learner's time zone history (and, once per account, the browser
	// zone as its default) loads right after sign-in; every "day" follows it.
	// Signing out forgets it, so signing in again (same user, no reload)
	// loads it again instead of falling back to the browser zone.
	$effect(() => {
		void syncStudyDayUser($user?.id ?? null);
	});

	// One session event per workspace per learner day, recorded for whichever
	// workspace is active once the list is in: the first one at load and any
	// the user switches to or creates later (receipts keep it once a day).
	$effect(() => {
		const id = $workspacesLoaded ? ($workspaces.current?.id ?? null) : null;
		// The receipt is keyed by the learner day, so wait for the zone to settle.
		if (id !== null) void recordSessionWhenSettled(id);
	});

	// Re-evaluate on every client-side navigation and auth change, so
	// logout (or a token expiring) cannot leave a protected page mounted.
	// Open pages never redirect.
	$effect(() => {
		if (!booted) return;
		const restrictedTo = restrictedTarget(path, $restriction);
		if (restrictedTo !== null) {
			void navigate(restrictedTo);
			return;
		}
		const target = redirectTarget(path, signedIn);
		if (target !== null) void navigate(target);
	});
</script>

{#if allowed}
	<!-- First focusable element: jumps past the header and its nav. -->
	<a class="skip-link" href="#main-content" onclick={skipToContent}>{t('nav.skipToContent')}</a>
	<div class="app" class:with-bar={signedIn}>
		<UpdateBanner />
		<OfflineBanner />
		{#if signedIn}
			<header class="shell">
				<!-- The logo is the home link (there is no separate Home tab). -->
				<a
					class="brand"
					href="/"
					aria-label={t('nav.brand.home', { app: APP_NAME })}
					title={t('nav.brand.homeTitle', { app: APP_NAME })}
					aria-current={path === '/' ? 'page' : undefined}><Logo size={30} /></a
				>

				<!-- Wide screens: pills in the header. Below 720 px: a fixed
				     bottom tab bar (see the styles). -->
				{#if !restricted}
				<nav class="main-nav" aria-label={t('nav.main')}>
					<a href="/search" aria-current={path === '/search' ? 'page' : undefined}
						><NavIcon name={iconFor('search')} /><span class="label">{t('nav.search')}</span></a
					>
					{#each pluginLinks as link (`${link.slug}:${link.title}`)}
						<a
							href={link.href}
							aria-current={path === link.href || path.startsWith(`${link.href}/`)
								? 'page'
								: undefined}
							><NavIcon name={iconFor(link.slug, link.title)} /><span class="label"
								>{link.title}</span
							></a
						>
					{/each}
				</nav>

				<div class="workspace">
					<WorkspacePicker />
				</div>
				{/if}
				<div class="account">
					<!-- The quick theme switch; the account menu of the frame
					     rework (#99) takes it over. -->
					{#if !restricted}<ThemeSwitch />{/if}
					{#if $user}
						<span class="username">{$user.username}</span>
					{/if}
					<button type="button" class="sign-out" title={t('nav.signOut')} onclick={() => void requestSignOut()}
						><NavIcon name={iconFor('signout')} size={18} /><span class="label">{t('nav.signOut')}</span
						></button
					>
				</div>
			</header>

			{#if workspaceError && !restricted}
				<p class="workspace-error" role="alert">
					{workspaceError}
					<button type="button" class="retry" onclick={() => void loadShellWorkspaces()}>
						{t('app.workspaces.retry')}
					</button>
				</p>
			{/if}
		{:else if openSignedOut}
			<!-- Signed out on an open page: no nav of private pages, no
			     workspace picker, no account. -->
			<header class="shell">
				<a
					class="brand"
					href="/login"
					aria-label={t('nav.brand.signIn', { app: APP_NAME })}
					title={t('nav.brand.signInTitle', { app: APP_NAME })}><Logo size={30} /></a
				>
				<div class="account guest">
					<a class="sign-in" href="/login"
						><NavIcon name={iconFor('signin')} size={18} /><span>{t('nav.signIn')}</span></a
					>
				</div>
			</header>
		{/if}

		<!-- Always in the DOM, so screen readers announce what arrives. -->
		<div class="notice-region" role="status">
			{#if signedIn && $notice}
				<p class="notice">
					<span>{$notice}</span>
					<button type="button" class="notice-dismiss" onclick={dismissNotice}>{t('app.notice.dismiss')}</button>
				</p>
			{/if}
		</div>

		{#if $logoutPrompt !== null}<LogoutDialog />{/if}

		<div class="content" id="main-content" tabindex="-1">
			{#if signedIn && !restricted && noWorkspaces}
				<section class="empty-workspaces" aria-labelledby="empty-workspaces-heading">
					<h2 id="empty-workspaces-heading">{t('app.workspaces.emptyTitle')}</h2>
					<p>{t('app.workspaces.emptyText')}</p>
					<WorkspaceCreateForm idPrefix="empty-new" />
				</section>
			{/if}

			{@render children()}
		</div>

		{#if signedIn}
			<footer class="footer">
				<nav class="footer-links" aria-label={t('nav.footer')}>
					{#if !restricted}
						<a href="/stats" aria-current={inStats ? 'page' : undefined}
							><NavIcon name={iconFor('stats')} size={16} /><span>{t('nav.stats')}</span></a
						>
					{/if}
					<a href="/sources" aria-current={path === '/sources' ? 'page' : undefined}
						><NavIcon name={iconFor('sources')} size={16} /><span>{t('nav.sources')}</span></a
					>
					{#if !restricted}
						<a href="/settings" aria-current={path === '/settings' ? 'page' : undefined}
							><NavIcon name={iconFor('settings')} size={16} /><span>{t('nav.settings')}</span></a
						>
					{/if}
				</nav>
				<span class="version">
					<span lang="zh">{APP_NAME_HANZI}</span>
					{APP_NAME}
				</span>
			</footer>
		{:else if openSignedOut}
			<footer class="footer">
				<nav class="footer-links" aria-label={t('nav.footer')}>
					<a href="/sources" aria-current={path === '/sources' ? 'page' : undefined}
						><NavIcon name={iconFor('sources')} size={16} /><span>{t('nav.sources')}</span></a
					>
					<a href="/login"><NavIcon name={iconFor('signin')} size={16} /><span>{t('nav.signIn')}</span></a>
				</nav>
				<span class="version">
					<span lang="zh">{APP_NAME_HANZI}</span>
					{APP_NAME}
				</span>
			</footer>
		{/if}
	</div>
{:else}
	<p class="booting">{t('app.loading')}</p>
{/if}

<style>
	.app {
		/* Nav accent: the theme's accent; text on its tint uses the reading
		   accent (the accent where it reaches 4.5:1, else the text colour). */
		--nav-accent: var(--accent);
		--nav-accent-text: var(--reading-accent);
		/* The fixed bottom tab bar's height (0 while there is none). Fixed
		   elements further down, such as the reader's drawer button, keep
		   clear of the bar with it. */
		--bottom-bar-height: 0px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		min-height: 100dvh;
	}

	.content {
		flex: 1 0 auto;
	}

	/* Focused by the skip link only; a ring around the whole page would
	   be noise. */
	.content:focus {
		outline: none;
	}

	.skip-link {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		z-index: 100;
		padding: 0.5rem 0.9rem;
		border-radius: 0.5rem;
		background: Canvas;
		color: CanvasText;
		font-weight: 600;
		box-shadow: 0 0.125rem 0.75rem rgb(0 0 0 / 0.2);
		transform: translateY(-200%);
	}

	.skip-link:focus {
		transform: none;
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.shell {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1.25rem;
		padding: 0.6rem 1.5rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.15rem;
		font-weight: 700;
		text-decoration: none;
		color: inherit;
		padding: 0.2rem 0.45rem;
		border-radius: 0.5rem;
	}

	.brand:hover {
		background: color-mix(in srgb, currentColor 8%, transparent);
	}

	.brand[aria-current='page'] {
		color: var(--nav-accent-text);
		background: color-mix(in srgb, var(--nav-accent) 14%, transparent);
	}

	.brand:focus-visible,
	.main-nav a:focus-visible,
	.footer a:focus-visible,
	.account button:focus-visible {
		outline: 2px solid var(--nav-accent);
		outline-offset: 2px;
	}

	.main-nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.main-nav a {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.8rem 0.4rem 0.65rem;
		border-radius: 999px;
		color: inherit;
		text-decoration: none;
		opacity: 0.85;
		transition:
			background-color 0.12s ease,
			color 0.12s ease;
	}

	.main-nav a:hover {
		opacity: 1;
		background: color-mix(in srgb, currentColor 8%, transparent);
	}

	.main-nav a[aria-current='page'] {
		opacity: 1;
		font-weight: 600;
		color: var(--nav-accent-text);
		background: color-mix(in srgb, var(--nav-accent) 14%, transparent);
	}

	.workspace {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-left: auto;
	}

	.account {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	.username {
		font-weight: 600;
	}

	.account button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font: inherit;
		padding: 0.3rem 0.65rem 0.3rem 0.5rem;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.account button:hover {
		background: color-mix(in srgb, currentColor 8%, transparent);
	}

	/* Signed out: the sign-in link sits where the account would. */
	.account.guest {
		margin-left: auto;
	}

	.sign-in {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.75rem 0.3rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 999px;
		color: inherit;
		text-decoration: none;
		font-weight: 600;
	}

	.sign-in:hover {
		background: color-mix(in srgb, currentColor 8%, transparent);
	}

	.sign-in:focus-visible {
		outline: 2px solid var(--nav-accent);
		outline-offset: 2px;
	}

	.workspace-error {
		margin: 0;
		padding: 0.5rem 1.5rem;
		color: #c62828;
		font-weight: 600;
	}

	.workspace-error .retry {
		margin-left: 0.75rem;
		font: inherit;
		font-weight: 500;
		padding: 0.15rem 0.6rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		margin: 0;
		padding: 0.5rem 1.5rem;
		background: color-mix(in srgb, var(--nav-accent) 12%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--nav-accent) 30%, transparent);
	}

	.notice-dismiss {
		font: inherit;
		font-size: 0.9rem;
		padding: 0.2rem 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.notice-dismiss:focus-visible {
		outline: 2px solid var(--nav-accent);
		outline-offset: 2px;
	}

	.empty-workspaces {
		margin: 2rem auto 0;
		max-width: 28rem;
		padding: 1.25rem 1.5rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.5rem;
	}

	.empty-workspaces h2 {
		margin-top: 0;
	}

	.footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1.5rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		font-size: 0.9rem;
	}

	.footer-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		margin-inline-start: -0.55rem;
	}

	.footer a {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.65rem 0.3rem 0.55rem;
		border-radius: 999px;
		color: inherit;
		text-decoration: none;
		opacity: 0.85;
	}

	.footer a:hover {
		opacity: 1;
		background: color-mix(in srgb, currentColor 8%, transparent);
	}

	.footer a[aria-current='page'] {
		opacity: 1;
		font-weight: 600;
		color: var(--nav-accent-text);
		background: color-mix(in srgb, var(--nav-accent) 14%, transparent);
	}

	.version {
		opacity: 0.65;
	}

	/* Phones and narrow windows: the main nav becomes a fixed bottom tab
	   bar (icon above label), like a mobile app. The header keeps the
	   logo, the workspace picker and the account. */
	@media (max-width: 719.98px) {
		.app.with-bar {
			--bottom-bar-height: calc(3.75rem + env(safe-area-inset-bottom, 0px));
			/* Nothing (the footer included) ends up behind the bar. */
			padding-bottom: var(--bottom-bar-height);
		}

		/* Keyboard focus, scrollIntoView and fragment jumps stop above the
		   bar, not behind it (WCAG 2.4.11): the bar's height (the same
		   expression as --bottom-bar-height, which lives on .app and so
		   is not visible on the root) plus a margin. The bar is a width
		   query, so this also covers desktop browsers at high zoom. */
		:global(html:has(.app.with-bar)) {
			scroll-padding-bottom: calc(3.75rem + env(safe-area-inset-bottom, 0px) + 0.75rem);
		}

		.shell {
			flex-wrap: nowrap;
			gap: 0.5rem;
			padding: 0.5rem 1rem;
		}

		.workspace {
			min-width: 0;
		}

		.main-nav {
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			/* Under the reader drawer (30), its button (25) and lookup
			   popups (50+). */
			z-index: 20;
			box-sizing: border-box;
			height: var(--bottom-bar-height);
			flex-wrap: nowrap;
			justify-content: space-around;
			gap: 0;
			padding: 0.3rem 0.5rem env(safe-area-inset-bottom, 0px);
			overflow-x: auto;
			background: Canvas;
			color: CanvasText;
			border-top: 1px solid color-mix(in srgb, currentColor 16%, transparent);
			box-shadow: 0 -0.125rem 0.75rem rgb(0 0 0 / 0.08);
		}

		.main-nav a {
			flex: 1 1 0;
			min-width: 3.5rem;
			max-width: 7rem;
			flex-direction: column;
			justify-content: center;
			gap: 0.15rem;
			padding: 0.25rem 0.25rem;
			border-radius: 0.75rem;
			font-size: 0.72rem;
			line-height: 1.1;
		}

		.main-nav a:focus-visible {
			outline-offset: -2px;
		}

		.main-nav .label {
			max-width: 100%;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		/* The tint sits on the icon, like a mobile tab bar. */
		.main-nav a[aria-current='page'] {
			background: none;
		}

		.main-nav a :global(.nav-icon) {
			box-sizing: content-box;
			padding: 0.15rem 0.9rem;
			border-radius: 999px;
		}

		.main-nav a[aria-current='page'] :global(.nav-icon) {
			background: color-mix(in srgb, var(--nav-accent) 16%, transparent);
		}

		.username {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			max-width: 6rem;
		}

		/* Icon-only on phones; the label stays as the accessible name. */
		.sign-out {
			padding: 0.35rem;
		}

		.sign-out .label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	.booting {
		margin: 0 auto;
		max-width: 48rem;
		padding: 3rem 1.5rem;
	}
</style>
