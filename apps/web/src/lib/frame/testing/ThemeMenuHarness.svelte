<script lang="ts">
	// Test harness: the theme items in a Menu of their own, named like the
	// account menu's Theme row, with the error line the account menu shows.
	import { t } from '$lib/i18n';
	import Menu from '$lib/ui/Menu.svelte';
	import type { ThemeStore } from '$lib/theme/store.svelte';
	import ThemeMenuItems from '../ThemeMenuItems.svelte';

	let { store, onback }: { store: ThemeStore; onback?: () => void } = $props();
	let error = $state('');
	const name = $derived(store.themeOf(store.current.theme)?.name ?? store.current.theme);
</script>

<Menu label={t('account.menu.theme', { name })} icon="palette" menuLabel={t('account.menu.themes')}>
	<ThemeMenuItems {store} {onback} onerror={(m) => (error = m)} />
</Menu>
{#if error}<p role="alert">{error}</p>{/if}
