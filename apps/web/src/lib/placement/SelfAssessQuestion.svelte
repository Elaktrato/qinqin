<script lang="ts">
	// One self-assessed question, shared by the placement test (#74) and the
	// level check (#82): a written form, "I know it" or "Not sure", and a way
	// out. The caller counts, stores and decides; this only asks.
	import { t } from '$lib/i18n';
	import { Button } from '$lib/ui';

	let {
		written,
		language,
		unit,
		progress,
		cancelLabel,
		testid = 'placement-question',
		onreply,
		oncancel
	}: {
		written: string;
		language: string;
		unit: 'word' | 'character';
		/** "Question 3" or "3 of 20". */
		progress: string;
		cancelLabel: string;
		testid?: string;
		onreply: (known: boolean) => void;
		oncancel: () => void;
	} = $props();
</script>

<div class="test" data-testid={testid}>
	<p class="meta">{progress}</p>
	<p class="prompt">{unit === 'character' ? t('settings.placement.promptChar') : t('settings.placement.promptWord')}</p>
	<p class="item" lang={language}>{written}</p>
	<p class="hint">{t('settings.placement.honest')}</p>
	<div class="row">
		<Button variant="primary" onclick={() => onreply(true)} data-testid="placement-know">{t('settings.placement.know')}</Button>
		<Button onclick={() => onreply(false)} data-testid="placement-unsure">{t('settings.placement.unsure')}</Button>
		<Button variant="plain" onclick={oncancel}>{cancelLabel}</Button>
	</div>
</div>

<style>
	.test {
		display: grid;
		gap: var(--space-2);
		max-width: 28rem;
	}
	.meta,
	.hint {
		margin: 0;
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}
	.prompt {
		margin: 0;
	}
	.item {
		margin: var(--space-2) 0;
		font-size: 3rem;
		line-height: var(--line-tight);
		text-align: center;
		overflow-wrap: anywhere;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
