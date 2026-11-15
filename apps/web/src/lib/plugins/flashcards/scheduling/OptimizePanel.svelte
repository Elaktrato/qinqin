<script lang="ts">
	import type { Fit } from '$lib/study/fsrs/evaluate';
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
	const pct = (x: number): string => `${(x * 100).toFixed(1)} %`;
</script>

<section aria-labelledby="optimise-heading">
	<h2 id="optimise-heading">Optimise</h2>
	<p class="hint">
		{labelled.toLocaleString()} reviews can be used for fitting.
		{#if missing > 0}
			{missing.toLocaleString()} more reviews needed before the parameters can be optimised.
		{:else if labelled < LOW_DATA_LABELLED}
			Little data: the fit may move a lot later.
		{/if}
	</p>

	<div class="row">
		<button type="button" disabled={running || missing > 0} onclick={onOptimise}>Optimise</button>
		{#if running}
			<label class="progress">
				<span id="optimise-progress-label">Training… {percent} %</span>
				<progress max="1" value={progress} aria-labelledby="optimise-progress-label"></progress>
			</label>
			<button type="button" onclick={onCancel}>Cancel</button>
		{/if}
	</div>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if result !== null}
		<div role="status">
			{#if result.ok}
				<p>
					Log loss {activeFit.logLoss.toFixed(3)} → {result.logLoss.toFixed(3)} · RMSE
					{pct(activeFit.rmseBins)} → {pct(result.rmseBins)}
				</p>
			{:else if result.reason === 'too-few'}
				<p>Not enough reviews yet.</p>
			{:else}
				<p>Optimisation cancelled.</p>
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
