<script lang="ts">
	import { ApiError } from '$lib/api/client';
	import { buildQueue } from '$lib/study/scheduler';
	import { dailyStreak, levelProgress, xpFromReviews } from '$lib/study/exp';
	import Mascot from './Mascot.svelte';
	import { loadConfig } from '$lib/study/session';
	import {
		effectiveCardTypes,
		hasTabSetup,
		loadRememberedTypes
	} from '$lib/study/cardTypesMemory';
	import { loadStudyHistory } from '$lib/study/history';
	import { GENERAL_DECK_ID } from '$lib/study/store';
	import type { Deck, ReviewEvent, ReviewGrade, StudyCard } from '$lib/study/types';
	import WidgetCard from '$lib/widgets/WidgetCard.svelte';
	import type { WidgetStatus } from '$lib/widgets/types';
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
	const status = $derived<WidgetStatus>(
		noWorkspace ? 'no-workspace' : loading ? 'loading' : error ? 'error' : 'ready'
	);

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	async function load(workspace: number | null, force = false): Promise<void> {
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
			// Duplicate cards arrive merged, their reviews re-pointed; the
			// history is shared with the other widgets (history.ts).
			const data = await loadStudyHistory(workspace, { force });
			if (seq !== requestSeq) return;
			decks = data.decks;
			cards = data.cards;
			reviews = data.reviews;
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

<WidgetCard
	title="Flashcards"
	headingId="flashcards-heading"
	{status}
	noWorkspaceText="Choose a workspace in the header to study."
	loadingText="Loading study data…"
	{error}
	onretry={() => void load(workspaceId, true)}
>
	{#snippet actions()}
		<a class="study" href="/study">Study</a>
	{/snippet}

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
</WidgetCard>

<style>
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
</style>
