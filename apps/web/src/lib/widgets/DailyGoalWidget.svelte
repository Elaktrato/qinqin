<script lang="ts">
	// Home and Stats: today's progress towards the workspace's daily goal and
	// the goal streak. All logic lives in lib/goals (loadGoal.ts is the load).
	import GoalRing from '$lib/goals/GoalRing.svelte';
	import { streakText } from '$lib/goals/goalText';
	import { loadGoalStatus, type GoalView } from '$lib/goals/loadGoal';
	import { onContextStale } from '$lib/study/currentContext';
	import { errorMessage } from '$lib/stats/errors';
	import { workspaces } from '$lib/workspaces';
	import WidgetCard from './WidgetCard.svelte';
	import type { WidgetStatus } from './types';

	const SETTINGS = '/settings?tab=study';

	let goal = $state.raw<GoalView | null>(null);
	let loading = $state(true);
	let error = $state('');
	// Guards against a slow earlier request overwriting a newer view.
	let requestSeq = 0;

	const workspaceId = $derived($workspaces.current?.id ?? null);
	const status = $derived<WidgetStatus>(
		workspaceId === null ? 'no-workspace' : loading ? 'loading' : error ? 'error' : 'ready'
	);
	const hasGoal = $derived(goal !== null && (goal.today.status !== 'none' || goal.today.unavailable));

	async function load(workspace: number | null, force = false): Promise<void> {
		const seq = ++requestSeq;
		error = '';
		if (workspace === null) {
			goal = null;
			loading = false;
			return;
		}
		loading = true;
		try {
			const next = await loadGoalStatus(workspace, { force });
			if (seq !== requestSeq) return;
			goal = next;
		} catch (err) {
			if (seq !== requestSeq) return;
			goal = null;
			error = errorMessage(err, 'Could not load your daily goal.');
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	$effect(() => {
		void load(workspaceId);
	});
	$effect(() => onContextStale(() => void load(workspaceId)));
</script>

<WidgetCard
	title="Daily goal"
	headingId="daily-goal-heading"
	{status}
	noWorkspaceText="Choose a workspace in the header to set a daily goal."
	loadingText="Loading your daily goal…"
	{error}
	onretry={() => void load(workspaceId, true)}
>
	{#snippet actions()}
		{#if hasGoal}<a class="edit" href={SETTINGS}>Edit goal</a>{/if}
	{/snippet}

	{#if goal !== null}
		{#if goal.newer}
			<p class="hint">Your daily goal was set by a newer version of qinqin; update this app to see it.</p>
		{:else if !hasGoal}
			<p class="hint">Pick what to aim for each day: reviews, new cards or minutes.</p>
			<a class="set" href={SETTINGS}>Set a daily goal</a>
		{:else}
			<div class="body">
				<GoalRing day={goal.today} sources={goal.sources} />
				{#if goal.streak !== null}
					<p class="streak">{streakText(goal.streak)}</p>
				{/if}
			</div>
		{/if}
	{/if}
</WidgetCard>

<style>
	.body {
		margin-top: 0.9rem;
		display: grid;
		gap: 0.6rem;
	}

	.hint {
		margin: 0.9rem 0 0.5rem;
		font-size: 0.9rem;
		opacity: 0.8;
	}

	.streak {
		margin: 0;
		font-size: 0.85rem;
	}

	.edit,
	.set {
		font-size: 0.8rem;
		padding: 0.2rem 0.65rem;
		border: 1px solid #0b6bcb;
		border-radius: 999px;
		color: #0b6bcb;
		font-weight: 600;
		text-decoration: none;
	}

	.set {
		display: inline-block;
	}

	@media (prefers-color-scheme: dark) {
		.edit,
		.set {
			border-color: #6cb4ff;
			color: #6cb4ff;
		}
	}
</style>
