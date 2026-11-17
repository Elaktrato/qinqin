<script lang="ts">
	import { onMount } from 'svelte';
	import { errorMessage } from '$lib/stats/errors';
	import { t } from '$lib/i18n';
	import { fetchActivity, type ActivityResponse } from '$lib/api/stats';
	import {
		HEATMAP_DAYS,
		dayTooltip,
		foldActivity,
		levelFor,
		sourcePoints,
		vacationMarks,
		windowStart,
		windowSummary
	} from '$lib/activity/activity';
	import {
		activityViewFor,
		chipLabel,
		createSaveQueue,
		createSequencer,
		effectiveScope,
		heatmapStatus,
		initialPrefs,
		prefsChanged,
		prefsLoaded,
		toggleHidden
	} from '$lib/activity/heatmapState';
	import {
		loadActivityView,
		saveActivityView,
		type StoredActivityView
	} from '$lib/activity/viewPrefs';
	import { onEventLogChange } from '$lib/events';
	import { getStudyData } from '$lib/study/studyData';
	import type { VacationPeriod } from '$lib/study/vacation';
	import { workspaceDisplay } from '$lib/languages';
	import { currentStudyDay, onStudyDayChange } from '$lib/time/zone';
	import WidgetCard from '$lib/widgets/WidgetCard.svelte';
	import type { WidgetStatus } from '$lib/widgets/types';
	import { workspaces } from '$lib/workspaces';

	// The core home heatmap: the server-aggregated activity (one request
	// for every workspace and type), folded here per scope and filter, one
	// cell per learner day (the user's time zone, lib/time/studyDay.ts) over the last 13 weeks. The view (scope, hidden
	// types) is remembered per user.
	//
	// A failed request shows a clear message with "Try again"; once data
	// is on screen a failed background refresh keeps it. There is no
	// client-side scoring fallback: the rules live in plugin manifests.

	let response = $state<ActivityResponse | null>(null);
	let prefs = $state(initialPrefs());
	let loading = $state(true);
	let error = $state('');
	// The learner's day rule; a zone change re-folds and re-requests the window.
	let studyDay = $state.raw(currentStudyDay());
	// The user's vacation periods (user-global rows): their dates are hatched.
	let vacations = $state.raw<VacationPeriod[]>([]);

	// Guards against a slow earlier request overwriting a newer view.
	const requests = createSequencer();
	// Saves run one at a time; the last change wins.
	const saves = createSaveQueue(saveActivityView, (err) =>
		console.warn('activity view not saved', err)
	);

	const stored = $derived(prefs.stored);

	const workspaceId = $derived($workspaces.current?.id ?? null);
	const scope = $derived(effectiveScope(stored.scope, workspaceId !== null));
	const view = $derived(activityViewFor(stored, workspaceId));
	const sources = $derived(response?.sources ?? []);

	// A workspace no longer in the store still counts, under a fallback name.
	function workspaceName(id: number): string {
		const ws = $workspaces.list.find((w) => w.id === id);
		if (!ws) return t('stats.activity.workspaceN', { id });
		const display = workspaceDisplay($workspaces.list, ws);
		return display.showName ? display.name : display.label;
	}

	const empty = { from: '', to: '', timeZone: 'UTC', sources: [], cells: [] } satisfies ActivityResponse;
	const marks = $derived(
		vacationMarks(vacations, $workspaces.list.map((w) => w.id), view.workspace, studyDay, new Date())
	);
	const byDay = $derived(foldActivity(response ?? empty, view, studyDay, new Date(), undefined, marks));
	// Chip counts ignore the filter, so a hidden type shows what it would add.
	const chipPoints = $derived(
		sourcePoints(foldActivity(response ?? empty, { ...view, hidden: [] }, studyDay, new Date(), undefined, marks))
	);
	const allHidden = $derived(sources.length > 0 && sources.every((s) => stored.hidden.includes(s.type)));
	const days = $derived([...byDay.values()]);
	const cells = $derived(
		days.map((day) => ({
			day: day.day,
			title: dayTooltip(day, sources, workspaceName, allHidden),
			level: levelFor(day.total),
			vacation: day.vacation !== null
		}))
	);
	const windowTotal = $derived(days.reduce((sum, day) => sum + day.total, 0));
	const summary = $derived(windowSummary(byDay, sources, scope));
	const weeks = Math.round(HEATMAP_DAYS / 7);
	// Content (and the scope switch) appears only once data and view are both in.
	const status = $derived<WidgetStatus>(
		heatmapStatus({ hasData: response !== null, loading, prefsLoaded: prefs.loaded })
	);

	async function load(): Promise<void> {
		const seq = requests.next();
		error = '';
		if (response === null) loading = true;
		try {
			const now = new Date();
			const rule = studyDay;
			const next = await fetchActivity(windowStart(rule, now), rule.today(now.getTime()));
			if (!requests.isCurrent(seq)) return;
			response = next;
			void loadVacations();
		} catch (err) {
			if (!requests.isCurrent(seq)) return;
			if (response === null) error = errorMessage(err, t('stats.activity.loadFailed'));
			else console.warn('activity refresh failed', err);
		} finally {
			if (requests.isCurrent(seq)) loading = false;
		}
	}

	async function loadVacations(): Promise<void> {
		if (workspaceId === null) {
			vacations = [];
			return;
		}
		try {
			vacations = (await getStudyData(workspaceId)).vacations ?? [];
		} catch {
			// The marks are decoration: the heatmap works without them.
		}
	}

	function remember(next: StoredActivityView): void {
		prefs = prefsChanged(prefs, next);
		void saves.push(next);
	}

	onMount(() => {
		void load();
		void loadActivityView().then((view) => (prefs = prefsLoaded(prefs, view)));
		const offEvents = onEventLogChange(() => void load());
		const offZone = onStudyDayChange((next) => {
			studyDay = next;
			void load();
		});
		return () => {
			offEvents();
			offZone();
		};
	});
</script>

<WidgetCard
	title={t('widgets.activity.title')}
	headingId="activity-heading"
	{status}
	loadingText={t('stats.activity.loading')}
	{error}
	onretry={() => void load()}
>
	{#snippet actions()}
		{#if status === 'ready'}
		<fieldset class="scope">
			<legend class="sr-only">{t('stats.activity.showFor')}</legend>
			<label class:disabled={workspaceId === null}>
				<input
					type="radio"
					name="activity-scope"
					value="workspace"
					checked={scope === 'workspace'}
					disabled={workspaceId === null}
					onchange={() => remember({ ...stored, scope: 'workspace' })}
				/>
				{t('stats.activity.thisWorkspace')}
			</label>
			<label>
				<input
					type="radio"
					name="activity-scope"
					value="all"
					checked={scope === 'all'}
					onchange={() => remember({ ...stored, scope: 'all' })}
				/>
				{t('stats.activity.allWorkspaces')}
			</label>
		</fieldset>
		{/if}
	{/snippet}

	{#if sources.length > 0}
		<div class="chips" role="group" aria-label={t('stats.activity.types')}>
			{#each sources as source (source.type)}
				<button
					type="button"
					class="chip"
					aria-pressed={!stored.hidden.includes(source.type)}
					aria-label={chipLabel(source.label, chipPoints[source.type] ?? 0)}
					onclick={() => remember({ ...stored, hidden: toggleHidden(stored.hidden, source.type) })}
				>
					{source.label}
					<span class="count">{chipPoints[source.type] ?? 0}</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- The coloured grid is for sighted users (tooltips via title); assistive
	     tech gets the window summary and one list item per day with activity. -->
	<div class="grid" aria-hidden="true">
		{#each cells as cell (cell.day)}
			<span class="cell level-{cell.level}" class:vacation={cell.vacation} title={cell.title}></span>
		{/each}
	</div>
	<p class="visually-hidden">{summary}</p>
	<ul class="visually-hidden" aria-label={t('stats.activity.daily')}>
		{#each cells.filter((cell) => cell.level > 0 || cell.vacation) as cell (cell.day)}
			<li>{cell.title}</li>
		{/each}
	</ul>

	<footer class="legend">
		<span>
			{#if allHidden}
				{t('stats.activity.allHidden')}
			{:else if windowTotal === 0}
				{t('stats.activity.noneYet', { weeks })}
			{:else}
				{t('stats.activity.pointsInWindow', { count: windowTotal, weeks })}
			{/if}
		</span>
		<span class="scale" aria-hidden="true">
			{t('stats.activity.less')}
			{#each [0, 1, 2, 3, 4] as level (level)}
				<span class="cell level-{level}"></span>
			{/each}
			{t('stats.activity.more')}
		</span>
	</footer>
</WidgetCard>

<style>
	.scope {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.9rem;
		margin: 0;
		padding: 0;
		border: 0;
		font-size: 0.85rem;
	}

	.scope label {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.75rem;
		cursor: pointer;
	}

	.scope label.disabled {
		color: color-mix(in srgb, currentColor 70%, transparent);
		cursor: default;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.6rem;
	}

	.chip {
		font: inherit;
		font-size: 0.85rem;
		min-height: 2.75rem;
		padding: 0.3rem 0.85rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.chip[aria-pressed='true'] {
		background: #0b6bcb;
		border-color: #0b6bcb;
		color: #fff;
	}

	.chip:focus-visible,
	.scope input:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.count {
		margin-left: 0.3rem;
		opacity: 0.8;
		font-variant-numeric: tabular-nums;
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

	/* Hatched: a vacation day (the pattern also works without colour). */
	.cell.vacation {
		background-image: repeating-linear-gradient(
			45deg,
			color-mix(in srgb, currentColor 45%, transparent) 0 2px,
			transparent 2px 5px
		);
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
