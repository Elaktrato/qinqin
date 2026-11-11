<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth, loadMe } from '$lib/auth';
	import '../app.css';

	let { children } = $props();

	let booted = $state(false);

	const publicPaths = new Set(['/login', '/register']);

	const path = $derived(page.url.pathname.replace(/\/+$/, '') || '/');
	const isPublic = $derived(publicPaths.has(path));
	const signedIn = $derived($auth.token !== null);
	// Render a route only when the session matches it: protected pages
	// never flash while a redirect is in flight, and auth pages do not
	// show once signed in.
	const allowed = $derived(booted && (signedIn ? !isPublic : isPublic));

	async function navigate(target: string): Promise<void> {
		try {
			await goto(target);
		} catch {
			// A redirect from the API layer is already in flight.
		}
	}

	onMount(async () => {
		// Rehydrate the session from qinqin.token before guarding.
		try {
			await loadMe();
		} catch {
			// api() has already cleared the token and redirected on 401.
		}
		booted = true;
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
	{@render children()}
{:else}
	<p class="booting">Loading…</p>
{/if}

<style>
	.booting {
		margin: 0 auto;
		max-width: 48rem;
		padding: 3rem 1.5rem;
	}
</style>
