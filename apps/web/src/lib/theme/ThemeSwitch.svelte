<script lang="ts">
	// The quick theme switch (design §7): a small menu button listing the
	// themes of the slot painted now, plus a link to Settings → Appearance.
	// Picking one writes that slot of the `appearance` row. Self-contained
	// so the account menu of the frame rework (#99) can host it as is.
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import NavIcon from '$lib/components/NavIcon.svelte';
	import { themeStore, type ThemeStore } from './store.svelte';

	let { store = themeStore }: { store?: ThemeStore } = $props();

	let open = $state(false);
	let busy = $state(false);
	let error = $state('');
	let button = $state<HTMLButtonElement>();
	let menu = $state<HTMLDivElement>();
	let wrapper = $state<HTMLDivElement>();

	const current = $derived(store.current);
	const currentName = $derived(store.themeOf(current.theme)?.name ?? current.theme);
	const label = $derived(t('account.menu.theme', { name: currentName }));
	// The themes of the painted slot's scheme (the painted one kept even if it is of the other).
	const choices = $derived(
		store.rowLoaded ? store.themes.filter((th) => th.scheme === current.slot || th.id === current.theme) : []
	);

	function items(): HTMLElement[] {
		return menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')] : [];
	}

	async function toggle(): Promise<void> {
		open = !open;
		error = '';
		if (!open) return;
		await tick();
		const list = items();
		(list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
	}

	function close(returnFocus: boolean): void {
		open = false;
		if (returnFocus) button?.focus();
	}

	function menuKey(e: KeyboardEvent): void {
		const list = items();
		const at = list.indexOf(document.activeElement as HTMLElement);
		let next = -1;
		if (e.key === 'ArrowDown') next = (at + 1) % list.length;
		else if (e.key === 'ArrowUp') next = (at - 1 + list.length) % list.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = list.length - 1;
		else if (e.key === 'Escape') {
			e.preventDefault();
			close(true);
			return;
		} else if (e.key === 'Tab') close(false);
		if (next >= 0) {
			e.preventDefault();
			list[next]?.focus();
		}
	}

	function outside(e: PointerEvent): void {
		if (open && wrapper && !wrapper.contains(e.target as Node)) close(false);
	}

	async function pick(id: string): Promise<void> {
		if (busy) return;
		const slot = current.slot;
		const keep = store.appearance[slot].accent;
		const accent = keep !== null && store.accentChoicesOf(id).includes(keep) ? keep : null;
		busy = true;
		error = '';
		close(true);
		try {
			await store.save({ [slot]: { theme: id, accent } });
		} catch {
			error = t('account.menu.themeFailed');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:document onpointerdown={outside} />

<div class="theme-switch" bind:this={wrapper}>
	<button
		type="button"
		class="theme-button"
		bind:this={button}
		aria-label={label}
		title={label}
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={toggle}><NavIcon name="palette" size={18} /></button
	>
	{#if open}
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div class="menu" role="menu" aria-label={t('account.menu.themes')} bind:this={menu} onkeydown={menuKey}>
			{#each choices as theme (theme.id)}
				<button
					type="button"
					role="menuitemradio"
					aria-checked={theme.id === current.theme}
					tabindex="-1"
					onclick={() => pick(theme.id)}
					><span class="swatch" aria-hidden="true" style:background={theme.colors.panel}
						><i style:background={theme.accents[theme.defaultAccent]}></i></span
					>{theme.name}</button
				>
			{/each}
			{#if choices.length > 0}<hr />{/if}
			<a role="menuitem" tabindex="-1" href="/settings?tab=appearance" onclick={() => close(false)}
				>{t('account.menu.themeSettings')}</a
			>
		</div>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.theme-switch {
		position: relative;
		display: inline-flex;
	}
	.theme-button {
		display: inline-grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.theme-button:hover {
		background: var(--raised);
	}
	.theme-button:focus-visible,
	.menu :focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.menu {
		position: absolute;
		top: calc(100% + var(--space-1));
		right: 0;
		z-index: 50;
		min-width: 12rem;
		max-height: 70vh;
		overflow-y: auto;
		display: grid;
		padding: var(--space-1);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-float);
	}
	.menu button,
	.menu a {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 0;
		border-radius: calc(var(--radius) - 2px);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: start;
		text-decoration: none;
		cursor: pointer;
	}
	.menu button:hover,
	.menu a:hover {
		background: var(--raised);
	}
	.menu [aria-checked='true'] {
		background: var(--selected-wash);
		font-weight: 600;
	}
	/* The checked theme keeps a non-colour cue (weight, and a mark in forced colours). */
	@media (forced-colors: active) {
		.menu [aria-checked='true'] {
			outline: 2px solid Highlight;
		}
	}
	.menu hr {
		width: 100%;
		border: 0;
		border-top: 1px solid var(--hair);
		margin: var(--space-1) 0;
	}
	.swatch {
		display: inline-grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px var(--hair);
		forced-color-adjust: none;
		flex: none;
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
