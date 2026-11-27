<script lang="ts">
	import type { Fit } from '../fsrs/evaluate';
	import { t } from '$lib/i18n';
	import { formatNumber } from '$lib/i18n/format';
	import { LOW_DATA_LABELLED, MIN_LABELLED, type OptimizeResult } from '../fsrs/optimize';
	import { Button, Section } from '$lib/ui';

	let {
		labelled,
		running,
		progress,
		result,
		activeFit,
		error,
		primary = true,
		onOptimise,
		onCancel
	}: {
		labelled: number;
		running: boolean;
		progress: number;
		result: OptimizeResult | null;
		activeFit: Fit;
		error: string;
		/** The view's one primary: false while a candidate's Apply is primary. */
		primary?: boolean;
		onOptimise: () => void;
		onCancel: () => void;
	} = $props();

	const missing = $derived(Math.max(0, MIN_LABELLED - labelled));
	const percent = $derived(Math.round(progress * 100));
	const pct = (x: number): string =>
		t('flashcards.optimise.percent', { value: formatNumber(x * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
	const loss = (n: number): string => formatNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
</script>

<Section title={t('flashcards.optimise.title')}>
	<p class="hint">
		{t('flashcards.optimise.usable', { count: labelled })}
		{#if missing > 0}
			{t('flashcards.optimise.missing', { count: missing })}
		{:else if labelled < LOW_DATA_LABELLED}
			{t('flashcards.optimise.littleData')}
		{/if}
	</p>

	<div class="row">
		<Button
			variant={primary ? 'primary' : 'secondary'}
			disabled={running || missing > 0}
			onclick={onOptimise}>{t('flashcards.optimise.run')}</Button
		>
		{#if running}
			<label class="progress">
				<span id="optimise-progress-label">{t('flashcards.optimise.training', { percent })}</span>
				<progress max="1" value={progress} aria-labelledby="optimise-progress-label"></progress>
			</label>
			<Button variant="plain" onclick={onCancel}>{t('common.action.cancel')}</Button>
		{/if}
	</div>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if result !== null}
		<div role="status">
			{#if result.ok}
				{#if result.heldOut?.small}
					<p>
						{t('flashcards.optimise.heldOutSmall', {
							items: formatNumber(result.heldOut.items),
							before: loss(result.heldOut.current),
							after: loss(result.heldOut.candidate)
						})}
					</p>
					<p class="hint">
						{t('flashcards.optimise.trainSmall', { before: loss(activeFit.logLoss), after: loss(result.logLoss) })}
					</p>
				{:else}
					<p>
						{t('flashcards.optimise.train', {
							before: loss(activeFit.logLoss),
							after: loss(result.logLoss),
							rmseBefore: pct(activeFit.rmseBins),
							rmseAfter: pct(result.rmseBins)
						})}
					</p>
					{#if result.heldOut}
						<p class="hint">
							{t('flashcards.optimise.heldOut', {
								items: formatNumber(result.heldOut.items),
								before: loss(result.heldOut.current),
								after: loss(result.heldOut.candidate)
							})}
						</p>
					{/if}
				{/if}
			{:else if result.reason === 'too-few'}
				<p>{t('flashcards.optimise.tooFew')}</p>
			{:else}
				<p>{t('flashcards.optimise.cancelled')}</p>
			{/if}
		</div>
	{/if}
</Section>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-4);
	}

	.progress {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.hint {
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
