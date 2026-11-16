<script lang="ts">
	// Stats → Week: one week's summary of the current workspace, previous
	// weeks browsable by link (?week=<Monday>). All logic lives in
	// lib/weekly (week.ts for the URL, loadWeek.ts for the load).
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onEventLogChange } from '$lib/events';
	import { usesHan } from '$lib/languages';
	import { errorMessage } from '$lib/stats/errors';
	import { onContextStale } from '$lib/study/currentContext';
	import { ALL_WORKSPACES, onStudyWrite } from '$lib/study/store';
	import { currentStudyDay } from '$lib/time/zone';
	import { loadWeek, loadWeekCharacters, type WeekView } from '$lib/weekly/loadWeek';
	import type { Pair } from '$lib/weekly/summary';
	import WeekSummary from '$lib/weekly/WeekSummary.svelte';
	import {
		hasPreviousWeek,
		nextWeek,
		normalizeWeekParam,
		previousWeek,
		weekHref,
		weekRedirect
	} from '$lib/weekly/week';
	import { weekHeading } from '$lib/weekly/weekText';
	import { workspaces } from '$lib/workspaces';

	let now = $state(Date.now());
	let view = $state.raw<WeekView | null>(null);
	let characters = $state.raw<Pair | null | 'pending'>(null);
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
		if (id === null) {
			view = null;
			loading = false;
			return;
		}
		loading = true;
		try {
			const loaded = await loadWeek(id, week, { detail: true, force });
			if (seq !== requestSeq) return;
			view = loaded;
		} catch (err) {
			if (seq !== requestSeq) return;
			view = null;
			error = errorMessage(err, 'Could not load this week.');
			return;
		} finally {
			if (seq === requestSeq) loading = false;
		}
		if (!usesHan(lang)) return;
		// Characters need the language's ~13k-row universe: shown after the rest.
		characters = 'pending';
		try {
			const counted = await loadWeekCharacters(id, lang, week, { force });
			if (seq === requestSeq) characters = counted;
		} catch {
			if (seq === requestSeq) characters = null;
		}
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
			<WeekSummary {view} {characters} onretry={() => void load(workspaceId, language, monday, true)} />
		</div>
	{/if}
</section>

<style>
	.week {
		max-width: 40rem;
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
