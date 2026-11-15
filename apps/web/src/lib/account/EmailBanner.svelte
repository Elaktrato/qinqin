<script lang="ts">
	import { onMount } from 'svelte';
	import { getAuthOptions, type AuthOptions } from '$lib/api/account';
	import { user } from '$lib/auth';
	import { EMAIL_BANNER_TEXT, emailSection } from './emailView';

	// A soft prompt: under the "required" email policy, accounts that have no
	// address yet are asked to add one. Nothing is blocked.
	let { link = true }: { link?: boolean } = $props();
	let policy = $state<AuthOptions['emailPolicy'] | null>(null);

	onMount(() => {
		getAuthOptions().then(
			(o) => (policy = o.emailPolicy),
			() => undefined
		);
	});

	const show = $derived(emailSection(policy, $user?.email ?? null).banner);
</script>

{#if show}
	<p class="banner" role="note">
		{EMAIL_BANNER_TEXT}
		{#if link}<a href="/settings?tab=account">Open account settings</a>{/if}
	</p>
{/if}

<style>
	.banner {
		padding: 0.6rem 0.8rem;
		border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
		border-radius: 0.5rem;
	}
</style>
