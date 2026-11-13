<script lang="ts">
	import { parseReview } from '$lib/study/reviewParse';
	import { ApiError, api } from '$lib/api/client';
	import type { StudyEvent } from '$lib/events';
	import { HEATMAP_DAYS, reviewCountsByDay } from '$lib/study/heatmap';
	import { buildQueue } from '$lib/study/scheduler';
	import { dailyStreak, levelProgress, xpFromReviews } from '$lib/study/exp';
	import Mascot from './Mascot.svelte';
	import { loadConfig } from '$lib/study/session';
	import {
		effectiveCardTypes,
		hasTabSetup,
		loadRememberedTypes
	} from '$lib/study/cardTypesMemory';
	import { GENERAL_DECK_ID, loadStudyData } from '$lib/study/store';
	import type { Deck, ReviewEvent, ReviewGrade, StudyCard } from '$lib/study/types';
	import { workspaces } from '$lib/workspaces';

	// The home widget mirrors the study setup for its limits and card
	// types; it counts every deck in the workspace, so a saved deck
	// selection cannot hide cards from the status line.
	const config = loadConfig();

	let decks = $state<Deck[]>([]);
	let cards = $state<StudyCard[]>([]);
	let reviews = $state<ReviewEvent[]>([]);
	let loading = $state(true);
	let error = $state('');
	let noWorkspace = $state(false);

	// Guards against a slow earlier request overwriting a newer view.
	let requestSeq = 0;

	const workspaceId = $derived($workspaces.current?.id ?? null);
	const deckIds = $derived([GENERAL_DECK_ID, ...decks.map((deck) => deck.id)]);

	// The card types a session would study: this tab's setup, else the
	// types last started in this workspace, else vocab.
	const kinds = $derived(
		effectiveCardTypes(
			hasTabSetup() ? config.cardTypes : null,
			workspaceId === null ? null : loadRememberedTypes(workspaceId)
		)
	);

	// Due means a reviewed card of those types whose derived schedule has
	// come due; fresh counts existing never-reviewed cards of those types.
	// Unlike the setup page, companions not created yet are not counted.
	const queue = $derived.by(() => {
		if (noWorkspace || cards.length === 0) return { due: 0, fresh: 0 };
		const now = new Date();
		return {
			due: buildQueue({
				cards,
				reviews,
				deckIds,
				newLimit: 0,
				reviewLimit: config.reviewLimit,
				now,
				kinds
			}).length,
			fresh: buildQueue({
				cards,
				reviews,
				deckIds,
				newLimit: config.newLimit,
				reviewLimit: 0,
				now,
				kinds
			}).length
		};
	});

	const xp = $derived(xpFromReviews(reviews));
	const progress = $derived(levelProgress(xp));
	const level = $derived(progress.level);
	const streak = $derived(dailyStreak(reviews, Date.now()));

	const cells = $derived(
		[...reviewCountsByDay(reviews, new Date()).entries()].map(([day, count]) => ({
			day,
			count,
			level: intensity(count)
		}))
	);
	const windowTotal = $derived(cells.reduce((sum, cell) => sum + cell.count, 0));

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
		noWorkspace = false;

		if (workspace === null) {
			decks = [];
			cards = [];
			reviews = [];
			noWorkspace = true;
			loading = false;
			return;
		}

		try {
			const [data, events] = await Promise.all([
				loadStudyData(),
				api<StudyEvent[]>(
					`/api/events?since=1970-01-01T00:00:00Z&workspace=${workspace}`
				)
			]);
			if (seq !== requestSeq) return;
			decks = data.decks;
			cards = data.cards;
			reviews = events
				.map((event) => (event.workspaceId === workspace ? parseReview(event) : null))
				.filter((event): event is ReviewEvent => event !== null);
		} catch (err) {
			if (seq !== requestSeq) return;
			decks = [];
			cards = [];
			reviews = [];
			error = message(err, 'Could not load your flashcards.');
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

<section class="flashcards" aria-labelledby="flashcards-heading">
	<header class="head">
		<h2 id="flashcards-heading">Flashcards</h2>
		<a class="study" href="/study">Study</a>
	</header>

	{#if noWorkspace}
		<p class="hint">Choose a workspace in the header to study.</p>
	{:else if loading}
		<p class="hint" aria-live="polite">Loading study data…</p>
	{:else if error}
		<p class="hint muted" role="status">
			{error}
			<button type="button" class="retry" onclick={() => void load(workspaceId)}>Try again</button>
		</p>
	{:else}
		<div class="buddy">
			<Mascot {level} streak={streak.current} todayDone={streak.todayDone} />
			<div class="progress">
				<p class="stats">
					<strong>{queue.due}</strong>
					{queue.due === 1 ? 'card' : 'cards'} due ·
					<strong>{queue.fresh}</strong> new · Level <strong>{level}</strong> ·
					{xp} XP
				</p>
				<div
					class="bar"
					role="progressbar"
					aria-label="Progress to the next level"
					aria-valuemin="0"
					aria-valuemax={progress.xpForNext}
					aria-valuenow={progress.xpInto}
					aria-valuetext={`${progress.xpInto} of ${progress.xpForNext} XP to level ${level + 1}`}
				>
					<span style:width={`${(progress.xpInto / progress.xpForNext) * 100}%`}></span>
				</div>
				<p class="streak" class:idle={!streak.todayDone}>
					<span class="flame" aria-hidden="true">🔥</span>
					<strong>{streak.current}</strong>
					{streak.current === 1 ? 'day' : 'days'} streak ·
					{streak.todayDone
						? 'done today'
						: streak.current === 0
							? 'study today to start one'
							: 'study today to keep it'}
				</p>
			</div>
		</div>

		<div
			class="grid"
			role="img"
			aria-label={`Review activity for the last ${Math.round(HEATMAP_DAYS / 7)} weeks: ${windowTotal} ${windowTotal === 1 ? 'review' : 'reviews'}`}
		>
			{#each cells as cell (cell.day)}
				<span
					class="cell level-{cell.level}"
					title={`${cell.day}: ${cell.count} ${cell.count === 1 ? 'review' : 'reviews'}`}
				></span>
			{/each}
		</div>

		<footer class="legend">
			<span>
				{windowTotal}
				{windowTotal === 1 ? 'review' : 'reviews'} in the last 13 weeks
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
	.flashcards {
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

	.study {
		font-size: 0.8rem;
		padding: 0.2rem 0.65rem;
		border: 1px solid #0b6bcb;
		border-radius: 999px;
		color: #0b6bcb;
		font-weight: 600;
		text-decoration: none;
	}

	.buddy {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		margin-top: 0.9rem;
	}

	.progress {
		flex: 1;
		min-width: 0;
	}

	.bar {
		height: 0.5rem;
		margin-top: 0.5rem;
		border-radius: 999px;
		overflow: hidden;
		background: color-mix(in srgb, currentColor 14%, transparent);
	}

	.bar span {
		display: block;
		height: 100%;
		background: #0b6bcb;
	}

	.streak {
		margin: 0.5rem 0 0;
		font-size: 0.85rem;
	}

	.streak.idle {
		opacity: 0.75;
	}

	.streak.idle .flame {
		filter: grayscale(1);
	}

	.stats {
		margin: 0;
		font-size: 0.9rem;
		opacity: 0.85;
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

	.muted {
		color: color-mix(in srgb, currentColor 70%, transparent);
	}

	.retry {
		font: inherit;
		font-size: 0.8rem;
		margin-left: 0.35rem;
		padding: 0.15rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
</style>
