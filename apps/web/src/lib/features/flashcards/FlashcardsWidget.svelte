<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import Msg from '$lib/ui/Msg.svelte';
	import GoalRing from '$lib/goals/GoalRing.svelte';
	import { streakText } from '$lib/goals/goalText';
	import { loadGoalStatus, type GoalView } from '$lib/goals/loadGoal';
	import { leftToday } from './session/dueCounts';
	import { leftTodayText } from './session/limitsText';
	import { enabledKinds, type DeckSettings } from '$lib/studycore/deckSettings';
	import { contextForData, currentContext, onContextStale } from '$lib/studycore/currentContext';
	import type { StudyContext } from '$lib/studycore/studyContext';
	import type { VacationPeriod } from '$lib/studycore/vacation';
	import { vacationLine, vacationStatus } from '$lib/settings/vacationForm';
	import { dailyStreak, levelProgress, xpFromReviews } from '$lib/studycore/exp';
	import Mascot from './Mascot.svelte';
	import { setupKinds } from './setup/setup';
	import { loadStudyHistory } from '$lib/studycore/data';
	import { activeWeights } from '$lib/studycore/readModel';
	import { DEFAULT_W } from '$lib/studycore/fsrsParams';
	import { GENERAL_DECK_ID } from '$lib/studycore/types';
	import type { Deck, ReviewEvent, ReviewGrade, StudyCard } from '$lib/studycore/types';
	import Button from '$lib/ui/Button.svelte';
	import WidgetCard from '$lib/widgets/WidgetCard.svelte';
	import type { WidgetStatus } from '$lib/widgets/types';
	import { useApp, useSession } from '$lib/context/context';
	import { companionEntryIds } from './session/eligibility.svelte';

	const app = useApp();
	const session = useSession();

	let decks = $state<Deck[]>([]);
	let cards = $state<StudyCard[]>([]);
	let reviews = $state<ReviewEvent[]>([]);
	let weights = $state.raw<readonly number[]>(DEFAULT_W);
	let deckSettings = $state.raw<Record<string, DeckSettings>>({});
	// Vacation days and the study clock of this workspace (rebuilt at midnight).
	let ctx = $state.raw<StudyContext>(currentContext(session.zone));
	let vacations = $state.raw<VacationPeriod[]>([]);
	let loading = $state(true);
	let error = $state('');
	let noWorkspace = $state(false);

	// Guards against a slow earlier request overwriting a newer view.
	let requestSeq = 0;
	// The daily goal loads on its own: a failure only leaves the ring out.
	let goal = $state.raw<GoalView | null>(null);
	let goalSeq = 0;
	// Offline with an activity goal today the ring is left out (not "no longer counted").
	const showGoal = $derived(
		goal !== null &&
			!noWorkspace &&
			(goal.today.status !== 'none' || (goal.today.unavailable && goal.activityError === null))
	);

	const workspaceId = $derived(session.workspaces.current?.id ?? null);
	const deckIds = $derived([GENERAL_DECK_ID, ...decks.map((deck) => deck.id)]);

	// The card types of the saved study setup (what the study modal starts):
	// its kinds plus each opt-in kind a deck switches on that the learner has
	// not unchecked. It counts every deck in the workspace, so a narrowed deck
	// selection cannot hide cards from the status line.
	const kinds = $derived(
		workspaceId === null
			? []
			: setupKinds(session.setups.of(workspaceId).setup, enabledKinds(deckSettings, deckIds), session.workspaces.current?.language ?? '')
	);
	// Another device may have changed the setup.
	$effect(() => {
		if (workspaceId !== null) void session.setups.refresh(workspaceId);
	});

	// What the daily limits admit right now of those types: due reviews and
	// new cards left today, the companions the session would plan among them
	// (the eligibility index decides which words make one, #288; offline none),
	// burying and vacation applied (dueCounts.ts leftToday).
	const left = $derived.by(() => {
		if (noWorkspace || cards.length === 0) {
			return { reviews: 0, new: 0, unlimited: false, limitedOut: 0 };
		}
		const companions = { language: session.workspaces.current?.language ?? '', skip: session.eligibility.skip(), offline: !app.offline.online };
		return leftToday({ cards, reviews, deckIds, kinds, deckSettings, now: new Date(), w: weights, ctx, companions });
	});

	// The learner's day rule; a zone change recomputes XP and the streak.
	let studyDay = $state.raw(session.zone.day());
	$effect(() => session.zone.onChange((next) => (studyDay = next)));

	const xp = $derived(xpFromReviews(reviews, studyDay.dayOf));
	const vacationText = $derived(
		workspaceId === null
			? null
			: vacationLine(vacationStatus(vacations, workspaceId, studyDay.today()), studyDay.today())
	);
	const progress = $derived(levelProgress(xp));
	const level = $derived(progress.level);
	const streak = $derived(dailyStreak(reviews, Date.now(), studyDay, ctx.vacation));
	const status = $derived<WidgetStatus>(
		noWorkspace ? 'no-workspace' : loading ? 'loading' : error ? 'error' : 'ready'
	);

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
			// history is shared with the other widgets (studycore/data.ts loadStudyHistory).
			const data = await loadStudyHistory(session.study, workspace, { force });
			if (seq !== requestSeq) return;
			// The words' companion kinds before the count (a failure counts them as before).
			if (app.offline.online) await session.eligibility.ensure(companionEntryIds(data.cards));
			if (seq !== requestSeq) return;
			decks = data.decks;
			cards = data.cards;
			reviews = data.reviews;
			deckSettings = data.deckSettings ?? {};
			weights = activeWeights(data);
			ctx = contextForData(session.zone, data, workspace);
			vacations = data.vacations ?? [];
		} catch (err) {
			if (seq !== requestSeq) return;
			decks = [];
			cards = [];
			reviews = [];
			error = errorText(err, t('flashcards.widget.loadError'));
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	async function loadGoal(workspace: number | null, force = false): Promise<void> {
		const seq = ++goalSeq;
		if (workspace === null) {
			goal = null;
			return;
		}
		try {
			const next = await loadGoalStatus(session, workspace, { force });
			if (seq === goalSeq) goal = next;
		} catch {
			if (seq === goalSeq) goal = null;
		}
	}

	// Refetch when the active workspace changes; the header switcher makes
	// that possible without leaving home.
	$effect(() => {
		void load(workspaceId);
		void loadGoal(workspaceId);
	});
	$effect(() =>
		onContextStale(session.zone, () => {
			void load(workspaceId);
			void loadGoal(workspaceId);
		})
	);
</script>

<WidgetCard
	title={t('flashcards.widget.title')}
	headingId="flashcards-heading"
	{status}
	noWorkspaceText={t('flashcards.widget.noWorkspace')}
	loadingText={t('flashcards.widget.loading')}
	{error}
	onretry={() => {
		void load(workspaceId, true);
		void loadGoal(workspaceId, true);
	}}
>
	{#snippet actions()}
		<Button
			variant="primary"
			href="/study"
			onclick={(e: MouseEvent) => {
				e.preventDefault();
				session.studyModal.show();
			}}>{t('flashcards.widget.study')}</Button
		>
	{/snippet}

	<div class="buddy">
		<Mascot {level} streak={streak.current} todayDone={streak.todayDone} />
		<div class="progress">
			<p class="stats">
				{vacationText ?? leftTodayText(left)} ·
				<Msg
					key="flashcards.widget.level"
					args={{ level, xp: progress.xpInto, next: progress.xpForNext }}
				>{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg
				>
			</p>
			<div
				class="bar"
				role="progressbar"
				aria-label={t('flashcards.widget.progress')}
				aria-valuemin="0"
				aria-valuemax={progress.xpForNext}
				aria-valuenow={progress.xpInto}
				aria-valuetext={t('flashcards.widget.progressValue', { into: progress.xpInto, next: progress.xpForNext, level: level + 1 })}
			>
				<span style:width={`${(progress.xpInto / progress.xpForNext) * 100}%`}></span>
			</div>
			<p class="streak" class:idle={!streak.todayDone}>
				<span class="flame" aria-hidden="true">🔥</span>
				<strong>{streak.current}</strong>
				{t('flashcards.widget.streakDays', { count: streak.current })}
				{streak.todayDone
					? t('flashcards.widget.streakDone')
					: streak.current === 0
						? t('flashcards.widget.streakStart')
						: t('flashcards.widget.streakKeep')}
			</p>
			{#if showGoal && goal !== null}
				<div class="goal">
					<GoalRing day={goal.today} sources={goal.sources} size="small" />
					{#if goal.streak !== null}
						<span class="goal-streak">{streakText(goal.streak)}</span>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</WidgetCard>

<style>
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

	/* The level line: a thin accent bar on a --raised track (design §9,
	   "level and XP line"). */
	.bar {
		height: 4px;
		margin-top: 0.5rem;
		border-radius: 2px;
		overflow: hidden;
		background: var(--raised);
	}

	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	.streak {
		margin: 0.5rem 0 0;
		font-size: 0.85rem;
	}

	.streak.idle {
		color: var(--readable-muted);
	}

	.streak.idle .flame {
		filter: grayscale(1);
	}

	.goal {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.75rem;
		margin-top: 0.5rem;
		font-size: 0.85rem;
	}

	.stats {
		margin: 0;
		font-size: 0.9rem;
		color: var(--readable-muted);
	}
</style>
