<script lang="ts">
	// The quick theme switch (design §7, §10), as items of an enclosing Menu
	// (the account menu's theme level): Back (when the caller has a level to
	// return to), the themes of the slot painted now as radio items, and
	// Appearance settings…. Picking one writes that slot of the `appearance`
	// row, keeping an offered accent; a failed save is reported through
	// onerror (the caller shows it outside the closed popup). Moved from the
	// retired ThemeSwitch (#98).
	import { t } from '$lib/i18n';
	import MenuItem from '$lib/ui/MenuItem.svelte';
	import { themeStore, type ThemeStore } from '$lib/theme/store.svelte';

	let {
		store = themeStore,
		onback,
		onerror
	}: { store?: ThemeStore; onback?: () => void; onerror?: (message: string) => void } = $props();

	let busy = false;

	const current = $derived(store.current);
	// The themes of the painted slot's scheme (the painted one kept even if it is of the other).
	const choices = $derived(
		store.rowLoaded ? store.themes.filter((th) => th.scheme === current.slot || th.id === current.theme) : []
	);

	async function pick(id: string): Promise<void> {
		if (busy) return;
		const slot = current.slot;
		const keep = store.appearance[slot].accent;
		const accent = keep !== null && store.accentChoicesOf(id).includes(keep) ? keep : null;
		busy = true;
		onerror?.('');
		try {
			await store.save({ [slot]: { theme: id, accent } });
		} catch {
			onerror?.(t('account.menu.themeFailed'));
		} finally {
			busy = false;
		}
	}
</script>

{#if onback}
	<MenuItem keepOpen icon="back" onselect={onback}>{t('common.action.back')}</MenuItem>
	<MenuItem separator />
{/if}
{#each choices as theme (theme.id)}
	<MenuItem checked={theme.id === current.theme} onselect={() => pick(theme.id)}
		><span class="swatch" aria-hidden="true" style:background={theme.colors.panel}
			><i style:background={theme.accents[theme.defaultAccent]}></i></span
		>{theme.name}</MenuItem
	>
{/each}
{#if choices.length > 0}<MenuItem separator />{/if}
<MenuItem href="/settings?tab=appearance">{t('account.menu.themeSettings')}</MenuItem>

<style>
	.swatch {
		display: inline-grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		margin-inline-end: var(--space-2);
		vertical-align: middle;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px var(--hair);
		forced-color-adjust: none;
	}
	.swatch i {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
	}
</style>
