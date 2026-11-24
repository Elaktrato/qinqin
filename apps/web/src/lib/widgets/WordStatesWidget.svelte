<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import {
		WORD_STATES,
		wordStateCounts,
		wordStateShares,
		wordStateSummary,
		type WordStatesResult
	} from '$lib/stats/wordStates';
	import { contextForData, onContextStale } from '$lib/study/currentContext';
	import { loadStudyHistory } from '$lib/study/data';
	import { activeWeights } from '$lib/study/readModel';
	import { workspaces } from '$lib/workspaces';
	import { flashcardsHref } from '$lib/features/flashcards/route';
	import WidgetCard from './WidgetCard.svelte';
	import type { WidgetStatus } from './types';

	// Word states (flashcards plugin): how many words are new, learning,
	// young or mature. Stats shows a per-deck table under the overall
	// bar; the home variant (compact) shows the overall numbers only.

	let { compact = false }: { compact?: boolean } = $props();

	let result = $state.raw<WordStatesResult | null>(null);
	let loading = $state(true);
	let error = $state('');
	let noWorkspace = $state(false);

	// Guards against a slow earlier request overwriting a newer view.
	let requestSeq = 0;

	const workspaceId = $derived($workspaces.current?.id ?? null);
	const headingId = $derived(compact ? 'word-states-home-heading' : 'word-states-heading');

	const overall = $derived(result?.overall ?? null);
	const shares = $derived(overall === null ? [] : wordStateShares(overall));
	const status = $derived<WidgetStatus>(
		noWorkspace
			? 'no-workspace'
			: loading
				? 'loading'
				: error
					? 'error'
					: (overall?.total ?? 0) === 0
						? 'empty'
						: 'ready'
	);

	async function load(workspace: number | null, force = false): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		error = '';
		noWorkspace = false;

		if (workspace === null) {
			result = null;
			noWorkspace = true;
			loading = false;
			return;
		}

		try {
			// Duplicate cards arrive merged, their reviews re-pointed; the
			// history is shared with the other widgets (study/data.ts loadStudyHistory).
			const data = await loadStudyHistory(workspace, { force });
			if (seq !== requestSeq) return;
			result = wordStateCounts(data.cards, data.reviews, data.decks, new Date(), activeWeights(data), contextForData(data, workspace).clock);
		} catch (err) {
			if (seq !== requestSeq) return;
			result = null;
			error = errorText(err, t('widgets.words.loadFailed'));
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	$effect(() => {
		void load(workspaceId);
	});
	$effect(() => onContextStale(() => void load(workspaceId)));

	// The per-deck table scrolls sideways on narrow screens: a visible hint
	// says so while columns are hidden to the right. Screen readers get the
	// whole table, so the hint is hidden from them.
	let tableWrap = $state<HTMLDivElement | null>(null);
	let moreRight = $state(false);

	function measure(): void {
		const el = tableWrap;
		moreRight = el !== null && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
	}

	$effect(() => {
		const el = tableWrap;
		if (el === null) return;
		measure();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		// The table's own width changes with the deck names and numbers.
		if (el.firstElementChild) observer.observe(el.firstElementChild);
		return () => observer.disconnect();
	});
</script>

<WidgetCard
	title={t('widgets.words.title')}
	{headingId}
	{status}
	noWorkspaceText={t('widgets.words.noWorkspace')}
	loadingText={t('widgets.words.loading')}
	{error}
	onretry={() => void load(workspaceId, true)}
	emptyText={t('widgets.words.empty')}
>
	{#if overall !== null}
		<p class="lead">
			<strong>{overall.total}</strong>
			{t('widgets.words.inDecks', { count: overall.total })}
			<strong>{overall.new}</strong>
			{t('widgets.words.waiting', { count: overall.new })}
		</p>

		<div class="bar" role="img" aria-label={wordStateSummary(overall)}>
			{#each shares as part (part.state)}
				<span class="seg ws-{part.state}" style:flex-grow={part.share}></span>
			{/each}
		</div>

		<ul class="legend">
			{#each WORD_STATES as item (item.state)}
				<li>
					<span class="swatch ws-{item.state}" aria-hidden="true"></span>
					{item.label} <strong>{overall[item.state]}</strong>
				</li>
			{/each}
		</ul>

		{#if !compact && result !== null && result.decks.length > 0}
			<!-- Scrolls sideways when the columns do not fit; focusable so keyboards can scroll it. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="table-wrap"
				class:more-right={moreRight}
				tabindex="0"
				role="region"
				aria-label={t('widgets.words.perDeck')}
				bind:this={tableWrap}
				onscroll={measure}
			>
				<table>
					<caption class="sr">{t('widgets.words.perDeck')}</caption>
					<thead>
						<tr>
							<th scope="col">{t('widgets.words.deck')}</th>
							{#each WORD_STATES as item (item.state)}
								<th scope="col" class="num">{item.label}</th>
							{/each}
							<th scope="col" class="num">{t('widgets.words.total')}</th>
						</tr>
					</thead>
					<tbody>
						{#each result.decks as row (row.id)}
							<tr>
								<th scope="row"><a href={flashcardsHref({ view: 'deck', deckId: row.id })}>{row.name}</a></th>
								{#each WORD_STATES as item (item.state)}
									<td class="num">{row.counts[item.state]}</td>
								{/each}
								<td class="num">{row.counts.total}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if moreRight}
				<p class="scroll-hint" aria-hidden="true">{t('widgets.words.scrollHint')}</p>
			{/if}
		{/if}

		<p class="note">
			{t('widgets.words.note')}
		</p>
	{/if}
</WidgetCard>

<style>
	.lead {
		margin: 0.9rem 0 0;
		font-size: 0.9rem;
	}

	.bar {
		display: flex;
		height: 0.75rem;
		margin-top: 0.6rem;
		overflow: hidden;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		background: color-mix(in srgb, currentColor 6%, transparent);
	}

	.seg {
		flex-basis: 0;
		min-width: 3px;
	}

	/* Text carries every number; the accent ramp only repeats it (design §9,
	   "cards by state as one stacked bar in the accent ramp"). */
	.ws-new {
		background: var(--accent-14);
	}

	.ws-learning {
		background: var(--accent-32);
	}

	.ws-young {
		background: var(--accent-58);
	}

	.ws-mature {
		background: var(--accent-100);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		margin: 0.6rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.85rem;
	}

	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.swatch {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 0.15rem;
	}

	.table-wrap {
		margin-top: 0.9rem;
		overflow-x: auto;
	}

	/* A soft edge on the right while columns are hidden there. */
	.table-wrap.more-right {
		mask-image: linear-gradient(to right, currentColor calc(100% - 1.5rem), transparent); /* only the alpha counts */
	}

	.scroll-hint {
		margin: 0.3rem 0 0;
		font-size: 0.78rem;
		text-align: right;
		color: var(--readable-muted);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	th,
	td {
		padding: 0.3rem 0.35rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
		text-align: left;
	}

	thead th {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--readable-muted);
	}

	tbody th {
		/* Room for a deck name on phones; a long one wraps at word breaks. */
		min-width: 6.5rem;
		font-weight: 500;
		overflow-wrap: break-word;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.note {
		margin: 0.75rem 0 0;
		font-size: 0.8rem;
		color: var(--readable-muted);
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
