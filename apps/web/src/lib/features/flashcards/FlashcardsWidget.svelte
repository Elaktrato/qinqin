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
	import type { GrammarRun } from '$lib/studycore/grammarRuns';
	import type { CourseStep } from '$lib/studycore/courseCounting';
	import type { DrillAnswer } from '$lib/studycore/drills';
	import Mascot from './Mascot.svelte';
	import { setupKinds } from './setup/setup';
	import { loadStudyHistory, onStudyChange, touches } from '$lib/studycore/data';
	import { activeWeights } from '$lib/studycore/readModel';
	import { DEFAULT_W } from '$lib/studycore/fsrsParams';
	import { GENERAL_DECK_ID } from '$lib/studycore/types';
	import type { Deck, ReviewEvent, ReviewGrade, StudyCard } from '$lib/studycore/types';
	import Button from '$lib/ui/Button.svelte';
	import WidgetCard from '$lib/widgets/WidgetCard.svelte';
	import { WidgetLoad, heldValue, holdValue } from '$lib/widgets/widgetLoad.svelte';
	import type { WidgetStatus } from '$lib/widgets/types';
	import { useApp, useSession } from '$lib/context/context';
	import { companionEntryIds } from './session/eligibility.svelte';

	const app = useApp();
	const session = useSession();

	interface Shown {
		decks: Deck[];
		cards: StudyCard[];
		reviews: ReviewEvent[];
		grammarRuns: readonly GrammarRun[];
		drillAnswers: readonly DrillAnswer[];
		courseSteps: readonly CourseStep[];
		weights: readonly number[];
		deckSettings: Record<string, DeckSettings>;
		ctx: StudyContext;
		vacations: VacationPeriod[];
	}
	// The last history of this workspace shows at once on a revisit (#290).
	const shown = new WidgetLoad<Shown>(session, 'flashcards', session.workspaces.current?.id ?? null);
	const decks = $derived(shown.value?.decks ?? []);
	const cards = $derived(shown.value?.cards ?? []);
	const reviews = $derived(shown.value?.reviews ?? []);
	const grammarRuns = $derived(shown.value?.grammarRuns ?? []);
	const drillAnswers = $derived(shown.value?.drillAnswers ?? []);
	const courseSteps = $derived(shown.value?.courseSteps ?? []);
	const weights = $derived(shown.value?.weights ?? DEFAULT_W);
	const deckSettings = $derived(shown.value?.deckSettings ?? {});
	const fallbackCtx = currentContext(session.zone);
	const ctx = $derived(shown.value?.ctx ?? fallbackCtx);
	const vacations = $derived(shown.value?.vacations ?? []);
	let noWorkspace = $state(false);

	// The daily goal loads on its own: a failure only leaves the ring out (a
	// held ring stays, #290).
	let goal = $state.raw<GoalView | null>(
		session.workspaces.current === null ? null : (heldValue<GoalView>(session, 'flashcards-goal', session.workspaces.current.id) ?? null)
	);
	let goalSeq = 0;
	let goalWorkspace: number | null = session.workspaces.current?.id ?? null;
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

	const xp = $derived(xpFromReviews(reviews, studyDay.dayOf, grammarRuns, drillAnswers, courseSteps));
	const vacationText = $derived(
		workspaceId === null
			? null
			: vacationLine(vacationStatus(vacations, workspaceId, studyDay.today()), studyDay.today())
	);
	const progress = $derived(levelProgress(xp));
	const level = $derived(progress.level);
	const streak = $derived(dailyStreak(reviews, Date.now(), studyDay, ctx.vacation, grammarRuns, drillAnswers, courseSteps));
	const status = $derived<WidgetStatus>(
		noWorkspace ? 'no-workspace' : shown.loading ? 'loading' : shown.error ? 'error' : 'ready'
	);

	async function load(workspace: number | null, force = false): Promise<void> {
		noWorkspace = workspace === null;
		if (workspace === null) {
			shown.clear();
			return;
		}
		await shown.run(
			workspace,
			async () => {
				const data = await loadStudyHistory(session.study, workspace, { force });
				if (app.offline.online) await session.eligibility.ensure(companionEntryIds(data.cards));
				return {
					decks: data.decks,
					cards: data.cards,
					reviews: data.reviews,
					grammarRuns: data.grammarRuns,
					drillAnswers: data.drillAnswers ?? [],
					courseSteps: data.courseSteps ?? [],
					deckSettings: data.deckSettings ?? {},
					weights: activeWeights(data),
					ctx: contextForData(session.zone, data, workspace),
					vacations: data.vacations ?? []
				};
			},
			(err) => errorText(err, t('flashcards.widget.loadError'))
		);
	}

	async function loadGoal(workspace: number | null, force = false): Promise<void> {
		const seq = ++goalSeq;
		if (workspace === null) {
			goal = null;
			goalWorkspace = null;
			return;
		}
		if (workspace !== goalWorkspace) {
			// Another workspace: its own held ring, or none until it loads.
			goalWorkspace = workspace;
			goal = heldValue<GoalView>(session, 'flashcards-goal', workspace) ?? null;
		}
		try {
			const next = await loadGoalStatus(session, workspace, { force });
			if (seq !== goalSeq) return;
			goal = next;
			holdValue(session, 'flashcards-goal', workspace, next);
		} catch {
			// A failed refresh keeps the goal shown (#290); none shown stays none.
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
	// A write or a refresh behind the held rows (#290), or a posted review,
	// changes the counts: only this workspace (or all) loads again.
	$effect(() => {
		const id = workspaceId;
		const again = (touched: number): void => {
			if (touches(touched, id)) {
				void load(id);
				void loadGoal(id);
			}
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
	title={t('flashcards.widget.title')}
	headingId="flashcards-heading"
	{status}
	noWorkspaceText={t('flashcards.widget.noWorkspace')}
	loadingText={t('flashcards.widget.loading')}
	error={shown.error}
	stale={shown.stale}
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
