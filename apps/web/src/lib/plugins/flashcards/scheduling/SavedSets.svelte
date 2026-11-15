<script lang="ts">
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
		`${set.source === 'optimized' ? 'Optimised' : 'Imported'} ${set.createdAt.slice(0, 10)}`;
</script>

<section aria-labelledby="sets-heading">
	<h2 id="sets-heading">Saved sets</h2>
	<ul>
		<li>
			<span>Default parameters{activeId === null ? ' (active)' : ''}</span>
			{#if activeId !== null}
				<button type="button" disabled={busy} onclick={onDefaults}>Use defaults</button>
			{/if}
		</li>
		{#each sets as set (set.id)}
			<li>
				<span>{label(set)}{set.id === activeId ? ' (active)' : ''}</span>
				{#if set.id !== activeId}
					<button type="button" disabled={busy} onclick={() => onUse(set.id)}>Use</button>
					<button type="button" disabled={busy} onclick={() => onDelete(set.id)}>Delete</button>
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
