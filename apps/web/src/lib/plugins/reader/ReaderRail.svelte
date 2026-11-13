<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { inPopup } from './popupPointer.svelte';
	import { tabKeyTarget, type RailMode, type RailTab } from './railState';

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
		panel
	}: {
		tabs: RailTabInfo[];
		active: RailTab;
		onSelect: (tab: RailTab) => void;
		open: boolean;
		onToggle: (open: boolean) => void;
		mode: RailMode;
		/** The content of a tab's panel. */
		panel: Snippet<[RailTab]>;
	} = $props();

	let rail = $state<HTMLElement | null>(null);
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

	// Escape closes the drawer (inner handlers, such as a rename field or
	// a delete confirmation, take their Escape first).
	function railKey(event: KeyboardEvent): void {
		if (mode !== 'drawer' || !open) return;
		if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
		event.preventDefault();
		closeDrawer(true);
	}

	// A click or tap outside the open drawer closes it. Focus then goes
	// where the click put it.
	$effect(() => {
		if (mode !== 'drawer' || !open) return;
		const onDown = (event: PointerEvent): void => {
			const target = event.target as Node | null;
			if (!target || rail?.contains(target) || opener?.contains(target) || inPopup(target)) return;
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
		aria-label={anyAlert ? 'Bookmarks and highlights (needs attention)' : 'Bookmarks and highlights'}
		title="Bookmarks and highlights"
		onclick={() => (open ? closeDrawer(false) : openDrawer())}
	>
		<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
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
	aria-label="Bookmarks and highlights"
	onkeydown={railKey}
>
	<div class="strip">
		{#if mode === 'column'}
			<button
				type="button"
				class="collapse"
				aria-expanded={open}
				aria-controls="rail-panels"
				aria-label={open ? 'Collapse the side panel' : 'Expand the side panel'}
				title={open ? 'Collapse the side panel' : 'Expand the side panel'}
				onclick={() => onToggle(!open)}
			>
				<span aria-hidden="true">{open ? '»' : '«'}</span>
			</button>
		{:else}
			<button
				type="button"
				class="collapse"
				aria-label="Close the side panel"
				title="Close (Esc)"
				onclick={() => closeDrawer(true)}
			>
				<span aria-hidden="true">×</span>
			</button>
		{/if}
		<div role="tablist" aria-orientation="vertical" aria-label="Side panel">
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
							>(needs attention)</span
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
		background: Canvas;
		color: CanvasText;
		border-inline-start: 1px solid color-mix(in srgb, currentColor 20%, transparent);
		box-shadow: -0.25rem 0 1rem rgb(0 0 0 / 0.18);
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
		border-color: #0b6bcb;
		box-shadow: inset -3px 0 0 #0b6bcb;
		font-weight: 600;
	}

	.dot {
		position: absolute;
		top: -0.25rem;
		right: -0.25rem;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: #b3261e;
		border: 2px solid Canvas;
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
		bottom: calc(1.25rem + var(--bottom-bar-height, 0px));
		z-index: 25;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		background: Canvas;
		color: CanvasText;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-inline-end: none;
		border-radius: 0.5rem 0 0 0.5rem;
		box-shadow: -0.125rem 0.125rem 0.5rem rgb(0 0 0 / 0.15);
		cursor: pointer;
	}

	.opener .dot {
		top: 0.3rem;
		right: 0.3rem;
	}

	@media (prefers-color-scheme: dark) {
		.tab[aria-selected='true'] {
			border-color: #6cb4ff;
			box-shadow: inset -3px 0 0 #6cb4ff;
		}

		.dot {
			background: #ff8a80;
		}
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
