<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { APP_NAME } from '$lib/app';
	import { t } from '$lib/i18n';
	import WorkspaceCreateForm from '$lib/components/WorkspaceCreateForm.svelte';
	import { auth, loadMe, restriction, user } from '$lib/auth';
	import AccountMenu from '$lib/frame/AccountMenu.svelte';
	import { currentSection, frameSections, homeSection } from '$lib/frame/sections';
	import { barHiddenOn } from '$lib/frame/barItems';
	import BottomBar from '$lib/frame/BottomBar.svelte';
	import { navLayoutStore } from '$lib/frame/navLayoutStore.svelte';
	import PhoneBar from '$lib/frame/PhoneBar.svelte';
	import TopBar from '$lib/frame/TopBar.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
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
	import { logoutPrompt } from '$lib/account/logoutFlow';
	import { watchDeletedWorkspaces } from '$lib/workspaceGone';
	import { themeStore } from '$lib/theme/store.svelte';
	import { packFaces } from '$lib/fonts/packFaces.svelte';
	import { applyHanziVars, hanziVars } from '$lib/fonts/hanziVars';
	import {
		load as loadWorkspaces,
		workspaces,
		workspacesLoadError,
		workspacesLoaded
	} from '$lib/workspaces';
	import '../app.css';
	import '$lib/fonts/hanzi.css';

	let { children } = $props();

	let booted = $state(false);
	// The token whose workspaces are loaded; guards the effect below
	// against refetching on unrelated re-runs.
	let loadedToken = $state<string | null>(null);
	const workspaceError = $derived($workspacesLoadError);

	const path = $derived(normalizePath(page.url.pathname));
	// The frame's sections (lib/frame/sections.ts): the core features, the
	// enabled plugin pages in the user's order, Search, Stats.
	const sections = $derived(frameSections($pluginStates));
	const current = $derived(currentSection(path, sections));
	// The study-event hook delivers only to plugins the user enabled.
	$effect(() => {
		setHookStates($pluginStates.status === 'ready' ? $pluginStates.list : []);
	});
	const signedIn = $derived($auth.token !== null);
	// An open page (the Sources page) seen signed out gets a minimal
	// bar: the logo (to sign in) and a sign-in link, nothing private.
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
	// The frame (window frame, bar, raised panel) shows with a bar: signed
	// in, or signed out on an open page. Sign-in pages stay plain.
	const framed = $derived(signedIn || openSignedOut);
	// The phone navigation (#188, the person's nav-layout row): the bottom bar
	// (default) or the side menu. Desktop and tablet widths ignore it: the
	// bar is in the phone-only wrapper and every rule for it is phone-only.
	const phoneMode = $derived(navLayoutStore.phone);
	const barSections = $derived([homeSection(), ...sections]);
	const bottomBar = $derived(signedIn && !restricted && phoneMode === 'bar' && !barHiddenOn(path));
	$effect(() => {
		// :root carries the switch, so the page's scroll padding (app.css) and
		// fixed elements (--bottom-bar-space) keep clear of the bar.
		document.documentElement.toggleAttribute('data-bottom-bar', bottomBar);
		return () => document.documentElement.removeAttribute('data-bottom-bar');
	});
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
		void navLayoutStore.setUser(id);
		// The installed font pack faces (#97): the list needs a session.
		if (id === null) packFaces.clear();
		else void packFaces.load();
	});

	// Back to the front: another device may have changed the phone navigation.
	$effect(() => {
		const onVisible = () => {
			if (document.visibilityState === 'visible') void navLayoutStore.resume();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

	// The app-wide hanzi font (#97): the saved choice (or the Appearance
	// preview) sets one stack per script on :root, an installed pack face
	// first; only that face's slices are registered.
	const hanziFont = $derived((themeStore.preview ?? themeStore.appearance).hanziFont);
	$effect(() => {
		applyHanziVars(hanziVars(hanziFont, packFaces.installed), document.documentElement);
		packFaces.need('app', [hanziFont]);
	});

	// The learner's time zone history (and, once per account, the browser
	// zone as its default) loads right after sign-in; every "day" follows it.
	// Signing out forgets it, so signing in again (same user, no reload)
	// loads it again instead of falling back to the browser zone.
	// Not for a restricted session: the zone call would 403 and loop.
	$effect(() => {
		void syncStudyDayUser($restriction === null ? ($user?.id ?? null) : null);
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
	<!-- First focusable element on every page: jumps past the bar. -->
	<a class="skip-link" href="#main-content" onclick={skipToContent}>{t('nav.skipToContent')}</a>
	<div class="frame" class:framed>
		{#if signedIn && !restricted}
			<!-- One banner landmark holding both bars (#99): the desktop bar
			     (frame A) at 720px and wider, the phone bar below. A CSS switch
			     (no layout jump, follows zoom); the hidden one is display: none,
			     so it is out of the accessibility tree and the tab order. -->
			<header class="bar">
				<div class="desktop" data-frame="desktop"><TopBar {sections} {current} /></div>
				<div class="phone" data-frame="phone"><PhoneBar {sections} {current} mode={phoneMode} /></div>
			</header>
		{:else if framed}
			<!-- A restricted session (forced password change, MFA enrolment)
			     and a signed-out visitor of an open page: the logo and the
			     account menu (Sources and Sign out only) or a sign-in link; no sections,
			     no workspace, nothing private. -->
			<header class="bar">
				<div class="minimal">
					<Tooltip text={signedIn ? t('nav.home') : t('nav.brand.signInTitle', { app: APP_NAME })}>
						{#snippet children()}
							<a
								class="brand"
								href={signedIn ? '/' : '/login'}
								aria-label={signedIn
									? t('nav.brand.home', { app: APP_NAME })
									: t('nav.brand.signIn', { app: APP_NAME })}><Logo /></a
							>
						{/snippet}
					</Tooltip>
					{#if signedIn}
						<AccountMenu restricted />
					{:else}
						<a class="sign-in" href="/login"><Icon name="sign-in" size="s" /><span>{t('nav.signIn')}</span></a>
					{/if}
				</div>
			</header>
		{/if}

		<!-- The page: a raised panel on the window frame (desktop), the
		     whole width on the phone. Notices about the page sit at its top. -->
		<div class="panel">
			<UpdateBanner />
			<OfflineBanner />
			{#if workspaceError && signedIn && !restricted}
				<p class="workspace-error" role="alert">
					{workspaceError}
					<button type="button" class="retry" onclick={() => void loadShellWorkspaces()}>
						{t('app.workspaces.retry')}
					</button>
				</p>
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

			<!-- The one main landmark of every page (the skip link's target):
			     pages bring plain containers, never their own <main>. -->
			<main class="content" id="main-content" tabindex="-1">
				{#if signedIn && !restricted && noWorkspaces}
					<section class="empty-workspaces" aria-labelledby="empty-workspaces-heading">
						<h2 id="empty-workspaces-heading">{t('app.workspaces.emptyTitle')}</h2>
						<p>{t('app.workspaces.emptyText')}</p>
						<WorkspaceCreateForm idPrefix="empty-new" />
					</section>
				{/if}

				{@render children()}
			</main>
		</div>

		{#if bottomBar}
			<!-- The phone bottom bar (#188), after the page in the reading order
			     (a nav landmark of its own). Phone only: the wrapper is display:
			     none at 720px and wider. -->
			<div class="phone" data-frame="phone-nav">
				<BottomBar sections={barSections} bar={navLayoutStore.bar} {current} />
			</div>
		{/if}
	</div>
{:else}
	<p class="booting">{t('app.loading')}</p>
{/if}

<style>
	/* The frame (#99, design §9 frame A): the window frame in --chrome holds
	   the bar; the page is a raised --panel inset 0.5rem with large corners.
	   The page scrolls with the window (not inside the panel), so find in
	   page, scroll restoration and fragment jumps keep working. */
	.frame {
		box-sizing: border-box;
		/* viewport-fit=cover (app.html, for the bottom bar's safe area): keep
		   clear of a notch or the status bar; every inset is 0 on desktop. */
		padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) 0 env(safe-area-inset-left, 0px);
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		min-height: 100dvh;
		background: var(--panel);
	}

	.frame.framed {
		background: var(--chrome);
	}

	.panel {
		flex: 1 0 auto;
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--panel);
		color: var(--text);
	}

	.framed .panel {
		margin: 0 0.5rem 0.5rem;
		border-radius: var(--radius-large);
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
		z-index: var(--layer-modal);
		padding: 0.5rem 0.9rem;
		border-radius: var(--radius);
		background: var(--panel);
		color: var(--text);
		font-weight: var(--weight-strong);
		box-shadow: var(--shadow-float);
		transform: translateY(-200%);
	}

	.skip-link:focus {
		transform: none;
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.bar {
		color: var(--text);
	}

	.minimal {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		min-height: 3rem;
		padding: 0 var(--space-3);
	}

	.brand {
		display: inline-grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius);
		color: var(--accent);
	}

	.brand:hover,
	.sign-in:hover {
		background: var(--raised);
	}

	.brand:focus-visible,
	.sign-in:focus-visible,
	.retry:focus-visible,
	.notice-dismiss:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.sign-in {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		color: inherit;
		text-decoration: none;
		font-weight: var(--weight-strong);
	}

	.workspace-error {
		margin: 0;
		padding: var(--space-2) var(--space-4);
		padding-inline-start: var(--space-3);
		border-inline-start: 3px solid var(--bad);
		color: var(--readable-bad);
		font-weight: var(--weight-strong);
	}

	.retry,
	.notice-dismiss {
		margin-inline-start: var(--space-3);
		font: inherit;
		font-weight: var(--weight-medium);
		padding: 0.15rem 0.6rem;
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		margin: 0;
		padding: var(--space-2) var(--space-4);
		background: var(--primary-wash);
		border-bottom: 1px solid var(--hair);
	}

	.empty-workspaces {
		margin: 2rem auto 0;
		max-width: 28rem;
		padding: 1.25rem 1.5rem;
	}

	.empty-workspaces h2 {
		margin-top: 0;
	}

	.phone {
		display: none;
	}

	/* The phone frame (lib/frame/breakpoint.ts): the phone bar, and the page
	   takes the whole width. */
	@media (max-width: 719.98px) {
		.desktop {
			display: none;
		}
		.phone {
			display: block;
		}
		.framed .panel {
			margin: 0;
			border-radius: 0;
		}
		/* The bottom bar is fixed over the page's end: the page ends above it
		   (app.css sets --bottom-bar-space with the bar, safe area included). */
		.framed .panel {
			padding-bottom: var(--bottom-bar-space);
		}
	}

	@media (forced-colors: active) {
		/* Fills vanish: the panel keeps an edge. */
		.framed .panel {
			outline: 1px solid CanvasText;
		}
		.brand {
			color: LinkText;
		}
	}

	.booting {
		margin: 0 auto;
		max-width: 48rem;
		padding: 3rem 1.5rem;
	}
</style>
