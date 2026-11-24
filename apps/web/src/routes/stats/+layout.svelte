<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
	import { page } from '$app/state';
	import { activeStatsTab, statsPanelLabel, statsTabs } from '$lib/statsTabs';
	import Tabs from '$lib/ui/Tabs.svelte';
	import { useSession } from '$lib/context/context';
	const session = useSession();
	let { children } = $props();

	// Each view has its own URL (/stats, /stats/week, /stats/characters),
	// so Back, Forward and deep links pick the tab. The tabs are links, not
	// ARIA tabs: the base Tabs route form. Characters exists only for Han
	// languages; a direct visit in another workspace keeps its own note.
	const tabs = $derived(statsTabs(session.workspaces.language));
	const active = $derived(activeStatsTab(page.url.pathname));
	const activeTab = $derived(tabs.find((tab) => tab.id === active) ?? null);
	const panelLabel = $derived(statsPanelLabel(active));
	const tabItems = $derived(tabs.map((tab) => ({ id: tab.id, label: tab.label, href: tab.href })));
</script>

<svelte:head>
	<title>{pageTitle(panelLabel, t('stats.title'))}</title>
</svelte:head>

<div class="page-body stats">
	<h1>{t('stats.title')}</h1>

	<Tabs label={t('stats.tabsLabel')} tabs={tabItems} selected={active ?? ''} />

	<div
		id="stats-panel"
		class="panel"
		role="region"
		aria-label={activeTab ? activeTab.label : panelLabel}
	>
		{@render children()}
	</div>
</div>

<style>
	.stats {
		max-width: 64rem;
	}

	.stats h1 {
		margin-bottom: var(--space-3);
		font-weight: var(--weight-strong);
	}

	.panel {
		margin-top: var(--space-5);
	}

	.panel:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
		border-radius: var(--radius);
	}
</style>
