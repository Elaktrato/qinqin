<script lang="ts">
	// The quick theme switch (design §7): a small menu button listing the
	// themes of the slot painted now, plus a link to Settings → Appearance.
	// Picking one writes that slot of the `appearance` row. Self-contained
	// so the account menu of the frame rework (#99) can host it as is. The
	// menu behaviour (focus, keys, closing) is lib/ui Menu's (#98).
	import { t } from '$lib/i18n';
	import Menu from '$lib/ui/Menu.svelte';
	import MenuItem from '$lib/ui/MenuItem.svelte';
	import { themeStore, type ThemeStore } from './store.svelte';

	let { store = themeStore }: { store?: ThemeStore } = $props();

	let busy = $state(false);
	let error = $state('');

	const current = $derived(store.current);
	const currentName = $derived(store.themeOf(current.theme)?.name ?? current.theme);
	const label = $derived(t('account.menu.theme', { name: currentName }));
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
		error = '';
		try {
			await store.save({ [slot]: { theme: id, accent } });
		} catch {
			error = t('account.menu.themeFailed');
		} finally {
			busy = false;
		}
	}
</script>

<div class="theme-switch">
	<Menu {label} icon="palette" menuLabel={t('account.menu.themes')}>
		{#each choices as theme (theme.id)}
			<MenuItem checked={theme.id === current.theme} onselect={() => pick(theme.id)}
				><span class="swatch" aria-hidden="true" style:background={theme.colors.panel}
					><i style:background={theme.accents[theme.defaultAccent]}></i></span
				>{theme.name}</MenuItem
			>
		{/each}
		{#if choices.length > 0}<MenuItem separator />{/if}
		<MenuItem href="/settings?tab=appearance">{t('account.menu.themeSettings')}</MenuItem>
	</Menu>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.theme-switch {
		position: relative;
		display: inline-flex;
	}
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
	.error {
		position: absolute;
		top: calc(100% + var(--space-1));
		right: 0;
		margin: 0;
		padding: var(--space-1) var(--space-2);
		white-space: nowrap;
		background: var(--panel);
		border-inline-start: 3px solid var(--bad);
		color: var(--readable-bad);
		font-weight: 600;
		border-radius: var(--radius);
		box-shadow: var(--shadow-float);
	}
</style>
