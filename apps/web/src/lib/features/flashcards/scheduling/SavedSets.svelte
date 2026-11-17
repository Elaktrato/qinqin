<script lang="ts">
	import { t } from '$lib/i18n';
	import type { ParamSet } from '$lib/study/fsrs/params';

	let {
		sets,
		activeId,
		busy,
		onUse,
		onDelete,
		onDefaults
	}: {
		sets: readonly ParamSet[];
		activeId: string | null;
		busy: boolean;
		onUse: (id: string) => void;
		onDelete: (id: string) => void;
		onDefaults: () => void;
	} = $props();

	const label = (set: ParamSet): string =>
		set.source === 'optimized'
			? t('flashcards.sched.optimised', { date: set.createdAt.slice(0, 10) })
			: t('flashcards.sched.imported', { date: set.createdAt.slice(0, 10) });
	const active = (name: string, on: boolean): string => (on ? t('flashcards.sched.active', { name }) : name);
</script>

<section aria-labelledby="sets-heading">
	<h2 id="sets-heading">{t('flashcards.sched.savedSets')}</h2>
	<ul>
		<li>
			<span>{active(t('flashcards.sched.defaults'), activeId === null)}</span>
			{#if activeId !== null}
				<button type="button" disabled={busy} onclick={onDefaults}>{t('flashcards.sched.useDefaults')}</button>
			{/if}
		</li>
		{#each sets as set (set.id)}
			<li>
				<span>{active(label(set), set.id === activeId)}</span>
				{#if set.id !== activeId}
					<button type="button" disabled={busy} onclick={() => onUse(set.id)}>{t('flashcards.sched.use')}</button>
					<button type="button" disabled={busy} onclick={() => onDelete(set.id)}>{t('flashcards.sched.delete')}</button>
				{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		padding: 0.25rem 0;
	}

	li span {
		flex: 1 1 12rem;
	}

	button {
		min-height: 44px;
		min-width: 44px;
		padding: 0 1rem;
	}
</style>
