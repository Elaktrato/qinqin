<script lang="ts">
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import { signOutAndDelete, staySignedIn } from './signOut';
	import { logoutPrompt, unsentText } from './logoutFlow';
	import { useApp } from '$lib/context/context';

	const app = useApp();

	// Shown by the root layout while $logoutPrompt holds a count: sign-out
	// found reviews that could not be sent. Stay signed in is the default
	// (focused first); Escape stays too.
</script>

<Dialog
	open
	title={t('account.logout.title')}
	description={unsentText($logoutPrompt ?? 0)}
	onclose={staySignedIn}
>
	{#snippet actions()}
		<Button onclick={staySignedIn}>{t('account.logout.stay')}</Button>
		<Button variant="primary" tone="danger" onclick={() => signOutAndDelete(app)}>{t('account.logout.delete')}</Button>
	{/snippet}
</Dialog>
