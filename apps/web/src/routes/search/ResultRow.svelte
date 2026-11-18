<script lang="ts">
	// One search result (#104): word large, reading in the reading accent,
	// the first visible gloss and kind · level. The whole row is one link
	// named by the word; the rest is its description, so a screen reader
	// hears the word first and the details after it.
	import { studyLang, readingLang } from '$lib/i18n/lang';
	import type { SearchHit } from '$lib/api/types';
	import { firstGloss, kindLevel } from '$lib/search/rowText';

	let {
		hit,
		href,
		selected,
		hidden
	}: {
		hit: SearchHit;
		href: string;
		selected: boolean;
		hidden: ReadonlySet<number>;
	} = $props();

	const reading = $derived(hit.readings[0]);
	const gloss = $derived(firstGloss(hit, hidden));
	const meta = $derived(kindLevel(hit));
	const id = $derived(`hit-${hit.id}`);
</script>

<a
	class="row"
	class:selected
	{href}
	aria-label={hit.written}
	aria-current={selected ? 'true' : undefined}
	aria-describedby={`${id}-reading ${id}-gloss ${id}-meta`}
>
	<span class="word" lang={studyLang(hit.language)}>{hit.written}</span>
	<span class="reading" id={`${id}-reading`} lang={reading ? readingLang(reading.type, hit.language) : undefined}
		>{reading?.value ?? ''}</span
	>
	<span class="gloss" id={`${id}-gloss`}>{gloss}</span>
	<span class="meta" id={`${id}-meta`}>{meta}</span>
</a>

<style>
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: auto auto;
		column-gap: var(--space-3);
		row-gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius);
		color: var(--text);
		text-decoration: none;
	}
	.row:hover {
		background: var(--raised);
	}
	.row.selected {
		background: var(--selected-wash);
		box-shadow: inset 2px 0 0 var(--accent);
	}
	.word {
		grid-row: 1 / span 2;
		align-self: center;
		font-size: 1.5rem;
		font-weight: var(--weight-regular);
		line-height: var(--line-tight);
	}
	.reading {
		color: var(--reading-accent);
		font-weight: var(--weight-medium);
		font-size: var(--font-size-label);
	}
	.gloss {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		grid-column: 2;
		grid-row: 2;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	@media (max-width: 40rem) {
		.reading,
		.meta {
			display: none;
		}
	}
</style>
