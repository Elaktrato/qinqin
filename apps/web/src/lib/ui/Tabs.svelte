<script lang="ts">
	// Text tabs (design §5, §9 Stats): a 2px accent underline marks the
	// selected one. Two forms:
	//   in-page tabs (no href): the APG tabs pattern — role tablist/tab/tabpanel,
	//     automatic activation, roving tabindex, Left/Right (wrapping, mirrored
	//     in right-to-left text), Home/End;
	//   route tabs (every tab has href): a <nav> of links, the current one
	//     aria-current="page" — links that navigate are not ARIA tabs.
	//
	// API: <Tabs label tabs bind:selected? onselect? panel? />
	//   label     the tablist's / nav's accessible name (t(…))
	//   tabs      { id, label, href? }[]
	//   selected  bindable id of the selected tab
	//   onselect  called with the id when the person selects a tab
	//   panel     Snippet<[id]> rendered in the tabpanel (in-page form only)
	import { tick, type Snippet } from 'svelte';

	type Tab = { id: string; label: string; href?: string };
	let {
		label,
		tabs,
		selected = $bindable(tabs[0]?.id ?? ''),
		onselect,
		panel
	}: {
		label: string;
		tabs: Tab[];
		selected?: string;
		onselect?: (id: string) => void;
		panel?: Snippet<[string]>;
	} = $props();

	const uid = $props.id();
	const routes = $derived(tabs.length > 0 && tabs.every((tab) => tab.href));
	const tabId = (id: string) => `${uid}-tab-${id}`;
	const panelId = `${uid}-panel`;
	let list = $state<HTMLElement>();

	async function choose(id: string, focus: boolean): Promise<void> {
		if (id !== selected) {
			selected = id;
			onselect?.(id);
		}
		if (!focus) return;
		await tick();
		document.getElementById(tabId(id))?.focus();
	}

	function onkeydown(e: KeyboardEvent): void {
		const at = tabs.findIndex((tab) => tab.id === selected);
		const rtl = list ? getComputedStyle(list).direction === 'rtl' : false;
		const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
		let next = -1;
		if (step !== undefined) next = (at + step + tabs.length) % tabs.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = tabs.length - 1;
		if (next < 0) return;
		e.preventDefault();
		void choose(tabs[next].id, true);
	}
</script>

{#if routes}
	<nav class="tabs" aria-label={label}>
		{#each tabs as tab (tab.id)}
			<a class="tab" href={tab.href} aria-current={tab.id === selected ? 'page' : undefined}>{tab.label}</a>
		{/each}
	</nav>
{:else}
	<div class="tabs" role="tablist" aria-label={label} bind:this={list}>
		{#each tabs as tab (tab.id)}
			{@const on = tab.id === selected}
			<button
				type="button"
				class="tab"
				role="tab"
				id={tabId(tab.id)}
				aria-selected={on ? 'true' : 'false'}
				aria-controls={on && panel ? panelId : undefined}
				tabindex={on ? 0 : -1}
				onclick={() => choose(tab.id, false)}
				{onkeydown}>{tab.label}</button
			>
		{/each}
	</div>
	{#if panel}
		<div class="panel" role="tabpanel" id={panelId} aria-labelledby={tabId(selected)} tabindex="0">
			{@render panel(selected)}
		</div>
	{/if}
{/if}

<style>
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5);
		border-bottom: 1px solid var(--hair);
	}
	.tab {
		position: relative;
		padding: var(--space-2) 0;
		border: 0;
		background: none;
		color: var(--readable-muted);
		font: inherit;
		font-weight: var(--weight-medium);
		text-decoration: none;
		cursor: pointer;
		transition: color var(--motion-fast) var(--ease-standard);
	}
	.tab:hover {
		color: var(--text);
	}
	.tab[aria-selected='true'],
	.tab[aria-current='page'] {
		color: var(--text);
		font-weight: var(--weight-strong);
	}
	/* The selected tab's underline sits on the row's hairline. */
	.tab[aria-selected='true']::after,
	.tab[aria-current='page']::after {
		content: '';
		position: absolute;
		inset-inline: 0;
		bottom: -1px;
		height: 2px;
		border-radius: 1px;
		background: var(--accent);
	}
	.tab:focus-visible,
	.panel:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.panel {
		padding-top: var(--space-4);
	}
	@media (forced-colors: active) {
		.tab[aria-selected='true']::after,
		.tab[aria-current='page']::after {
			background: Highlight;
		}
		.tab:focus-visible,
		.panel:focus-visible {
			outline-color: Highlight;
		}
	}
</style>
