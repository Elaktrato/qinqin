<script lang="ts">
	// Every milestone of the workspace, newest first: the seen ones with their
	// stored day and the new ones marked "New" (as text, never colour alone).
	import type { HistoryItem } from './plan';
	import { MILESTONE_TEXT, titleWithDay } from './milestoneText';

	interface Props {
		items: HistoryItem[];
		titles: ReadonlyMap<string, string>;
		locale?: string;
	}

	let { items, titles, locale }: Props = $props();

	const shown = $derived(items.filter((item) => titles.has(item.id)));
</script>

{#if shown.length === 0}
	<p class="empty">{MILESTONE_TEXT.empty}</p>
{:else}
	<ol class="milestone-history">
		{#each shown as item (item.id)}
			<li>
				{titleWithDay(titles.get(item.id) ?? item.id, item.day, locale)}
				{#if item.isNew}<span class="new">{MILESTONE_TEXT.isNew}</span>{/if}
			</li>
		{/each}
	</ol>
{/if}

<style>
	.milestone-history {
		margin: 0.5rem 0 0;
		padding-left: 1.4rem;
		display: grid;
		gap: 0.3rem;
	}

	.new {
		margin-left: 0.4rem;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.05rem 0.45rem;
		border: 1px solid currentColor;
		border-radius: 999px;
	}

	.empty {
		margin: 0.5rem 0 0;
		color: var(--readable-muted);
	}
</style>
