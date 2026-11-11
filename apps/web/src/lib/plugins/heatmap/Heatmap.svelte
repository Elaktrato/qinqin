<script lang="ts">
	import { ApiError, api } from '$lib/api/client';
	import { sinceDaysAgo } from '$lib/events';
	import type { StudyEvent } from '$lib/events';
	import { aggregateByDay, HEATMAP_DAYS } from '$lib/heatmap/aggregate';
	import { workspaces } from '$lib/workspaces';

	// Two views of the same log: the current workspace alone, or every
	// workspace combined (the server omits `workspace` for that).
	type Scope = 'workspace' | 'all';

	let scope = $state<Scope>('workspace');
	let events = $state<StudyEvent[]>([]);
	let loading = $state(true);
	let error = $state('');

	// Guards against a slow earlier request overwriting a newer view.
	let requestSeq = 0;

	const workspaceId = $derived($workspaces.current?.id ?? null);
	// What the fetch scopes to: the current workspace, or null for the
	// combined history. Deriving it keeps workspace switches from
	// refetching while the combined view is shown.
	const requestedWorkspace = $derived(scope === 'workspace' ? workspaceId : null);
	const cells = $derived(
		[...aggregateByDay(events).entries()].map(([day, count]) => ({
			day,
			count,
			level: intensity(count)
		}))
	);
	const total = $derived(cells.reduce((sum, cell) => sum + cell.count, 0));

	function intensity(count: number): number {
		if (count <= 0) return 0;
		if (count === 1) return 1;
		if (count <= 3) return 2;
		if (count <= 6) return 3;
		return 4;
	}

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	async function load(workspace: number | null): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		error = '';
		try {
			const params = new URLSearchParams({ since: sinceDaysAgo(HEATMAP_DAYS) });
			if (workspace !== null) params.set('workspace', String(workspace));
			const list = await api<StudyEvent[]>(`/api/events?${params.toString()}`);
			if (seq !== requestSeq) return;
			events = list;
		} catch (err) {
			if (seq !== requestSeq) return;
			events = [];
			error = message(err, 'Could not load study history.');
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	// Refetch when the effective scope changes: the toggle, or the
	// workspace while the workspace view is active.
	$effect(() => {
		void load(requestedWorkspace);
	});
</script>

<section class="heatmap" aria-labelledby="heatmap-heading">
	<header class="head">
		<h2 id="heatmap-heading">Study heatmap</h2>

		{#if workspaceId !== null}
			<div class="scope" role="group" aria-label="Study history scope">
				<button
					type="button"
					aria-pressed={scope === 'workspace'}
					onclick={() => (scope = 'workspace')}
				>
					This workspace
				</button>
				<button type="button" aria-pressed={scope === 'all'} onclick={() => (scope = 'all')}>
					All languages
				</button>
			</div>
		{/if}
	</header>

	{#if loading}
		<p class="hint" aria-live="polite">Loading study history…</p>
	{:else if error}
		<p class="hint" role="status">
			{error}
			<button type="button" class="retry" onclick={() => void load(requestedWorkspace)}>
				Try again
			</button>
		</p>
	{:else}
		<div
			class="grid"
			role="img"
			aria-label={`Study activity for the last 13 weeks: ${total} ${total === 1 ? 'event' : 'events'}`}
		>
			{#each cells as cell (cell.day)}
				<span
					class="cell level-{cell.level}"
					title={`${cell.day}: ${cell.count} ${cell.count === 1 ? 'event' : 'events'}`}
				></span>
			{/each}
		</div>

		<footer class="legend">
			<span>
				{total}
				{total === 1 ? 'event' : 'events'} in the last 13 weeks
			</span>
			<span class="scale" aria-hidden="true">
				Less
				{#each [0, 1, 2, 3, 4] as level (level)}
					<span class="cell level-{level}"></span>
				{/each}
				More
			</span>
		</footer>
	{/if}
</section>

<style>
	.heatmap {
		margin-top: 2.5rem;
		padding: 1rem 1.25rem 1.15rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.5rem;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}

	h2 {
		margin: 0;
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.scope {
		display: flex;
		gap: 0.35rem;
	}

	.scope button,
	.retry {
		font: inherit;
		font-size: 0.8rem;
		padding: 0.2rem 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.scope button[aria-pressed='true'] {
		border-color: #0b6bcb;
		color: #0b6bcb;
		font-weight: 600;
	}

	.retry {
		margin-left: 0.35rem;
	}

	.grid {
		display: grid;
		grid-template-rows: repeat(7, 0.85rem);
		grid-auto-flow: column;
		grid-auto-columns: 0.85rem;
		gap: 0.2rem;
		margin-top: 0.9rem;
		overflow-x: auto;
		padding-bottom: 0.2rem;
	}

	.cell {
		display: block;
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 0.15rem;
		background: color-mix(in srgb, currentColor 12%, transparent);
	}

	.level-1 {
		background: color-mix(in srgb, #2ea043 35%, transparent);
	}

	.level-2 {
		background: color-mix(in srgb, #2ea043 55%, transparent);
	}

	.level-3 {
		background: color-mix(in srgb, #2ea043 75%, transparent);
	}

	.level-4 {
		background: color-mix(in srgb, #2ea043 100%, transparent);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		margin-top: 0.75rem;
		font-size: 0.8rem;
		opacity: 0.75;
	}

	.scale {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}

	.scale .cell {
		width: 0.65rem;
		height: 0.65rem;
	}

	.hint {
		margin: 0.9rem 0 0;
		font-size: 0.9rem;
		opacity: 0.75;
	}
</style>
