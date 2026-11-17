<script lang="ts">
	import { onMount } from 'svelte';
	import { getAuthOptions, type AuthOptions } from '$lib/api/account';
	import { user } from '$lib/auth';
	import { t } from '$lib/i18n';
	import { emailBannerText, emailSection } from './emailView';

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
		{emailBannerText()}
		{#if link}<a href="/settings?tab=account">{t('account.email.openSettings')}</a>{/if}
	</p>
{/if}

<style>
	/* A notice line (R8): text and the link, a hairline rule below, no box. */
	.banner {
		margin: var(--space-3) 0;
		padding: 0 0 var(--space-2);
		border-bottom: 1px solid var(--hair);
	}
</style>
