<script lang="ts">
	import { ApiError, api } from '$lib/api/client';
	import type { StudyEvent } from '$lib/events';
	import {
		HEATMAP_DAYS,
		activityByDay,
		dayTooltip,
		levelFor,
		windowStart,
		windowSummary
	} from '$lib/activity/activity';
	import WidgetCard from '$lib/widgets/WidgetCard.svelte';
	import type { WidgetStatus } from '$lib/widgets/types';
	import { workspaces } from '$lib/workspaces';

	// The core home heatmap: every learning source in ACTIVITY_SOURCES
	// (flashcard reviews, reading) for the active workspace, one cell per
	// UTC day over the last 13 weeks.

	let events = $state<StudyEvent[]>([]);
	let loading = $state(true);
	let error = $state('');
	let noWorkspace = $state(false);

	// Guards against a slow earlier request overwriting a newer view.
	let requestSeq = 0;

	const workspaceId = $derived($workspaces.current?.id ?? null);

	const byDay = $derived(activityByDay(events, new Date()));
	const days = $derived([...byDay.values()]);
	const cells = $derived(
		days.map((day) => ({
			day: day.day,
			title: dayTooltip(day),
			level: levelFor(day.total)
		}))
	);
	const windowTotal = $derived(days.reduce((sum, day) => sum + day.total, 0));
	const summary = $derived(windowSummary(byDay));
	const weeks = Math.round(HEATMAP_DAYS / 7);
	const status = $derived<WidgetStatus>(
		noWorkspace ? 'no-workspace' : loading ? 'loading' : error ? 'error' : 'ready'
	);

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	async function load(workspace: number | null): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		error = '';
		noWorkspace = false;

		if (workspace === null) {
			events = [];
			noWorkspace = true;
			loading = false;
			return;
		}

		try {
			// Only the window: `since` is an inclusive bound, and older
			// events would be dropped by activityByDay anyway.
			const since = encodeURIComponent(windowStart().toISOString());
			const all = await api<StudyEvent[]>(
				`/api/events?since=${since}&workspace=${workspace}`
			);
			if (seq !== requestSeq) return;
			events = all.filter((event) => event.workspaceId === workspace);
		} catch (err) {
			if (seq !== requestSeq) return;
			events = [];
			error = message(err, 'Could not load your activity.');
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	// Refetch when the active workspace changes; the header switcher makes
	// that possible without leaving home.
	$effect(() => {
		void load(workspaceId);
	});
</script>

<WidgetCard
	title="Activity"
	headingId="activity-heading"
	{status}
	noWorkspaceText="Choose a workspace in the header to see your activity."
	loadingText="Loading activity…"
	{error}
	onretry={() => void load(workspaceId)}
>
	<div class="grid" role="img" aria-label={summary}>
		{#each cells as cell (cell.day)}
			<span class="cell level-{cell.level}" title={cell.title}></span>
		{/each}
	</div>

	<footer class="legend">
		<span>
			{#if windowTotal === 0}
				No activity in the last {weeks} weeks yet
			{:else}
				{windowTotal}
				{windowTotal === 1 ? 'point' : 'points'} in the last {weeks} weeks
			{/if}
		</span>
		<span class="scale" aria-hidden="true">
			Less
			{#each [0, 1, 2, 3, 4] as level (level)}
				<span class="cell level-{level}"></span>
			{/each}
			More
		</span>
	</footer>
</WidgetCard>

<style>
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
</style>
