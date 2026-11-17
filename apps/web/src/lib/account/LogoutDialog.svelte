<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import { signOutAndDelete, staySignedIn } from './signOut';
	import { logoutPrompt, unsentText } from './logoutFlow';

	// Shown by the root layout while $logoutPrompt holds a count: sign-out
	// found reviews that could not be sent. Stay signed in is the default.
	const uid = $props.id();
	let dialog = $state<HTMLDialogElement | null>(null);
	let stay = $state<HTMLButtonElement | null>(null);

	onMount(() => {
		if (typeof dialog?.showModal === 'function') dialog.showModal();
		else dialog?.setAttribute('open', '');
		stay?.focus();
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	aria-describedby="{uid}-text"
	oncancel={(event) => {
		event.preventDefault();
		staySignedIn();
	}}
>
	<h2 id="{uid}-title">{t('account.logout.title')}</h2>
	<p id="{uid}-text">{unsentText($logoutPrompt ?? 0)}</p>
	<div class="buttons">
		<button bind:this={stay} type="button" onclick={staySignedIn}>{t('account.logout.stay')}</button>
		<button type="button" class="danger" onclick={signOutAndDelete}>{t('account.logout.delete')}</button>
	</div>
</dialog>

<style>
	dialog {
		max-width: min(30rem, calc(100vw - 2rem));
		padding: 1.2rem;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		justify-content: flex-end;
	}
</style>
