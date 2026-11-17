<script lang="ts">
	// Stats → Week: one week's summary of the current workspace, previous
	// weeks browsable by link (?week=<Monday>). All logic lives in
	// lib/weekly (week.ts for the URL, loadWeek.ts for the load).
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onEventLogChange } from '$lib/events';
	import { usesHan } from '$lib/languages';
	import { errorMessage } from '$lib/stats/errors';
	import { onContextStale } from '$lib/study/currentContext';
	import { ALL_WORKSPACES, onStudyWrite } from '$lib/study/store';
	import { currentStudyDay } from '$lib/time/zone';
	import { loadWeek, loadWeekCharacters, type WeekView } from '$lib/weekly/loadWeek';
	import WeekSummary from '$lib/weekly/WeekSummary.svelte';
	import {
		hasPreviousWeek,
		nextWeek,
		normalizeWeekParam,
		previousWeek,
		weekHref,
		weekRedirect
	} from '$lib/weekly/week';
	import { weekHeading, type CharactersState } from '$lib/weekly/weekText';
	import { workspaces } from '$lib/workspaces';
	import MilestoneCard from '$lib/milestones/MilestoneCard.svelte';
	import MilestoneHistory from '$lib/milestones/MilestoneHistory.svelte';
	import { loadMilestones, markSeen, type MilestonesView } from '$lib/milestones/loadMilestones';
	import { MILESTONE_TEXT } from '$lib/milestones/milestoneText';
	import type { Timelines } from '$lib/weekly/replay';
	import type { CharRow } from '$lib/api/types';
	import type { StudyCard } from '$lib/study/types';

	let now = $state(Date.now());
	let view = $state.raw<WeekView | null>(null);
	let characters = $state.raw<CharactersState>(null);
	let milestones = $state.raw<MilestonesView | null>(null);
	let loading = $state(true);
	let error = $state('');
	// Guards against a slow earlier request overwriting a newer view.
	let requestSeq = 0;

	const workspace = $derived($workspaces.current);
	const workspaceId = $derived(workspace?.id ?? null);
	const language = $derived(workspace?.language ?? '');
	const today = $derived(currentStudyDay().today(now));
	const param = $derived(page.url.searchParams.get('week'));
	const monday = $derived(normalizeWeekParam(param, today));
	const next = $derived(nextWeek(monday, today));
	// The heading names the week whose numbers are on screen: while the next
	// week loads, the old one stays (dimmed, busy) and the heading follows
	// once the new numbers are there, so the announcement matches them.
	const shownMonday = $derived(view?.summary.monday ?? monday);
	const busy = $derived(loading && view !== null);

	async function load(id: number | null, lang: string, week: string, force = false): Promise<void> {
		const seq = ++requestSeq;
		error = '';
		characters = null;
		// Another workspace's milestones never stay on screen while this one loads.
		// untrack: the load must not depend on the milestones it replaces.
		if (untrack(() => milestones !== null && milestones.workspaceId !== id)) milestones = null;
		if (id === null) {
			view = null;
			milestones = null;
			loading = false;
			return;
		}
		loading = true;
		let timelines: Timelines | undefined;
		try {
			const loaded = await loadWeek(id, week, { detail: true, force });
			if (seq !== requestSeq) return;
			view = loaded;
			timelines = loaded.timelines;
		} catch (err) {
			if (seq !== requestSeq) return;
			view = null;
			error = errorMessage(err, 'Could not load this week.');
			return;
		} finally {
			if (seq === requestSeq) loading = false;
		}
		let universe: { chars: readonly CharRow[]; cards: StudyCard[] } | null = null;
		if (usesHan(lang)) {
			// Characters need the language's ~13k-row universe: shown after the rest.
			characters = 'pending';
			try {
				const counted = await loadWeekCharacters(id, lang, week, { force });
				if (seq !== requestSeq) return;
				characters = counted;
				universe = counted?.universe ?? null;
			} catch {
				// Offline (the universe or legacy written forms could not be read):
				// the row stays, says so, and Retry loads again.
				if (seq === requestSeq) characters = 'unavailable';
			}
		}
		await loadWeekMilestones(seq, id, lang, timelines, universe);
	}

	// Every family: the replay ones sweep the timelines and universe loaded above.
	async function loadWeekMilestones(
		seq: number,
		id: number,
		lang: string,
		timelines: Timelines | undefined,
		universe: { chars: readonly CharRow[]; cards: StudyCard[] } | null
	): Promise<void> {
		if (seq !== requestSeq) return;
		const week =
			timelines === undefined
				? undefined
				: universe === null
					? { timelines, chars: null }
					: { timelines, chars: universe.chars, cards: universe.cards };
		try {
			const loaded = await loadMilestones(id, { scope: 'week', language: lang, ...(week === undefined ? {} : { week }) });
			if (seq === requestSeq) milestones = loaded;
		} catch {
			// The milestones are extra: the week stays without them.
			if (seq === requestSeq) milestones = null;
		}
	}

	function dismissMilestones(): void {
		const shown = milestones;
		if (shown === null || shown.workspaceId !== workspaceId) return;
		milestones = { ...shown, plan: { kind: 'none' } };
		void markSeen(shown);
	}

	$effect(() => {
		const href = weekRedirect(param, today);
		if (href !== null) void goto(href, { replaceState: true, keepFocus: true, noScroll: true }).catch(() => {});
	});
	$effect(() => {
		void load(workspaceId, language, monday);
	});
	// A posted review or a study-data write (a card, a deck, a vacation)
	// changes the numbers: load again (the history cache is already dropped).
	$effect(() => {
		const id = workspaceId;
		const lang = language;
		const week = monday;
		const again = (touched: number): void => {
			if (id !== null && (touched === id || touched === ALL_WORKSPACES)) void load(id, lang, week);
		};
		const offLog = onEventLogChange(again);
		const offWrite = onStudyWrite(again);
		return () => {
			offLog();
			offWrite();
		};
	});
	$effect(() =>
		onContextStale(() => {
			now = Date.now();
			void load(workspaceId, language, normalizeWeekParam(param, currentStudyDay().today(now)));
		})
	);
</script>

<section class="week" aria-labelledby="week-heading">
	<h2 id="week-heading" aria-live="polite">{weekHeading(shownMonday, today)}</h2>
	<nav class="weeks" aria-label="Weeks">
		{#if hasPreviousWeek(monday, today)}
			<a href={weekHref(previousWeek(monday), today)} data-sveltekit-keepfocus data-sveltekit-noscroll
				>Previous week</a
			>
		{/if}
		{#if next !== null}
			<a href={weekHref(next, today)} data-sveltekit-keepfocus data-sveltekit-noscroll>Next week</a>
		{/if}
	</nav>

	<!-- Always rendered: the status region must exist before the card's text arrives. -->
	<MilestoneCard view={view === null ? null : milestones} ondismiss={dismissMilestones} headingLevel={3} />

	{#if workspaceId === null}
		<p class="hint">Choose a workspace in the header to see its week.</p>
	{:else if loading && view === null}
		<p class="hint" aria-live="polite">Loading this week…</p>
	{:else if error}
		<p class="hint" role="status">
			{error}
			<button type="button" class="retry" onclick={() => void load(workspaceId, language, monday, true)}
				>Try again</button
			>
		</p>
	{:else if view !== null}
		<div class="week-body" class:stale={busy} aria-busy={busy}>
			<WeekSummary
				{view}
				{characters}
				milestones={milestones === null ? undefined : { items: milestones.history, titles: milestones.titles }}
				onretry={() => void load(workspaceId, language, monday, true)}
			/>
		</div>
	{/if}
</section>

{#if milestones !== null}
	<section id="milestones" class="milestones" aria-labelledby="milestones-heading">
		<h2 id="milestones-heading">{MILESTONE_TEXT.section}</h2>
		<MilestoneHistory items={milestones.history} titles={milestones.titles} />
	</section>
{/if}

<style>
	.week,
	.milestones {
		max-width: 40rem;
	}

	.milestones {
		margin-top: 2rem;
	}

	h2 {
		margin: 0;
		font-size: 1.15rem;
	}

	.weeks {
		display: flex;
		gap: 1rem;
		margin-top: 0.5rem;
		font-size: 0.9rem;
	}

	/* The previous week's numbers while the next one loads. */
	.stale {
		opacity: 0.55;
	}

	.hint {
		margin: 1rem 0 0;
		opacity: 0.8;
	}

	.retry {
		font: inherit;
		font-size: 0.8rem;
		margin-left: 0.35rem;
		padding: 0.15rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 60%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
</style>
