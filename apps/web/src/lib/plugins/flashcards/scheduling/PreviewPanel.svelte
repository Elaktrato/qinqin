<script lang="ts">
	import type { Fit } from '$lib/study/fsrs/evaluate';
	import type { ApplyCheck, Preview } from '$lib/study/fsrs/preview';

	let {
		preview,
		pending,
		error,
		check,
		busy,
		fit,
		source,
		onApply,
		onDiscard
	}: {
		preview: Preview | null;
		pending: boolean;
		error: string;
		check: ApplyCheck;
		busy: boolean;
		fit: { current: Fit; candidate: Fit };
		source: 'optimized' | 'imported';
		onApply: () => void;
		onDiscard: () => void;
	} = $props();

	const pair = (p: readonly [number, number]): string => `${p[0]} → ${p[1]}`;
	const days = (p: readonly [number, number]): string =>
		`${p[0].toFixed(1)} d → ${p[1].toFixed(1)} d`;
	const date = (iso: string): string => new Date(iso).toLocaleDateString();
</script>

<section aria-labelledby="preview-heading">
	<h2 id="preview-heading">Preview</h2>
	<p class="hint">
		{source === 'imported' ? 'Imported parameters' : 'New parameters'} on all your reviews: log loss
		{fit.current.logLoss.toFixed(3)} → {fit.candidate.logLoss.toFixed(3)}
	</p>
	{#if pending}
		<p role="status">Calculating the preview…</p>
	{:else if error}
		<p class="warn" role="alert">{error}</p>
	{:else if preview}
		<p>
			Due now {pair(preview.dueNow)} · next 7 days {pair(preview.due7)} · next 30 days
			{pair(preview.due30)} · median interval {days(preview.medianIntervalDays)}
		</p>
		{#if preview.surge}
			<p class="warn" role="alert">
				Many more cards would be due right away. Check the list below before you apply.
			</p>
		{/if}
		{#if preview.moved.length === 0}
			<p class="hint">No due date moves.</p>
		{:else}
			<ul>
				{#each preview.moved as row (row.cardId)}
					<li>{row.written || row.cardId}: {date(row.before)} → {date(row.after)}</li>
				{/each}
			</ul>
		{/if}
		<p class="hint">Mastery scores and Word Salad tiers recompute too, since they use stability.</p>
	{/if}

	{#if !check.ok}
		<p role="status">{check.reason}</p>
	{/if}
	<div class="row">
		<button type="button" disabled={busy || !check.ok || pending || error !== ''} onclick={onApply}>Apply</button>
		<button type="button" disabled={busy} onclick={onDiscard}>Discard</button>
	</div>
</section>

<style>
	.row {
		display: flex;
		gap: 0.75rem;
	}

	button {
		min-height: 44px;
		min-width: 44px;
		padding: 0 1rem;
	}

	.hint {
		opacity: 0.75;
	}

	.warn {
		color: #8a5a00;
		font-weight: 600;
	}
</style>
