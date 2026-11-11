<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth, loadMe } from '$lib/auth';
	import '../app.css';

	let { children } = $props();

	let ready = $state(false);

	const publicPaths = new Set(['/login', '/register']);

	onMount(async () => {
		// Rehydrate the session from qinqin.token before guarding.
		try {
			await loadMe();
		} catch {
			// api() has already cleared the token and redirected on 401.
		}

		const path = page.url.pathname;
		const signedIn = get(auth).token !== null;

		try {
			if (!signedIn && !publicPaths.has(path)) {
				await goto('/login');
			} else if (signedIn && publicPaths.has(path)) {
				await goto('/');
			}
		} catch {
			// A redirect from the API layer is already in flight.
		}

		ready = true;
	});
</script>

{#if ready}
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
