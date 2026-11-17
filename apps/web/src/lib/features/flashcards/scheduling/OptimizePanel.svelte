<script lang="ts">
	import type { Fit } from '$lib/study/fsrs/evaluate';
	import { t } from '$lib/i18n';
	import { formatNumber } from '$lib/i18n/format';
	import { LOW_DATA_LABELLED, MIN_LABELLED, type OptimizeResult } from '$lib/study/fsrs/optimize';

	let {
		labelled,
		running,
		progress,
		result,
		activeFit,
		error,
		onOptimise,
		onCancel
	}: {
		labelled: number;
		running: boolean;
		progress: number;
		result: OptimizeResult | null;
		activeFit: Fit;
		error: string;
		onOptimise: () => void;
		onCancel: () => void;
	} = $props();

	const missing = $derived(Math.max(0, MIN_LABELLED - labelled));
	const percent = $derived(Math.round(progress * 100));
	const pct = (x: number): string =>
		t('flashcards.optimise.percent', { value: formatNumber(x * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
	const loss = (n: number): string => formatNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
</script>

<section aria-labelledby="optimise-heading">
	<h2 id="optimise-heading">{t('flashcards.optimise.title')}</h2>
	<p class="hint">
		{t('flashcards.optimise.usable', { count: labelled })}
		{#if missing > 0}
			{t('flashcards.optimise.missing', { count: missing })}
		{:else if labelled < LOW_DATA_LABELLED}
			{t('flashcards.optimise.littleData')}
		{/if}
	</p>

	<div class="row">
		<button type="button" disabled={running || missing > 0} onclick={onOptimise}>{t('flashcards.optimise.run')}</button>
		{#if running}
			<label class="progress">
				<span id="optimise-progress-label">{t('flashcards.optimise.training', { percent })}</span>
				<progress max="1" value={progress} aria-labelledby="optimise-progress-label"></progress>
			</label>
			<button type="button" onclick={onCancel}>{t('common.action.cancel')}</button>
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
</section>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1rem;
	}

	button {
		min-height: 44px;
		min-width: 44px;
		padding: 0 1rem;
	}

	.progress {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.hint {
		opacity: 0.75;
	}

	.error {
		color: #b3261e;
	}
</style>
