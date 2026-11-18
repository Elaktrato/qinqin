<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatDate, formatNumber } from '$lib/i18n/format';
	import type { Fit } from '$lib/study/fsrs/evaluate';
	import type { ApplyCheck, Preview } from '$lib/study/fsrs/preview';
	import { Button, Section } from '$lib/ui';

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

	const pair = (p: readonly [number, number]): string =>
		t('flashcards.sched.pair', { before: formatNumber(p[0]), after: formatNumber(p[1]) });
	const one = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
	const days = (p: readonly [number, number]): string =>
		t('flashcards.sched.daysPair', { before: formatNumber(p[0], one), after: formatNumber(p[1], one) });
	const loss = (n: number): string => formatNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
	const date = (iso: string): string => formatDate(iso);
</script>

<Section title={t('flashcards.sched.preview')}>
	<p class="hint">
		{t(source === 'imported' ? 'flashcards.sched.fitImported' : 'flashcards.sched.fitNew', {
			before: loss(fit.current.logLoss),
			after: loss(fit.candidate.logLoss)
		})}
	</p>
	{#if pending}
		<p role="status">{t('flashcards.sched.calculating')}</p>
	{:else if error}
		<p class="warn" role="alert">{error}</p>
	{:else if preview}
		<p>
			{t('flashcards.sched.previewLine', {
				now: pair(preview.dueNow),
				week: pair(preview.due7),
				month: pair(preview.due30),
				interval: days(preview.medianIntervalDays)
			})}
		</p>
		{#if preview.surge}
			<p class="warn" role="alert">
				{t('flashcards.sched.surge')}
			</p>
		{/if}
		{#if preview.moved.length === 0}
			<p class="hint">{t('flashcards.sched.noMoves')}</p>
		{:else}
			<ul>
				{#each preview.moved as row (row.cardId)}
					<li>{t('flashcards.sched.moved', { card: row.written || row.cardId, before: date(row.before), after: date(row.after) })}</li>
				{/each}
			</ul>
		{/if}
		<p class="hint">{t('flashcards.sched.recompute')}</p>
	{/if}

	{#if !check.ok}
		<p role="status">{check.reason}</p>
	{/if}
	<div class="row">
		<Button variant="primary" disabled={busy || !check.ok || pending || error !== ''} onclick={onApply}
			>{t('flashcards.sched.apply')}</Button
		>
		<Button disabled={busy} onclick={onDiscard}>{t('flashcards.sched.discard')}</Button>
	</div>
</Section>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.hint {
		color: var(--readable-muted);
	}

	/* A warning: --text with the --warn bar as the cue. */
	.warn {
		font-weight: var(--weight-medium);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--warn);
	}
</style>
