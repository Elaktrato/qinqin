<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { page } from '$app/state';
	import { activeStatsTab, statsTabs, tabKeyTarget } from '$lib/statsTabs';
	import { currentLanguage } from '$lib/workspaces';

	let { children } = $props();

	// Each view has its own URL (/stats, /stats/characters), so Back,
	// Forward and deep links pick the tab. Characters exists only for Han
	// languages; a direct visit in another workspace shows the panel's
	// note with no tab selected.
	const tabs = $derived(statsTabs($currentLanguage));
	const active = $derived(activeStatsTab(page.url.pathname));
	const activeTab = $derived(tabs.find((tab) => tab.id === active) ?? null);
	const panelLabel = $derived(active === 'characters' ? 'Characters' : 'Overview');

	const tabEls: Record<string, HTMLAnchorElement | undefined> = {};

	// Manual activation: the arrows, Home and End move focus between the
	// tabs, Enter (a link's own key) or Space opens one. The character
	// map is heavy, so merely arrowing past it must not load it.
	function onkeydown(event: KeyboardEvent) {
		const focused = tabs.findIndex((tab) => tabEls[tab.id] === document.activeElement);
		if (event.key === ' ') {
			if (focused < 0) return;
			event.preventDefault();
			tabEls[tabs[focused].id]?.click();
			return;
		}
		const target = tabKeyTarget(event.key, focused, tabs.length);
		if (target === null) return;
		event.preventDefault();
		tabEls[tabs[target].id]?.focus();
	}
</script>

<svelte:head>
	<title>{pageTitle(panelLabel, 'Stats')}</title>
</svelte:head>

<main class="stats">
	<h1>Stats</h1>

	<!-- Tabs are links: the router keeps focus on the tab and the scroll
	     position, so switching views feels like a tab, not a new page. -->
	<div class="tabs" role="tablist" aria-label="Stats views">
		{#each tabs as tab (tab.id)}
			{@const selected = tab.id === active}
			<a
				bind:this={tabEls[tab.id]}
				id="stats-tab-{tab.id}"
				class="tab"
				role="tab"
				href={tab.href}
				{onkeydown}
				aria-selected={selected}
				aria-controls={selected ? 'stats-panel' : undefined}
				tabindex={selected || (activeTab === null && tab.id === 'overview') ? 0 : -1}
				data-sveltekit-keepfocus
				data-sveltekit-noscroll>{tab.label}</a
			>
		{/each}
	</div>

	<div
		id="stats-panel"
		class="panel"
		role="tabpanel"
		tabindex="0"
		aria-labelledby={activeTab ? `stats-tab-${activeTab.id}` : undefined}
		aria-label={activeTab ? undefined : panelLabel}
	>
		{@render children()}
	</div>
</main>

<style>
	.stats {
		max-width: 64rem;
	}

	.stats h1 {
		margin-bottom: 1rem;
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
	}

	.tab {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 1rem;
		margin-bottom: -1px;
		border-bottom: 3px solid transparent;
		color: inherit;
		text-decoration: none;
		font-weight: 500;
		opacity: 0.85;
	}

	.tab:hover {
		opacity: 1;
		background: color-mix(in srgb, currentColor 6%, transparent);
	}

	.tab[aria-selected='true'] {
		opacity: 1;
		font-weight: 650;
		color: #0957a6;
		border-bottom-color: #0b6bcb;
	}

	.tab:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: -2px;
		border-radius: 0.4rem 0.4rem 0 0;
	}

	.panel {
		margin-top: 1.5rem;
	}

	.panel:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 0.5rem;
		border-radius: 0.25rem;
	}

	@media (prefers-color-scheme: dark) {
		.tab[aria-selected='true'] {
			color: #8cc4ff;
			border-bottom-color: #6cb4ff;
		}

		.tab:focus-visible,
		.panel:focus-visible {
			outline-color: #6cb4ff;
		}
	}
</style>
