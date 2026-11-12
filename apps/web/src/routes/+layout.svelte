<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { APP_NAME } from '$lib/app';
	import { auth, loadMe, logout, user } from '$lib/auth';
	import { navPages, webPlugins } from '$lib/plugins';
	import { loadPluginStates, pluginStates, resetPluginStates } from '$lib/plugins/states';
	import { recordSessionOnce } from '$lib/events';
	import { startReviewOutbox } from '$lib/study/events';
	import {
		create as createWorkspace,
		load as loadWorkspaces,
		select as selectWorkspace,
		workspaces
	} from '$lib/workspaces';
	import '../app.css';

	let { children } = $props();

	let booted = $state(false);
	// The token whose workspaces are loaded; guards the effect below
	// against refetching on unrelated re-runs.
	let loadedToken = $state<string | null>(null);
	let workspaceError = $state('');
	let newLanguage = $state('');
	let creating = $state(false);

	const publicPaths = new Set(['/login', '/register']);

	const path = $derived(page.url.pathname.replace(/\/+$/, '') || '/');
	const pluginLinks = $derived(navPages(webPlugins, $pluginStates.list));
	const isPublic = $derived(publicPaths.has(path));
	const signedIn = $derived($auth.token !== null);
	// Render a route only when the session matches it: protected pages
	// never flash while a redirect is in flight, and auth pages do not
	// show once signed in.
	const allowed = $derived(booted && (signedIn ? !isPublic : isPublic));

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
			resetPluginStates();
			workspaces.set({ list: [], current: null });
			return;
		}
		if (token === loadedToken) return;
		loadedToken = token;
		workspaceError = '';
		void loadPluginStates();
		void loadWorkspaces()
			.then(() => {
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

	function switchWorkspace(event: Event): void {
		const id = Number((event.currentTarget as HTMLSelectElement).value);
		if (Number.isInteger(id)) {
			selectWorkspace(id);
		}
	}

	async function addWorkspace(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const language = newLanguage.trim().toLowerCase();
		if (!language || creating) return;

		creating = true;
		workspaceError = '';
		try {
			await createWorkspace(language);
			newLanguage = '';
		} catch (err) {
			workspaceError = message(err, 'Could not create workspace.');
		} finally {
			creating = false;
		}
	}
</script>

{#if allowed}
	{#if signedIn}
		<header class="shell">
			<a class="brand" href="/">{APP_NAME}</a>

			<nav aria-label="Main">
				<a href="/" aria-current={path === '/' ? 'page' : undefined}>Home</a>
				<a href="/search" aria-current={path === '/search' ? 'page' : undefined}>Search</a>
				<a href="/study/map" aria-current={path === '/study/map' ? 'page' : undefined}>Map</a>
				<a href="/settings" aria-current={path === '/settings' ? 'page' : undefined}>Settings</a>
				<a href="/sources" aria-current={path === '/sources' ? 'page' : undefined}>Sources</a>
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
				<label>
					Workspace
					<select
						value={$workspaces.current?.id ?? ''}
						onchange={switchWorkspace}
						disabled={$workspaces.list.length === 0}
					>
						{#if !$workspaces.current}
							<option value="">None</option>
						{/if}
						{#each $workspaces.list as workspace (workspace.id)}
							<option value={workspace.id}>{workspace.language}</option>
						{/each}
					</select>
				</label>

				<form class="new-workspace" onsubmit={addWorkspace}>
					<input
						bind:value={newLanguage}
						aria-label="New workspace language"
						placeholder="zh"
						size="4"
						maxlength="16"
						required
					/>
					<button type="submit" disabled={creating}>New</button>
				</form>
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

	{@render children()}
{:else}
	<p class="booting">Loading…</p>
{/if}

<style>
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
		gap: 1rem;
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

	.workspace label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.9rem;
	}

	.workspace select,
	.workspace input,
	.workspace button {
		font: inherit;
		padding: 0.25rem 0.4rem;
	}

	.new-workspace {
		display: flex;
		gap: 0.35rem;
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

	.booting {
		margin: 0 auto;
		max-width: 48rem;
		padding: 3rem 1.5rem;
	}
</style>
