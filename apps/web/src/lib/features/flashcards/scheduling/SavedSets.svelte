<script lang="ts">
	import { t } from '$lib/i18n';
	import type { ParamSet } from '$lib/studycore/fsrsParams';
	import { Button, Section } from '$lib/ui';

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

<Section title={t('flashcards.sched.savedSets')}>
	<ul>
		<li>
			<span>{active(t('flashcards.sched.defaults'), activeId === null)}</span>
			{#if activeId !== null}
				<Button disabled={busy} onclick={onDefaults}>{t('flashcards.sched.useDefaults')}</Button>
			{/if}
		</li>
		{#each sets as set (set.id)}
			<li>
				<span>{active(label(set), set.id === activeId)}</span>
				{#if set.id !== activeId}
					<Button disabled={busy} onclick={() => onUse(set.id)}>{t('flashcards.sched.use')}</Button>
					<Button tone="danger" disabled={busy} onclick={() => onDelete(set.id)}
						>{t('flashcards.sched.delete')}</Button
					>
				{/if}
			</li>
		{/each}
	</ul>
</Section>

<style>
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	/* One hairline row per saved set (#106). */
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		min-height: var(--hit);
	}

	li + li {
		border-top: 1px solid var(--hair);
	}

	li span {
		flex: 1 1 12rem;
	}
</style>
