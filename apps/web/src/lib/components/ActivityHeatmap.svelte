<script lang="ts">
	import { onMount } from 'svelte';
	import { errorMessage } from '$lib/stats/errors';
	import { fetchActivity, type ActivityResponse } from '$lib/api/stats';
	import {
		HEATMAP_DAYS,
		dayKey,
		dayTooltip,
		foldActivity,
		levelFor,
		sourcePoints,
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
	import { workspaceDisplay } from '$lib/languages';
	import WidgetCard from '$lib/widgets/WidgetCard.svelte';
	import type { WidgetStatus } from '$lib/widgets/types';
	import { workspaces } from '$lib/workspaces';

	// The core home heatmap: the server-aggregated activity (one request
	// for every workspace and type), folded here per scope and filter, one
	// cell per UTC day over the last 13 weeks. The view (scope, hidden
	// types) is remembered per user.
	//
	// A failed request shows a clear message with "Try again"; once data
	// is on screen a failed background refresh keeps it. There is no
	// client-side scoring fallback: the rules live in plugin manifests.

	let response = $state<ActivityResponse | null>(null);
	let prefs = $state(initialPrefs());
	let loading = $state(true);
	let error = $state('');

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
		if (!ws) return `Workspace ${id}`;
		const display = workspaceDisplay($workspaces.list, ws);
		return display.showName ? display.name : display.label;
	}

	const empty = { from: '', to: '', sources: [], cells: [] } satisfies ActivityResponse;
	const byDay = $derived(foldActivity(response ?? empty, view, new Date()));
	// Chip counts ignore the filter, so a hidden type shows what it would add.
	const chipPoints = $derived(
		sourcePoints(foldActivity(response ?? empty, { ...view, hidden: [] }, new Date()))
	);
	const allHidden = $derived(sources.length > 0 && sources.every((s) => stored.hidden.includes(s.type)));
	const days = $derived([...byDay.values()]);
	const cells = $derived(
		days.map((day) => ({
			day: day.day,
			title: dayTooltip(day, sources, workspaceName, allHidden),
			level: levelFor(day.total)
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
			const next = await fetchActivity(dayKey(windowStart(now)), dayKey(now));
			if (!requests.isCurrent(seq)) return;
			response = next;
		} catch (err) {
			if (!requests.isCurrent(seq)) return;
			if (response === null) error = errorMessage(err, 'Could not load your activity.');
			else console.warn('activity refresh failed', err);
		} finally {
			if (requests.isCurrent(seq)) loading = false;
		}
	}

	function remember(next: StoredActivityView): void {
		prefs = prefsChanged(prefs, next);
		void saves.push(next);
	}

	onMount(() => {
		void load();
		void loadActivityView().then((view) => (prefs = prefsLoaded(prefs, view)));
		return onEventLogChange(() => void load());
	});
</script>

<WidgetCard
	title="Activity"
	headingId="activity-heading"
	{status}
	loadingText="Loading activity…"
	{error}
	onretry={() => void load()}
>
	{#snippet actions()}
		{#if status === 'ready'}
		<fieldset class="scope">
			<legend class="sr-only">Show activity for</legend>
			<label class:disabled={workspaceId === null}>
				<input
					type="radio"
					name="activity-scope"
					value="workspace"
					checked={scope === 'workspace'}
					disabled={workspaceId === null}
					onchange={() => remember({ ...stored, scope: 'workspace' })}
				/>
				This workspace
			</label>
			<label>
				<input
					type="radio"
					name="activity-scope"
					value="all"
					checked={scope === 'all'}
					onchange={() => remember({ ...stored, scope: 'all' })}
				/>
				All workspaces
			</label>
		</fieldset>
		{/if}
	{/snippet}

	{#if sources.length > 0}
		<div class="chips" role="group" aria-label="Activity types">
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

	<div class="grid" role="img" aria-label={summary}>
		{#each cells as cell (cell.day)}
			<span class="cell level-{cell.level}" title={cell.title}></span>
		{/each}
	</div>

	<footer class="legend">
		<span>
			{#if allHidden}
				All activity types are hidden.
			{:else if windowTotal === 0}
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
