<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatWeights, parseWeightString } from '$lib/study/fsrs/params';

	let {
		activeW,
		busy,
		onImport
	}: {
		activeW: readonly number[];
		busy: boolean;
		onImport: (w: number[]) => void;
	} = $props();

	let text = $state('');
	let error = $state('');
	let copied = $state(false);

	function doImport(): void {
		const parsed = parseWeightString(text);
		if (!parsed.ok) {
			error = parsed.error;
			return;
		}
		error = '';
		onImport(parsed.w);
	}

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(formatWeights(activeW));
			copied = true;
			error = '';
		} catch {
			copied = false;
			error = t('flashcards.sched.copyFailed');
		}
	}
</script>

<section aria-labelledby="import-heading">
	<h2 id="import-heading">{t('flashcards.sched.importExport')}</h2>
	<label>
		{t('flashcards.sched.parameters')}
		<textarea rows="3" bind:value={text} oninput={() => (error = '')}></textarea>
	</label>
	<div class="row">
		<button type="button" disabled={busy || text.trim() === ''} onclick={doImport}>{t('flashcards.sched.import')}</button>
		<button type="button" onclick={copy}>{t('flashcards.sched.copyActive')}</button>
		{#if copied}<span role="status">{t('flashcards.sched.copied')}</span>{/if}
	</div>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<p class="hint"><code>{formatWeights(activeW)}</code></p>
</section>

<style>
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	textarea {
		font: inherit;
		width: 100%;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	button {
		min-height: 44px;
		min-width: 44px;
		padding: 0 1rem;
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.hint {
		color: var(--readable-muted);
		overflow-wrap: anywhere;
	}
</style>
