<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getAuthOptions, type AuthOptions } from '$lib/api/account';
	import { logout } from '$lib/auth';
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
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
	<title>{pageTitle(t('account.mfa.setUp'))}</title>
</svelte:head>

<main class="auth">
	<h1>{t('auth.forced.mfaTitle')}</h1>
	<p>{t('auth.forced.mfaIntro')}</p>
	<TwoFactorSetup {options} forced onfinished={finished} />
	<p class="hint"><button type="button" class="link" onclick={() => logout()}>{t('auth.forced.signOutInstead')}</button></p>
</main>
