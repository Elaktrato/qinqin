<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getAuthOptions, type AuthOptions } from '$lib/api/account';
	import { logout } from '$lib/auth';
	import { pageTitle } from '$lib/pageTitle';
	import TwoFactorSetup from '$lib/account/TwoFactorSetup.svelte';

	// Where a session that must enrol a second factor lands (the layout guard
	// sends it here). Finishing makes the session a full one.
	let options = $state<AuthOptions | null>(null);

	onMount(() => {
		getAuthOptions().then(
			(o) => (options = o),
			() => undefined
		);
	});

	async function finished() {
		await goto('/', { replaceState: true });
	}
</script>

<svelte:head>
	<title>{pageTitle('Set up two-step sign-in')}</title>
</svelte:head>

<main class="auth">
	<h1>Two-step sign-in is required</h1>
	<p>The administrator of this server asks everyone to sign in in two steps. Set it up to continue.</p>
	<TwoFactorSetup {options} forced onfinished={finished} />
	<p class="hint"><button type="button" class="link" onclick={() => logout()}>Sign out instead</button></p>
</main>
