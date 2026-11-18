<script lang="ts">
	import { t } from '$lib/i18n';
	import { IconButton, Sheet, Tabs, type IconName } from '$lib/ui';
	import { tick, type Snippet } from 'svelte';
	import { tabKeyTarget, type RailMode, type RailTab } from './railState';

	export interface RailTabInfo {
		id: RailTab;
		label: string;
		icon: IconName;
		/** Something in the tab needs attention (a load or save error): a dot on its tab. */
		alert?: boolean;
	}

	// The reader's side rail (design §9 "Reader", #102).
	//
	// mode 'column' (wide screens): a column of icon tabs at the right edge of
	// the page (a vertical tablist with tooltips, roving tabindex), the open
	// tab's panel (~220px) between the text and the icons. Activating the open
	// tab collapses the panel; the icon column stays. Sticky at the top of the
	// window and scrolling inside itself, so using it never scrolls the text.
	//
	// mode 'sheet' (below 1000px): nothing in the page. `open` shows the
	// shared bottom Sheet (lib/ui) with the same panels behind text tabs; the
	// caller owns the button that opens it (the frame's phone bar).
	let {
		tabs,
		active,
		onSelect,
		open,
		onToggle,
		mode,
		panel,
		opener = () => null
	}: {
		tabs: RailTabInfo[];
		active: RailTab;
		onSelect: (tab: RailTab) => void;
		open: boolean;
		onToggle: (open: boolean) => void;
		mode: RailMode;
		/** The content of a tab's panel. */
		panel: Snippet<[RailTab]>;
		/** The button that opens the sheet, for focus when the layout switches. */
		opener?: () => HTMLElement | null;
	} = $props();

	let rail = $state<HTMLElement | null>(null);

	const nameOf = (tab: RailTabInfo): string => (tab.alert ? `${tab.label} ${t('reader.rail.attention')}` : tab.label);

	function focusTab(tab: RailTab): void {
		document.getElementById(`rail-tab-${tab}`)?.focus({ preventScroll: true });
	}

	// The open tab again collapses the panel; any tab opens it on itself.
	function activate(tab: RailTab): void {
		if (tab === active && open) {
			onToggle(false);
			return;
		}
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

	// Crossing the 1000 px line swaps the column and the sheet. Focus in the
	// rail would be lost with the element that held it: it goes to the active
	// tab (column) or the sheet's button (sheet) instead. The last focus is
	// tracked because the button (earlier in the page) may already be gone
	// when this runs.
	function isRail(node: EventTarget | null): boolean {
		if (!(node instanceof Node)) return false;
		const button = opener();
		const sheet = document.getElementById('reader-rail-sheet');
		return !!rail?.contains(node) || !!button?.contains(node) || !!sheet?.contains(node);
	}
	let focusInRail = false;
	$effect(() => {
		const onFocus = (e: FocusEvent): void => void (focusInRail = isRail(e.target));
		document.addEventListener('focusin', onFocus);
		return () => document.removeEventListener('focusin', onFocus);
	});
	let lastMode: RailMode | null = null;
	$effect.pre(() => {
		const now = mode;
		const before = lastMode;
		lastMode = now;
		if (before === null || before === now) return;
		const focused = document.activeElement;
		const lost = !focused || focused === document.body;
		if (!isRail(focused) && !(lost && focusInRail)) return;
		void tick().then(() => {
			if (now === 'column') focusTab(active);
			else opener()?.focus({ preventScroll: true });
		});
	});
</script>

{#if mode === 'column'}
	<aside bind:this={rail} id="reader-rail" class="rail" class:open aria-label={t('reader.rail.panel')}>
		{#if open}
			{#each tabs as tab (tab.id)}
				{#if tab.id === active}
					<div id="rail-panel-{tab.id}" role="tabpanel" aria-labelledby="rail-tab-{tab.id}" class="panel">
						{@render panel(tab.id)}
					</div>
				{/if}
			{/each}
		{/if}
		<div class="icons" role="tablist" aria-orientation="vertical" aria-label={t('reader.rail.panel')}>
			{#each tabs as tab, index (tab.id)}
				<span class="tab-cell">
					<IconButton
						id="rail-tab-{tab.id}"
						class="rail-tab"
						role="tab"
						label={nameOf(tab)}
						icon={tab.icon}
						placement="start"
						aria-selected={tab.id === active}
						aria-expanded={tab.id === active ? open : undefined}
						aria-controls={tab.id === active && open ? `rail-panel-${tab.id}` : undefined}
						tabindex={tab.id === active ? 0 : -1}
						onclick={() => activate(tab.id)}
						onkeydown={(e: KeyboardEvent) => tabKey(e, index)}
					/>
					{#if tab.alert}<span class="dot" aria-hidden="true"></span>{/if}
				</span>
			{/each}
		</div>
	</aside>
{:else}
	<Sheet {open} label={t('reader.rail.sheet')} onclose={() => onToggle(false)}>
		<div id="reader-rail-sheet" class="sheet-body">
			<Tabs
				label={t('reader.rail.panel')}
				tabs={tabs.map((tab) => ({ id: tab.id, label: nameOf(tab) }))}
				selected={active}
				onselect={(id) => onSelect(id as RailTab)}
				panel={panel as Snippet<[string]>}
			/>
		</div>
	</Sheet>
{/if}

<style>
	/* The rail column at the page's right edge: the open panel, then the
	   icons. Sticky, scrolling inside itself; no box (design §5): a hairline
	   at the start of each part. */
	.rail {
		position: sticky;
		top: 0;
		align-self: start;
		display: flex;
		max-height: 100vh;
		max-height: 100dvh;
		box-sizing: border-box;
	}

	.panel {
		box-sizing: border-box;
		width: 13.75rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--space-5) var(--space-4);
		border-inline-start: 1px solid var(--hair);
		font-size: var(--font-size-s);
		animation: rail-panel-in var(--motion-medium) var(--ease-standard);
	}

	.icons {
		box-sizing: border-box;
		width: 2.75rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-3) 0;
		border-inline-start: 1px solid var(--hair);
	}

	.tab-cell {
		position: relative;
		display: inline-flex;
	}

	.icons :global(.rail-tab) {
		position: relative;
		color: var(--readable-muted);
	}

	.icons :global(.rail-tab[aria-selected='true']) {
		color: var(--accent);
	}

	/* The active tab's marker: a short accent bar at the outer edge (a
	   shape, so the state is never carried by colour alone). */
	.icons :global(.rail-tab[aria-selected='true'])::after {
		content: '';
		position: absolute;
		inset-inline-end: calc(-1 * var(--space-1) - 2px);
		top: 50%;
		width: 3px;
		height: 1.25rem;
		margin-top: -0.625rem;
		border-radius: 2px;
		background: var(--accent);
	}

	.dot {
		position: absolute;
		top: 0.2rem;
		inset-inline-end: 0.2rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--bad);
		border: 2px solid var(--panel);
		pointer-events: none;
	}

	.sheet-body {
		padding-top: var(--space-1);
	}

	/* Five text tabs on one line at phone width: closer, scrolling sideways if need be. */
	.sheet-body :global([role='tablist']) {
		flex-wrap: nowrap;
		gap: var(--space-4);
		overflow-x: auto;
		scrollbar-width: none;
	}

	@keyframes rail-panel-in {
		from {
			opacity: 0;
		}
	}

	@media (forced-colors: active) {
		.icons :global(.rail-tab) {
			color: ButtonText;
		}
		.icons :global(.rail-tab[aria-selected='true'])::after {
			background: Highlight;
		}
		.dot {
			background: Highlight;
			border-color: Canvas;
		}
	}
</style>
