<script lang="ts">
	import { t } from '$lib/i18n';
	import { tick, type Snippet } from 'svelte';
	import { inPopup } from './popupPointer.svelte';
	import { nextFocusIndex, tabKeyTarget, type RailMode, type RailTab } from './railState';

	export interface RailTabInfo {
		id: RailTab;
		label: string;
		/** Something in the tab needs attention (a load or save error): a dot on its tab. */
		alert?: boolean;
	}

	// The reader's side rail: a vertical tab strip (Bookmarks, Highlights)
	// with one panel per tab. On wide screens (mode 'column') it is a
	// column beside the text, sticky at the top of the screen, and `open`
	// says whether it is expanded or collapsed to the strip. Below that
	// (mode 'drawer') it is a drawer at the right edge, opened from a
	// floating button; `open` says whether the drawer is shown. It never
	// moves the page: using it does not scroll the text.
	let {
		tabs,
		active,
		onSelect,
		open,
		onToggle,
		mode,
		panel,
		escapeBlocked = () => false
	}: {
		tabs: RailTabInfo[];
		active: RailTab;
		onSelect: (tab: RailTab) => void;
		open: boolean;
		onToggle: (open: boolean) => void;
		mode: RailMode;
		/** The content of a tab's panel. */
		panel: Snippet<[RailTab]>;
		/** Something above the drawer takes Escape first (an open lookup popup). */
		escapeBlocked?: () => boolean;
	} = $props();

	let rail = $state<HTMLElement | null>(null);

	// Something opened from the rail that floats above it (the highlight
	// editor, marked data-rail-overlay): using it keeps the drawer open.
	function inOverlay(node: Node | EventTarget): boolean {
		return node instanceof Element && node.closest('[data-rail-overlay]') !== null;
	}
	let opener = $state<HTMLButtonElement | null>(null);

	const anyAlert = $derived(tabs.some((t) => t.alert));

	function focusTab(tab: RailTab): void {
		document.getElementById(`rail-tab-${tab}`)?.focus({ preventScroll: true });
	}

	function select(tab: RailTab): void {
		onSelect(tab);
		if (!open) onToggle(true);
	}

	function tabKey(event: KeyboardEvent, index: number): void {
		const next = tabKeyTarget(event.key, index, tabs.length);
		if (next === null) return;
		event.preventDefault();
		onSelect(tabs[next].id);
		focusTab(tabs[next].id);
	}

	async function openDrawer(): Promise<void> {
		onToggle(true);
		await tick();
		focusTab(active);
	}

	function closeDrawer(returnFocus: boolean): void {
		onToggle(false);
		if (returnFocus) opener?.focus({ preventScroll: true });
	}

	// The elements Tab can reach in the drawer right now (the inactive tab
	// has tabindex -1; hidden panels have no boxes).
	function focusables(): HTMLElement[] {
		if (!rail) return [];
		const all = rail.querySelectorAll<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]'
		);
		return [...all].filter(
			(el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0
		);
	}

	// Keys in the open drawer:
	// - Tab and Shift+Tab wrap inside it. The drawer covers the text, so
	//   focus leaving it would land on links hidden underneath and scroll
	//   the page (overwriting the reading position). It stays a plain
	//   region, not a dialog, so the `b` key keeps working in it.
	// - Escape closes it. Inner handlers (a rename field, a delete
	//   confirmation) take their Escape first, and so does an open lookup
	//   popup, which is drawn on top.
	function railKey(event: KeyboardEvent): void {
		if (mode !== 'drawer' || !open) return;
		if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
			const list = focusables();
			const current = list.indexOf(document.activeElement as HTMLElement);
			const next = nextFocusIndex(list.length, current, event.shiftKey);
			if (next === null) return;
			event.preventDefault();
			list[next].focus();
			return;
		}
		if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
		if (escapeBlocked()) return;
		event.preventDefault();
		closeDrawer(true);
	}

	// Safety net for the Tab wrap: focus moving to the page outside (a
	// click target, a screen reader's virtual cursor) closes the drawer.
	function railFocusOut(event: FocusEvent): void {
		if (mode !== 'drawer' || !open) return;
		const next = event.relatedTarget as Node | null;
		if (!next || rail?.contains(next) || opener?.contains(next) || inPopup(next) || inOverlay(next)) return;
		onToggle(false);
	}

	// Crossing the 1000 px line swaps the column and the drawer. Focus in
	// the rail would be lost with the element that held it: it goes to
	// the active tab (column) or the drawer button (drawer) instead.
	let lastMode: RailMode | null = null;
	$effect.pre(() => {
		const now = mode;
		const before = lastMode;
		lastMode = now;
		if (before === null || before === now) return;
		const focused = document.activeElement;
		const inside = !!focused && (!!rail?.contains(focused) || !!opener?.contains(focused));
		if (!inside) return;
		void tick().then(() => {
			if (now === 'column') focusTab(active);
			else opener?.focus({ preventScroll: true });
		});
	});

	// A click or tap outside the open drawer closes it. Focus then goes
	// where the click put it.
	$effect(() => {
		if (mode !== 'drawer' || !open) return;
		const onDown = (event: PointerEvent): void => {
			const target = event.target as Node | null;
			if (!target || rail?.contains(target) || opener?.contains(target) || inPopup(target) || inOverlay(target))
				return;
			onToggle(false);
		};
		document.addEventListener('pointerdown', onDown, true);
		return () => document.removeEventListener('pointerdown', onDown, true);
	});
</script>

{#if mode === 'drawer'}
	<button
		bind:this={opener}
		type="button"
		class="opener"
		aria-expanded={open}
		aria-controls="reader-rail"
		aria-label={anyAlert ? t('reader.rail.bookmarksAttention') : t('reader.rail.bookmarks')}
		title={t('reader.rail.bookmarks')}
		onclick={() => (open ? closeDrawer(false) : openDrawer())}
	>
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
			<path
				d="M4 1.75h8a.75.75 0 0 1 .75.75v12l-4.75-3.2-4.75 3.2v-12A.75.75 0 0 1 4 1.75z"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linejoin="round"
			/>
		</svg>
		{#if anyAlert}<span class="dot" aria-hidden="true"></span>{/if}
	</button>
{/if}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
	bind:this={rail}
	id="reader-rail"
	class="rail {mode}"
	class:open
	hidden={mode === 'drawer' && !open}
	aria-label={t('reader.rail.bookmarks')}
	onkeydown={railKey}
	onfocusout={railFocusOut}
>
	<div class="strip">
		{#if mode === 'column'}
			<button
				type="button"
				class="collapse"
				aria-expanded={open}
				aria-controls="rail-panels"
				aria-label={open ? t('reader.rail.collapse') : t('reader.rail.expand')}
				title={open ? t('reader.rail.collapse') : t('reader.rail.expand')}
				onclick={() => onToggle(!open)}
			>
				<span aria-hidden="true">{open ? '»' : '«'}</span>
			</button>
		{:else}
			<button
				type="button"
				class="collapse"
				aria-label={t('reader.rail.close')}
				title={t('reader.rail.closeTitle')}
				onclick={() => closeDrawer(true)}
			>
				<span aria-hidden="true">×</span>
			</button>
		{/if}
		<div role="tablist" aria-orientation="vertical" aria-label={t('reader.rail.panel')}>
			{#each tabs as tab, index (tab.id)}
				<button
					id="rail-tab-{tab.id}"
					type="button"
					role="tab"
					class="tab"
					aria-selected={tab.id === active}
					aria-controls="rail-panel-{tab.id}"
					tabindex={tab.id === active ? 0 : -1}
					onclick={() => select(tab.id)}
					onkeydown={(e) => tabKey(e, index)}
				>
					<span class="tab-label">{tab.label}</span>
					{#if tab.alert}<span class="dot" aria-hidden="true"></span><span class="visually-hidden"
							>{t('reader.rail.attention')}</span
						>{/if}
				</button>
			{/each}
		</div>
	</div>

	<div id="rail-panels" class="panels" hidden={!open}>
		{#each tabs as tab (tab.id)}
			<div
				id="rail-panel-{tab.id}"
				role="tabpanel"
				aria-labelledby="rail-tab-{tab.id}"
				class="panel"
				hidden={tab.id !== active}
			>
				{@render panel(tab.id)}
			</div>
		{/each}
	</div>
</aside>

<style>
	.rail {
		display: flex;
		align-items: stretch;
		box-sizing: border-box;
	}

	.rail[hidden] {
		display: none;
	}

	/* Wide screens: a column beside the text that stays at hand while
	   reading. It scrolls inside itself, never the page. */
	.rail.column {
		/* The text column gives way on narrower screens, not the rail. */
		flex: none;
		position: sticky;
		top: 1rem;
		align-self: flex-start;
		max-height: calc(100vh - 2rem);
		border-inline-start: 1px solid color-mix(in srgb, currentColor 14%, transparent);
	}

	.rail.column.open {
		width: 18rem;
	}

	/* Phones and narrow windows: a drawer over the right edge. Below the
	   lookup popups (z-index 50+), above the workspace listbox (20). */
	.rail.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 30;
		width: min(22rem, calc(100vw - 2.5rem));
		background: var(--panel);
		color: var(--text);
		border-inline-start: 1px solid color-mix(in srgb, currentColor 20%, transparent);
		box-shadow: var(--shadow-float);
	}

	.strip {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		align-items: center;
		flex: 0 0 auto;
		width: 2.5rem;
		padding: 0.25rem 0;
	}

	.collapse {
		font: inherit;
		width: 2rem;
		height: 2rem;
		padding: 0;
		line-height: 1;
	}

	[role='tablist'] {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.tab {
		position: relative;
		width: 2rem;
		padding: 0.6rem 0;
		font: inherit;
		font-size: 0.85rem;
		background: none;
		color: inherit;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.35rem;
		cursor: pointer;
	}

	.tab-label {
		writing-mode: vertical-rl;
	}

	.tab[aria-selected='true'] {
		border-color: var(--accent);
		box-shadow: inset -3px 0 0 var(--accent);
		font-weight: 600;
	}

	.dot {
		position: absolute;
		top: -0.25rem;
		right: -0.25rem;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: var(--bad);
		border: 2px solid var(--panel);
	}

	.panels {
		flex: 1 1 auto;
		min-width: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.25rem 0.5rem 0.75rem 0.75rem;
	}

	.panels[hidden],
	.panel[hidden] {
		display: none;
	}

	.opener {
		position: fixed;
		right: 0;
		bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px));
		z-index: 25;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		/* Exactly the page's side margin (main's 1.5rem padding), so it
		   never covers the text column; 24 × 44 px is still a fair target. */
		box-sizing: border-box;
		width: 1.5rem;
		height: 2.75rem;
		padding: 0;
		background: var(--panel);
		color: var(--text);
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-inline-end: none;
		border-radius: 0.4rem 0 0 0.4rem;
		cursor: pointer;
	}

	.opener svg {
		flex: none;
	}

	.opener .dot {
		top: 0.15rem;
		right: 0.1rem;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
