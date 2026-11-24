<script lang="ts">
	// Reviews per day (core, Stats → Overview, also selectable for Home):
	// one bar for each of the last 30 learner days, today emphasised. The
	// bars are decorative; the visible summary and a visually hidden list
	// carry every number (design §9, "never colour alone").
	import { featureEnabled, FLASHCARDS_ID } from '$lib/features';
	import { t } from '$lib/i18n';
	import { formatDay } from '$lib/i18n/format';
	import { errorText } from '$lib/api/apiErrors';
	import { reviewsPerDay, type ReviewDay } from '$lib/stats/summary';
	import { contextForData, onContextStale } from '$lib/study/currentContext';
	import { ALL_WORKSPACES, onStudyChange, loadStudyHistory } from '$lib/study/data';
	import WidgetCard from './WidgetCard.svelte';
	import type { WidgetStatus } from './types';
	import { useSession } from '$lib/context/context';


	const session = useSession();

	let series = $state.raw<ReviewDay[] | null>(null);
	let loading = $state(true);
	let error = $state('');
	let noWorkspace = $state(false);

	let requestSeq = 0;

	const workspaceId = $derived(session.workspaces.current?.id ?? null);
	// Before the states are known the feature counts as on (no flash of the note).
	const flashcardsOn = $derived(
		session.plugins.status === 'ready'
			? featureEnabled(FLASHCARDS_ID, session.plugins.list)
			: true
	);
	const total = $derived(series?.reduce((sum, day) => sum + day.count, 0) ?? 0);
	const todayCount = $derived(series?.find((day) => day.today)?.count ?? 0);
	const busiest = $derived(series?.reduce((max, day) => Math.max(max, day.count), 0) ?? 0);
	const withReviews = $derived(series?.filter((day) => day.count > 0) ?? []);
	const emptyText = $derived(
		flashcardsOn ? t('widgets.reviewsPerDay.empty') : t('stats.summary.noFlashcards')
	);
	const status = $derived<WidgetStatus>(
		noWorkspace
			? 'no-workspace'
			: !flashcardsOn
				? 'empty'
				: loading
					? 'loading'
					: error
						? 'error'
						: series !== null && total === 0
							? 'empty'
							: 'ready'
	);

	function dayText(day: ReviewDay): string {
		const date = formatDay(day.day, { day: 'numeric', month: 'short' });
		const text = t('stats.reviewsPerDay.day', { day: date, count: day.count });
		return day.today ? `${text}, ${t('stats.reviewsPerDay.today')}` : text;
	}

	function height(day: ReviewDay): string {
		return `${busiest === 0 ? 0 : (day.count / busiest) * 100}%`;
	}

	async function load(workspace: number | null, force = false): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		error = '';
		noWorkspace = false;

		if (workspace === null) {
			series = null;
			noWorkspace = true;
			loading = false;
			return;
		}

		try {
			const data = await loadStudyHistory(session.study, workspace, { force });
			if (seq !== requestSeq) return;
			const ctx = contextForData(session.zone, data, workspace);
			series = reviewsPerDay({
				workspaceId: workspace,
				now: Date.now(),
				day: ctx.day,
				reviews: data.reviews
			});
		} catch (err) {
			if (seq !== requestSeq) return;
			series = null;
			error = errorText(err, t('widgets.reviewsPerDay.loadFailed'));
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	$effect(() => {
		if (!flashcardsOn) {
			// Switching the feature off drops the chart at once; no reviews
			// can be made, so the historical counts are not shown.
			requestSeq += 1;
			series = null;
			loading = false;
			noWorkspace = workspaceId === null;
			return;
		}
		void load(workspaceId);
	});
	$effect(() => onContextStale(session.zone, () => void load(workspaceId)));

	// A posted review or a study-data write changes the chart; the history
	// cache is dropped by both. Only this workspace (or all) triggers a load.
	$effect(() => {
		const id = workspaceId;
		const again = (touched: number): void => {
			if (id !== null && (touched === id || touched === ALL_WORKSPACES)) void load(id);
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
	title={t('widgets.reviewsPerDay.title')}
	headingId="reviews-per-day-heading"
	{status}
	{error}
	onretry={() => void load(workspaceId, true)}
	{emptyText}
>
	{#if series !== null}
		<p class="summary">{t('stats.reviewsPerDay.summary', { total, today: todayCount })}</p>

		<div class="chart" aria-hidden="true">
			{#each series as day (day.day)}
				<div class="column" data-day={day.day} title={dayText(day)}>
					{#if day.count > 0}
						<span class="bar" class:today={day.today} style:height={height(day)}></span>
					{/if}
				</div>
			{/each}
		</div>
		<div class="axis" aria-hidden="true">
			<span>{formatDay(series[0].day, { day: 'numeric', month: 'short' })}</span>
			<span>{formatDay(series[Math.floor(series.length / 2)].day, { day: 'numeric', month: 'short' })}</span>
			<span>{formatDay(series[series.length - 1].day, { day: 'numeric', month: 'short' })}</span>
		</div>

		<ul class="sr-only">
			{#each withReviews as day (day.day)}
				<li>{dayText(day)}</li>
			{/each}
		</ul>
	{/if}
</WidgetCard>

<style>
	.summary {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.chart {
		display: grid;
		grid-template-columns: repeat(30, minmax(0, 1fr));
		gap: 3px;
		align-items: end;
		height: 110px;
		margin-top: var(--space-2);
		box-shadow: inset 0 -1px 0 var(--hair);
	}

	.column {
		display: flex;
		align-items: flex-end;
		height: 100%;
		min-width: 0;
	}

	.bar {
		width: 100%;
		min-height: 2px;
		border-radius: 2px 2px 0 0;
		background: var(--accent-58);
	}

	.bar.today {
		background: var(--accent-100);
	}

	.axis {
		display: flex;
		justify-content: space-between;
		margin-top: var(--space-1);
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	@media (max-width: 719px) {
		.chart {
			height: 80px;
			gap: 2px;
		}
	}

	@media (forced-colors: active) {
		.bar {
			background: CanvasText;
		}
		.bar.today {
			outline: 2px solid Highlight;
			outline-offset: 1px;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
