<script lang="ts">
	// The sample drill's question (a test harness): the item, then Right or Wrong; after the answer, which one it was.
	import { t } from '$lib/i18n';
	import { Button } from '$lib/ui';
	import type { DrillQuestionProps } from '../types';

	let { item, answered, onAnswer }: DrillQuestionProps = $props();

	let chosen = $state<'right' | 'wrong' | null>(null);
	// A new item: the component is not remounted, so it forgets the last answer itself.
	$effect(() => {
		void item.key;
		chosen = null;
	});

	function choose(which: 'right' | 'wrong'): void {
		chosen = which;
		onAnswer({ mode: 'self', grade: which === 'right' ? 3 : 1 });
	}
</script>

<p class="prompt">{item.key}</p>
<p>{t('practice.sample.ask')}</p>
{#if answered}
	<p role="status">{chosen === 'wrong' ? t('practice.sample.wrong') : t('practice.sample.right')}</p>
{:else}
	<div class="choices">
		<Button variant="primary" onclick={() => choose('right')}>{t('practice.sample.knew')}</Button>
		<Button onclick={() => choose('wrong')}>{t('practice.sample.didNotKnow')}</Button>
	</div>
{/if}

<style>
	.prompt {
		margin: 0;
		font-size: var(--font-size-xl);
		overflow-wrap: anywhere;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
