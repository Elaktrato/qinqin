<script lang="ts">
	// Every milestone of the workspace, newest first: the title as a plain
	// row, its day as muted text and the new ones marked "New" as text (never
	// colour alone). No pill: a --hair separator is the whole structure.
	import type { HistoryItem } from './plan';
	import { MILESTONE_TEXT, reachedOn } from './milestoneText';

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
				<span class="title">{titles.get(item.id) ?? item.id}</span>
				<span class="date">{reachedOn(item.day, locale)}</span>
				{#if item.isNew}<span class="new">{MILESTONE_TEXT.isNew}</span>{/if}
			</li>
		{/each}
	</ol>
{/if}

<style>
	.milestone-history {
		margin: var(--space-2) 0 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
		padding: var(--space-2) 0;
		border-top: 1px solid var(--hair);
	}

	.title {
		font-weight: var(--weight-medium);
	}

	.date {
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.new {
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
	}

	.empty {
		margin: var(--space-2) 0 0;
		color: var(--readable-muted);
	}
</style>
