<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { APP_NAME, APP_NAME_HANZI } from '$lib/app';
	import NavIcon from '$lib/components/NavIcon.svelte';
	import { iconFor } from '$lib/components/navIcons';
	import WorkspaceCreateForm from '$lib/components/WorkspaceCreateForm.svelte';
	import WorkspacePicker from '$lib/components/WorkspacePicker.svelte';
	import { usesHan } from '$lib/languages';
	import { auth, loadMe, logout, user } from '$lib/auth';
	import { visibleNavPages, webPlugins } from '$lib/plugins';
	import { loadPluginStates, pluginStates, resetPluginStates } from '$lib/plugins/states';
	import { recordSessionOnce } from '$lib/events';
	import { dismissNotice, notice } from '$lib/notices';
	import { startReviewOutbox } from '$lib/study/events';
	import { watchDeletedWorkspaces } from '$lib/workspaceGone';
	import { load as loadWorkspaces, workspaces } from '$lib/workspaces';
	import '../app.css';

	let { children } = $props();

	let booted = $state(false);
	// The token whose workspaces are loaded; guards the effect below
	// against refetching on unrelated re-runs.
	let loadedToken = $state<string | null>(null);
	let workspaceError = $state('');
	// True once the workspace list for the current session has arrived,
	// so the empty state never flashes while it is loading.
	let workspacesLoaded = $state(false);

	const publicPaths = new Set(['/login', '/register']);

	const path = $derived(page.url.pathname.replace(/\/+$/, '') || '/');
	const pluginLinks = $derived(visibleNavPages(webPlugins, $pluginStates));
	const isPublic = $derived(publicPaths.has(path));
	const signedIn = $derived($auth.token !== null);
	// Render a route only when the session matches it: protected pages
	// never flash while a redirect is in flight, and auth pages do not
	// show once signed in.
	const allowed = $derived(booted && (signedIn ? !isPublic : isPublic));
	// The character map only makes sense for Han-script languages.
	const showMap = $derived(
		$workspaces.current !== null && usesHan($workspaces.current.language)
	);
	const noWorkspaces = $derived(
		workspacesLoaded && !workspaceError && $workspaces.list.length === 0
	);

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	async function navigate(target: string): Promise<void> {
		try {
			await goto(target);
		} catch {
			// A redirect from the API layer is already in flight.
		}
	}

	onMount(async () => {
		// A workspace deleted in another tab or on another device: the
		// first "workspace not found" reloads the list and falls back.
		watchDeletedWorkspaces();
		// Drain reviews queued while offline as soon as the shell boots,
		// on whichever route the user opens. Never blocks the boot.
		startReviewOutbox();
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
			workspacesLoaded = false;
			resetPluginStates();
			dismissNotice();
			workspaces.set({ list: [], current: null });
			return;
		}
		if (token === loadedToken) return;
		loadedToken = token;
		workspaceError = '';
		workspacesLoaded = false;
		void loadPluginStates();
		void loadWorkspaces()
			.then(() => {
				workspacesLoaded = true;
				// One session event per workspace per UTC day, recorded
				// once the shell knows which workspace is active.
				const current = get(workspaces).current;
				if (current) recordSessionOnce(current.id);
			})
			.catch((err) => {
				workspaceError = message(err, 'Could not load workspaces.');
			});
	});

	// Re-evaluate on every client-side navigation and auth change, so
	// logout (or a token expiring) cannot leave a protected page mounted.
	$effect(() => {
		if (!booted) return;
		if (!signedIn && !isPublic) {
			void navigate('/login');
		} else if (signedIn && isPublic) {
			void navigate('/');
		}
	});
</script>

{#if allowed}
	<div class="app" class:with-bar={signedIn}>
		{#if signedIn}
			<header class="shell">
				<!-- The logo is the home link (there is no separate Home tab). -->
				<a
					class="brand"
					href="/"
					lang="zh"
					aria-label={APP_NAME}
					title={APP_NAME}
					aria-current={path === '/' ? 'page' : undefined}>{APP_NAME_HANZI}</a
				>

				<!-- Wide screens: pills in the header. Below 720 px: a fixed
				     bottom tab bar (see the styles). -->
				<nav class="main-nav" aria-label="Main">
					<a href="/search" aria-current={path === '/search' ? 'page' : undefined}
						><NavIcon name={iconFor('search')} /><span class="label">Search</span></a
					>
					{#if showMap}
						<a href="/study/map" aria-current={path === '/study/map' ? 'page' : undefined}
							><NavIcon name={iconFor('map')} /><span class="label">Map</span></a
						>
					{/if}
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
				<div class="account">
					{#if $user}
						<span class="username">{$user.username}</span>
					{/if}
					<button type="button" class="sign-out" title="Sign out" onclick={logout}
						><NavIcon name={iconFor('signout')} size={18} /><span class="label">Sign out</span
						></button
					>
				</div>
			</header>

			{#if workspaceError}
				<p class="workspace-error" role="alert">{workspaceError}</p>
			{/if}
		{/if}

		<!-- Always in the DOM, so screen readers announce what arrives. -->
		<div class="notice-region" role="status">
			{#if signedIn && $notice}
				<p class="notice">
					<span>{$notice}</span>
					<button type="button" class="notice-dismiss" onclick={dismissNotice}>Dismiss</button>
				</p>
			{/if}
		</div>

		<div class="content">
			{#if signedIn && noWorkspaces}
				<section class="empty-workspaces" aria-labelledby="empty-workspaces-heading">
					<h2 id="empty-workspaces-heading">Create your first workspace</h2>
					<p>
						A workspace holds your study cards, reading library and progress for one language.
						Pick a language to begin.
					</p>
					<WorkspaceCreateForm idPrefix="empty-new" />
				</section>
			{/if}

			{@render children()}
		</div>

		{#if signedIn}
			<footer class="footer">
				<nav class="footer-links" aria-label="Footer">
					<a href="/sources" aria-current={path === '/sources' ? 'page' : undefined}
						><NavIcon name={iconFor('sources')} size={16} /><span>Sources</span></a
					>
					<a href="/settings" aria-current={path === '/settings' ? 'page' : undefined}
						><NavIcon name={iconFor('settings')} size={16} /><span>Settings</span></a
					>
				</nav>
				<span class="version">
					<span lang="zh">{APP_NAME_HANZI}</span>
					{APP_NAME}
				</span>
			</footer>
		{/if}
	</div>
{:else}
	<p class="booting">Loading…</p>
{/if}

<style>
	.app {
		/* Nav accent: the app's blue, a darker shade for text on its tint. */
		--nav-accent: #0b6bcb;
		--nav-accent-text: #0957a6;
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

	@media (prefers-color-scheme: dark) {
		.app {
			--nav-accent: #6cb4ff;
			--nav-accent-text: #8cc4ff;
		}
	}

	.content {
		flex: 1 0 auto;
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

	.workspace-error {
		margin: 0;
		padding: 0.5rem 1.5rem;
		color: #c62828;
		font-weight: 600;
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
