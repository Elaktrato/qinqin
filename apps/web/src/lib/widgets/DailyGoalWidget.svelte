<script lang="ts">
	// Home: today's progress towards the workspace's daily goal and
	// the goal streak. All logic lives in lib/goals (loadGoal.ts is the load).
	import GoalRing from '$lib/goals/GoalRing.svelte';
	import { t } from '$lib/i18n';
	import { streakText } from '$lib/goals/goalText';
	import { loadGoalStatus, type GoalView } from '$lib/goals/loadGoal';
	import { onContextStale } from '$lib/studycore/currentContext';
	import { errorText } from '$lib/api/apiErrors';
	import { onStudyChange, touches } from '$lib/studycore/data';
	import WidgetCard from './WidgetCard.svelte';
	import { WidgetLoad } from './widgetLoad.svelte';
	import type { WidgetStatus } from './types';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	const SETTINGS = '/settings?tab=study';

	// The last goal of this workspace shows at once on a revisit (#290).
	const shown = new WidgetLoad<GoalView>(session, 'daily-goal', session.workspaces.current?.id ?? null);
	const goal = $derived(shown.value);

	const workspaceId = $derived(session.workspaces.current?.id ?? null);
	// Offline with an activity goal today: the error line, not "no longer counted".
	const activityFailed = $derived(goal !== null && goal.activityError !== null && goal.today.unavailable);
	const status = $derived<WidgetStatus>(
		workspaceId === null
			? 'no-workspace'
			: shown.loading
				? 'loading'
				: shown.error || activityFailed
					? 'error'
					: 'ready'
	);
	const shownError = $derived(shown.error || (activityFailed ? (goal?.activityError ?? '') : ''));
	const hasGoal = $derived(goal !== null && (goal.today.status !== 'none' || goal.today.unavailable));

	async function load(workspace: number | null, force = false): Promise<void> {
		if (workspace === null) {
			shown.clear();
			return;
		}
		await shown.run(workspace, () => loadGoalStatus(session, workspace, { force }), (err) => errorText(err, t('widgets.goal.loadFailed')));
	}

	$effect(() => {
		void load(workspaceId);
	});
	$effect(() => onContextStale(session.zone, () => void load(workspaceId)));
	// A write, a refresh behind the held rows (#290) or a posted review moves the goal.
	$effect(() => {
		const id = workspaceId;
		const again = (touched: number): void => {
			if (touches(touched, id)) void load(id);
		};
		const offLog = session.events.onChange(again);
		const offWrite = onStudyChange(session.study, again);
		return () => {
			offLog();
			offWrite();
		};
	});
</script>

<WidgetCard
	title={t('widgets.goal.title')}
	headingId="daily-goal-heading"
	{status}
	noWorkspaceText={t('widgets.goal.noWorkspace')}
	loadingText={t('widgets.goal.loading')}
	error={shownError}
	stale={shown.stale}
	onretry={() => void load(workspaceId, true)}
>
	{#snippet actions()}
		{#if hasGoal}<a class="edit" href={SETTINGS}>{t('widgets.goal.edit')}</a>{/if}
	{/snippet}

	{#if goal !== null}
		{#if goal.newer}
			<p class="hint">{t('widgets.goal.newer')}</p>
		{:else if !hasGoal}
			<p class="hint">{t('widgets.goal.pick')}</p>
			<a class="set" href={SETTINGS}>{t('widgets.goal.set')}</a>
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
		color: var(--readable-muted);
	}

	.streak {
		margin: 0;
		font-size: 0.85rem;
	}

	.edit,
	.set {
		font-size: 0.8rem;
		padding: 0.2rem 0.65rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		color: var(--reading-accent);
		font-weight: 600;
		text-decoration: none;
	}

	.set {
		display: inline-block;
	}
</style>
