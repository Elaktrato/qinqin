<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { errorMessage } from '$lib/stats/errors';
	import { t } from '$lib/i18n';
	import { activityLabel } from '$lib/plugins/manifestText';
	import { fetchActivity, type ActivityResponse } from '$lib/api/stats';
	import {
		HEATMAP_DAYS,
		dayTooltip,
		foldRange,
		levelFor,
		sourcePoints,
		stageName,
		vacationMarksRange,
		windowStart,
		windowSummary,
		type DayActivity
	} from '$lib/activity/activity';
	import type { HeatCell } from '$lib/activity/cells';
	import HeatmapGarden from '$lib/activity/HeatmapGarden.svelte';
	import HeatmapMonth from '$lib/activity/HeatmapMonth.svelte';
	import HeatmapWeek from '$lib/activity/HeatmapWeek.svelte';
	import { earliestMonth, monthOf, monthWindow, nextMonth, prevMonth, weekDays, windowMonth, type Month } from '$lib/activity/calendar';
	import { toGoText } from '$lib/goals/goalText';
	import { stageAmounts, stagesFor, type DayStage } from '$lib/activity/stages';
	import type { GoalsRow } from '$lib/goals/goals';
	import { formatNumber } from '$lib/i18n/format';
	import { loadStudyHistory } from '$lib/study/history';
	import type { ReviewEvent } from '$lib/study/types';
	import { vacationRuns } from '$lib/study/vacation';
	import type { HeatmapLayout } from '$lib/widgets/options';
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
	// `layout` picks the drawing (design §9 "Home"): the garden grid (the
	// default, and Stats), the month calendar or this week. In This workspace
	// with a daily goal each day also has a flower stage, shown as text
	// (tooltip, list) until the drawings exist (#107); tiles are tint-only.
	//
	// A failed request shows a clear message with "Try again"; once data
	// is on screen a failed background refresh keeps it. There is no
	// client-side scoring fallback: the rules live in plugin manifests.

	interface Props {
		layout?: HeatmapLayout;
	}
	let { layout = 'garden' }: Props = $props();

	let response = $state<ActivityResponse | null>(null);
	// The window `response` covers (learner days, inclusive).
	let range = $state({ from: '', to: '' });
	// The month calendar's page (the one requested; `range` says which is on screen).
	let month = $state(monthOf(currentStudyDay().today(Date.now())));
	let prefs = $state(initialPrefs());
	let loading = $state(true);
	let error = $state('');
	// A month fetch that failed while other data is on screen (#100 review): said
	// with Try again; the month it was for is retried.
	let monthError = $state('');
	let failedMonth: Month | null = null;
	// The learner's day rule; a zone change re-folds and re-requests the window.
	let studyDay = $state.raw(currentStudyDay());
	// The user's vacation periods (user-global rows): their dates are hatched.
	let vacations = $state.raw<VacationPeriod[]>([]);
	// The current workspace's goal row and reviews (cached study history), for the
	// flower stages; null until loaded or when the load failed (tint only then).
	let goals = $state.raw<{ workspaceId: number; row: GoalsRow | null; reviews: readonly ReviewEvent[]; vacations: readonly VacationPeriod[] } | null>(null);

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
	// The learner's today: state, not derived, so a tab left open overnight moves
	// on (a minute tick, a zone change and each load set it; #100 review).
	let today = $state(untrack(() => studyDay.today(Date.now())));
	/** syncToday moves `today` to the clock's learner day; true when it changed. */
	function syncToday(): boolean {
		const now = studyDay.today(Date.now());
		if (now === today) return false;
		// The month calendar on the current month follows into the new month.
		if (month === monthOf(today)) month = monthOf(now);
		today = now;
		return true;
	}
	const TICK_MS = 60_000;
	// Nothing is folded before the first response sets the window.
	const loaded = $derived(response !== null && range.from !== '');
	const marks = $derived(
		loaded
			? vacationMarksRange(vacations, $workspaces.list.map((w) => w.id), view.workspace, range.from, range.to, today)
			: new Map()
	);
	const byDay = $derived(loaded ? foldRange(response ?? empty, view, range.from, range.to, marks) : new Map<string, DayActivity>());
	// Chip counts ignore the filter, so a hidden type shows what it would add.
	const chipPoints = $derived(
		sourcePoints(loaded ? foldRange(response ?? empty, { ...view, hidden: [] }, range.from, range.to, marks) : new Map())
	);
	const allHidden = $derived(sources.length > 0 && sources.every((s) => stored.hidden.includes(s.type)));
	const days = $derived([...byDay.values()]);
	// Flower stages: one workspace with a goal row; every type counts toward the goal, whatever the chips hide.
	const stages = $derived.by((): Map<string, DayStage | null> => {
		if (scope !== 'workspace' || workspaceId === null || response === null || !loaded) return new Map();
		if (goals === null || goals.workspaceId !== workspaceId || goals.row === null) return new Map();
		const units = response.sources;
		return stagesFor({
			row: goals.row,
			from: range.from,
			to: range.to,
			today,
			amountsOf: stageAmounts(response.cells, workspaceId, goals.reviews, studyDay.dayOf),
			vacation: vacationRuns(goals.vacations, workspaceId, today),
			unitOf: (type) => units.find((s) => s.type === type)?.unit ?? null
		});
	});

	function amountText(day: DayActivity, stage: DayStage | null): string {
		if (stage === null) return formatNumber(day.total);
		if (stage.stage === 'resting') return stageName('resting');
		return `${formatNumber(stage.amount)}/${formatNumber(stage.target)}`;
	}

	const cells = $derived(
		days.map((day): HeatCell => {
			const stage = stages.get(day.day) ?? null;
			const isToday = day.day === today;
			return {
				day: day.day,
				label: dayTooltip(day, sources, workspaceName, allHidden, { stage, today: isToday }),
				level: levelFor(day.total),
				vacation: day.vacation !== null,
				today: isToday,
				future: false,
				stage,
				amountText: amountText(day, stage)
			};
		})
	);
	const windowTotal = $derived(days.reduce((sum, day) => sum + day.total, 0));
	const summary = $derived(windowSummary(byDay, sources, scope));
	const weeks = Math.round(HEATMAP_DAYS / 7);
	// Content (and the scope switch) appears only once data and view are both in.
	const status = $derived<WidgetStatus>(
		heatmapStatus({ hasData: response !== null, loading, prefsLoaded: prefs.loaded })
	);

	/** The window the layout needs: 13 weeks, or one month (never past today). */
	function wanted(now: Date): { from: string; to: string } {
		const day = studyDay.today(now.getTime());
		if (layout === 'month') return monthWindow(month, day);
		return { from: windowStart(studyDay, now), to: day };
	}

	// This week: Monday..Sunday from the 13-week window (no request of its own).
	const weekCells = $derived.by((): HeatCell[] => {
		const byDay = new Map(cells.map((cell) => [cell.day, cell]));
		return weekDays(today).map(
			({ day, future }) =>
				byDay.get(day) ?? { day, level: 0, vacation: false, today: false, future, label: '', stage: null, amountText: '' }
		);
	});
	const weekSummary = $derived.by((): string => {
		const stage = stages.get(today) ?? null;
		if (stage !== null) {
			if (stage.status === 'met') return t('goals.status.reached');
			if (stage.status === 'vacation') return t('goals.status.vacation');
			const left = toGoText(stage, sources);
			if (left !== null) return left;
		}
		const points = weekCells.reduce((sum, cell) => sum + (byDay.get(cell.day)?.total ?? 0), 0);
		return t('widgets.activity.week.points', { count: points });
	});

	// The month the loaded window is, or null while the 13-week window is loaded
	// (the month calendar never draws that one).
	const shownMonth = $derived(windowMonth(range));

	// Month paging: back to the activity route's 366-day cap, never past the current month.
	const canPrev = $derived(month > earliestMonth(today));
	const canNext = $derived(month < monthOf(today));
	function page(next: string): void {
		month = next;
		void load(false);
	}

	/** "Goal reached on 2 of 6 days": past goal days (and today once met), vacation days left out; null with none. */
	const goalSummary = $derived.by((): string | null => {
		let total = 0;
		let met = 0;
		for (const cell of cells) {
			if (cell.stage === null || cell.stage.status === 'vacation') continue;
			if (cell.day === today && cell.stage.status !== 'met') continue;
			total++;
			if (cell.stage.status === 'met') met++;
		}
		// No countable day yet (a goal set today, or only vacation): no line, never "0 of 0 days".
		return total === 0 ? null : t('widgets.activity.month.goalDays', { count: total, met });
	});

	/** load requests the layout's window; without `force` an already loaded window is kept. */
	async function load(force = true): Promise<void> {
		syncToday();
		const now = new Date();
		const next = wanted(now);
		if (!force && response !== null && next.from === range.from && next.to === range.to) return;
		const seq = requests.next();
		error = '';
		if (response === null) loading = true;
		try {
			const got = await fetchActivity(next.from, next.to);
			if (!requests.isCurrent(seq)) return;
			response = got;
			range = next;
			monthError = '';
			void loadVacations();
			void loadGoals();
		} catch (err) {
			if (!requests.isCurrent(seq)) return;
			if (response === null) error = errorMessage(err, t('stats.activity.loadFailed'));
			else if (layout === 'month' && (next.from !== range.from || next.to !== range.to)) {
				// A new month (not a refresh of the one on screen) did not load.
				monthError = t('widgets.activity.month.loadFailed');
				console.warn('activity month not loaded', err);
				failedMonth = month;
			} else console.warn('activity refresh failed', err);
		} finally {
			if (requests.isCurrent(seq)) loading = false;
		}
	}

	async function loadVacations(): Promise<void> {
		if (workspaceId === null) {
			vacations = [];
			return;
		}
		const id = workspaceId;
		try {
			const got = (await getStudyData(id)).vacations ?? [];
			if (id === workspaceId) vacations = got;
		} catch {
			// The marks are decoration: the heatmap works without them.
		}
	}

	async function loadGoals(): Promise<void> {
		const id = workspaceId;
		if (id === null) {
			goals = null;
			return;
		}
		try {
			const history = await loadStudyHistory(id);
			// A slower load for the workspace switched away from never wins.
			if (id !== workspaceId) return;
			const row = history.goals === undefined || history.goals === 'newer' ? null : history.goals;
			goals = { workspaceId: id, row, reviews: history.reviews, vacations: history.vacations ?? [] };
		} catch {
			// The stage is decoration until the drawings exist: tint only.
			if (id === workspaceId) goals = null;
		}
	}

	function remember(next: StoredActivityView): void {
		prefs = prefsChanged(prefs, next);
		void saves.push(next);
	}

	// The first load, and again when the layout changes (Home learns it after mount).
	$effect(() => {
		void layout;
		untrack(() => void load(false));
	});

	// A workspace switch: its goal row and vacations (the activity itself is
	// one request for every workspace and stays). Skipped until the first load.
	$effect(() => {
		void workspaceId;
		untrack(() => {
			if (response === null) return;
			void loadVacations();
			void loadGoals();
		});
	});

	onMount(() => {
		void loadActivityView().then((view) => (prefs = prefsLoaded(prefs, view)));
		const offEvents = onEventLogChange(() => void load());
		const offZone = onStudyDayChange((next) => {
			studyDay = next;
			void load();
		});
		// The learner day turns at midnight in their zone: re-request the window then.
		const tick = setInterval(() => {
			if (syncToday()) void load();
		}, TICK_MS);
		return () => {
			clearInterval(tick);
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
					aria-label={chipLabel(activityLabel(source), chipPoints[source.type] ?? 0)}
					onclick={() => remember({ ...stored, hidden: toggleHidden(stored.hidden, source.type) })}
				>
					{activityLabel(source)}
					<span class="count">{chipPoints[source.type] ?? 0}</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- The coloured tiles are for sighted users (tooltips via title); assistive
	     tech gets the window summary and one list item per day with activity
	     or a flower stage (HeatmapDayList). -->
	<div class="heatmap">
		{#if layout === 'month'}
			{#if monthError}
				<p class="month-error" role="status">
					{monthError}
					<button type="button" class="retry" onclick={() => page(failedMonth ?? month)}>{t('common.action.retry')}</button>
				</p>
			{/if}
			{#if shownMonth !== null}
				<HeatmapMonth
					month={shownMonth}
					{today}
					{cells}
					{canPrev}
					{canNext}
					onprev={() => page(prevMonth(month))}
					onnext={() => page(nextMonth(month))}
					summary={goalSummary}
				/>
			{:else if !monthError}
				<p class="month-loading" aria-live="polite">{t('stats.activity.loading')}</p>
			{/if}
		{:else if layout === 'week'}
			<HeatmapWeek cells={weekCells} summary={weekSummary} />
		{:else}
			<HeatmapGarden {cells} />
			<p class="visually-hidden">{summary}</p>
		{/if}
	</div>

	<footer class="legend">
		<span>
			{#if layout !== 'garden'}
				<!-- The month and the week have their own summary line. -->
			{:else if allHidden}
				{t('stats.activity.allHidden')}
			{:else if windowTotal === 0}
				{t('stats.activity.noneYet', { weeks })}
			{:else}
				{t('stats.activity.pointsInWindow', { count: windowTotal, weeks })}
			{/if}
		</span>
		<span class="scale heatmap" aria-hidden="true">
			{t('stats.activity.less')}
			{#each [0, 1, 2, 3, 4] as level (level)}
				<span class="tile level-{level}"></span>
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
		color: var(--readable-muted);
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
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}

	.chip:focus-visible,
	.scope input:focus-visible {
		outline: 2px solid var(--focus-colour);
		outline-offset: 2px;
	}

	.count {
		margin-left: 0.3rem;
		color: var(--readable-muted);
		font-variant-numeric: tabular-nums;
	}

	/* On the accent fill the count takes the chip's --on-accent. */
	.chip[aria-pressed='true'] .count {
		color: inherit;
	}

	/* The tiles of every layout (design §6 heatmap tint; tint only until the
	   flower drawings exist, #107). Never colour alone: level, stage and today
	   are in the tooltip and the list. Level 0 is an empty box: the page's
	   --panel inside a --hair ring (on --raised it matched level 1 in several
	   themes and fell below 3:1 against level 4 in Solarized Dark; #100
	   review, ActivityHeatmap.contrast.test.ts). Levels 1–4 are ring-less fills. */
	.heatmap :global(.tile) {
		box-sizing: border-box;
		border-radius: calc(var(--radius) * 0.3);
		background: var(--panel);
		box-shadow: inset 0 0 0 1px var(--hair);
	}

	.heatmap :global(.tile.level-1) {
		background: var(--accent-14);
		box-shadow: none;
	}

	.heatmap :global(.tile.level-2) {
		background: var(--accent-32);
		box-shadow: none;
	}

	.heatmap :global(.tile.level-3) {
		background: var(--accent-58);
		box-shadow: none;
	}

	.heatmap :global(.tile.level-4) {
		background: var(--accent-100);
		box-shadow: none;
	}

	/* Hatched: a vacation day (the pattern also works without colour). */
	.heatmap :global(.tile.vacation) {
		background-image: repeating-linear-gradient(45deg, var(--line) 0 2px, transparent 2px 5px);
	}

	/* Today: a --panel gap inside an accent ring, so the ring shows on the
	   accent-filled level-4 tile too (#100 review). */
	.heatmap :global(.tile.today) {
		box-shadow: 0 0 0 1.5px var(--panel), 0 0 0 3px var(--accent);
	}

	/* A day still to come: a dashed outline, so it never reads as an empty past day. */
	.heatmap :global(.tile.future) {
		background: transparent;
		box-shadow: none;
		outline: 1px dashed var(--hair);
		outline-offset: -1px;
	}

	@media (forced-colors: active) {
		.heatmap :global(.tile) {
			outline: 1px solid CanvasText;
			outline-offset: -1px;
		}

		.heatmap :global(.tile.today) {
			outline: 2px solid Highlight;
			outline-offset: 1px;
		}
	}

	.month-error,
	.month-loading {
		margin: var(--space-4) 0 0;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.retry {
		font: inherit;
		min-height: 2.75rem;
		margin-left: var(--space-2);
		padding: 0.3rem 0.85rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}

	.retry:focus-visible {
		outline: 2px solid var(--focus-colour);
		outline-offset: 2px;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		margin-top: 0.75rem;
		font-size: 0.8rem;
		color: var(--readable-muted);
	}

	.scale {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}

	.scale .tile {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
	}
</style>
