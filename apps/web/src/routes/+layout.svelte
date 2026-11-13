<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { APP_NAME, APP_NAME_HANZI } from '$lib/app';
	import WorkspaceCreateForm from '$lib/components/WorkspaceCreateForm.svelte';
	import WorkspacePicker from '$lib/components/WorkspacePicker.svelte';
	import { usesHan } from '$lib/languages';
	import { auth, loadMe, logout, user } from '$lib/auth';
	import { visibleNavPages, webPlugins } from '$lib/plugins';
	import { loadPluginStates, pluginStates, resetPluginStates } from '$lib/plugins/states';
	import { recordSessionOnce } from '$lib/events';
	import { startReviewOutbox } from '$lib/study/events';
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
	<div class="app">
		{#if signedIn}
			<header class="shell">
				<a class="brand" href="/" lang="zh" aria-label={APP_NAME} title={APP_NAME}>{APP_NAME_HANZI}</a>

				<nav aria-label="Main">
					<a href="/" aria-current={path === '/' ? 'page' : undefined}>Home</a>
					<a href="/search" aria-current={path === '/search' ? 'page' : undefined}>Search</a>
					{#if showMap}
						<a href="/study/map" aria-current={path === '/study/map' ? 'page' : undefined}>Map</a>
					{/if}
					{#each pluginLinks as link (`${link.slug}:${link.title}`)}
						<a
							href={link.href}
							aria-current={path === link.href || path.startsWith(`${link.href}/`)
								? 'page'
								: undefined}>{link.title}</a
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
					<button type="button" onclick={logout}>Sign out</button>
				</div>
			</header>

			{#if workspaceError}
				<p class="workspace-error" role="alert">{workspaceError}</p>
			{/if}
		{/if}

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
					<a href="/sources" aria-current={path === '/sources' ? 'page' : undefined}>Sources</a>
					<a href="/settings" aria-current={path === '/settings' ? 'page' : undefined}>Settings</a>
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
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		min-height: 100dvh;
	}

	.content {
		flex: 1 0 auto;
	}

	.shell {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1.5rem;
		padding: 0.75rem 1.5rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
	}

	.brand {
		font-weight: 700;
		text-decoration: none;
	}

	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
	}

	nav a {
		text-decoration: none;
		opacity: 0.8;
	}

	nav a:hover,
	nav a[aria-current='page'] {
		opacity: 1;
		text-decoration: underline;
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
		font: inherit;
		padding: 0.25rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.workspace-error {
		margin: 0;
		padding: 0.5rem 1.5rem;
		color: #c62828;
		font-weight: 600;
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
		gap: 0.25rem 1.25rem;
	}

	.footer a {
		text-decoration: none;
		opacity: 0.85;
	}

	.footer a:hover,
	.footer a[aria-current='page'] {
		opacity: 1;
		text-decoration: underline;
	}

	.version {
		opacity: 0.65;
	}

	.booting {
		margin: 0 auto;
		max-width: 48rem;
		padding: 3rem 1.5rem;
	}
</style>
