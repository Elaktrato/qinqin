<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatWeights, parseWeightString } from '$lib/study/fsrs/params';
	import { Button, Field, Section } from '$lib/ui';

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

<Section title={t('flashcards.sched.importExport')}>
	<Field
		label={t('flashcards.sched.parameters')}
		multiline
		bind:value={text}
		oninput={() => (error = '')}
	/>
	<div class="row">
		<Button disabled={busy || text.trim() === ''} onclick={doImport}>{t('flashcards.sched.import')}</Button>
		<Button variant="plain" onclick={copy}>{t('flashcards.sched.copyActive')}</Button>
		{#if copied}<span role="status">{t('flashcards.sched.copied')}</span>{/if}
	</div>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<p class="hint"><code>{formatWeights(activeW)}</code></p>
</Section>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}

	.error {
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.hint {
		color: var(--readable-muted);
		overflow-wrap: anywhere;
	}
</style>
