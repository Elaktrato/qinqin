<script lang="ts">
	// The four summary numbers (core, Stats → Overview first widget, also
	// selectable for Home): streak, words known, recall over the last 30
	// days and time studied this month. Every number is computed by
	// lib/stats/summary.ts from the shared study history; the widget only
	// formats and lays them out (design §9, §5).
	import { featureEnabled, FLASHCARDS_ID } from '$lib/features';
	import { RETENTION_MIN_REVIEWS } from '$lib/features/flashcards/decks/deckStats';
	import { t } from '$lib/i18n';
	import { formatNumber, formatPercent } from '$lib/i18n/format';
	import { errorText } from '$lib/api/apiErrors';
	import { formatDuration } from '$lib/stats/readingTime';
	import { summaryNumbers, type SummaryNumbers } from '$lib/stats/summary';
	import { contextForData, onContextStale } from '$lib/studycore/currentContext';
	import { ALL_WORKSPACES, onStudyChange, loadStudyHistory } from '$lib/studycore/data';
	import { activeWeights } from '$lib/studycore/readModel';
	import Stat from '$lib/ui/Stat.svelte';
	import WidgetCard from './WidgetCard.svelte';
	import { WidgetLoad } from './widgetLoad.svelte';
	import type { WidgetStatus } from './types';
	import { useSession } from '$lib/context/context';


	const session = useSession();

	let noWorkspace = $state(false);

	const workspaceId = $derived(session.workspaces.current?.id ?? null);
	// The last numbers of this workspace show at once on a revisit (#290).
	const numbers = new WidgetLoad<SummaryNumbers>(session, 'summary-numbers', session.workspaces.current?.id ?? null);
	const summary = $derived(numbers.value);
	// Before the states are known the feature counts as on (no flash of the note).
	const flashcardsOn = $derived(
		session.features.status === 'ready'
			? featureEnabled(FLASHCARDS_ID, session.features.list)
			: true
	);

	const status = $derived<WidgetStatus>(
		noWorkspace
			? 'no-workspace'
			: !flashcardsOn
				? 'ready'
				: numbers.loading
					? 'loading'
					: numbers.error
						? 'error'
						: 'ready'
	);

	async function load(workspace: number | null, force = false): Promise<void> {
		noWorkspace = workspace === null;
		if (workspace === null) {
			numbers.clear();
			return;
		}
		await numbers.run(
			workspace,
			async () => {
				// Duplicate cards arrive merged, their reviews re-pointed; the
				// history is shared with the other widgets (studycore/data.ts loadStudyHistory).
				const data = await loadStudyHistory(session.study, workspace, { force });
				const ctx = contextForData(session.zone, data, workspace);
				return summaryNumbers({
					workspaceId: workspace,
					now: Date.now(),
					day: ctx.day,
					cards: data.cards,
					decks: data.decks,
					reviews: data.reviews,
					grammarRuns: data.grammarRuns,
					drillAnswers: data.drillAnswers,
					courseSteps: data.courseSteps,
					known: data.known,
					vacation: ctx.vacation,
					w: activeWeights(data),
					kinds: [],
					deckSettings: data.deckSettings
				});
			},
			(err) => errorText(err, t('widgets.summary.loadFailed'))
		);
	}

	$effect(() => {
		if (!flashcardsOn) {
			// Switching the feature off drops the numbers at once and
			// invalidates a load that is still running.
			numbers.clear();
			noWorkspace = workspaceId === null;
			return;
		}
		void load(workspaceId);
	});
	$effect(() => onContextStale(session.zone, () => void load(workspaceId)));

	// A posted review or a study-data write changes the numbers; the history
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
	title={t('widgets.summary.title')}
	headingId="summary-numbers-heading"
	{status}
	error={numbers.error}
	stale={numbers.stale}
	onretry={() => void load(workspaceId, true)}
>
	{#if !flashcardsOn}
		<p class="hint">{t('stats.summary.noFlashcards')}</p>
	{:else if summary !== null}
		<div class="numbers">
			<Stat value={formatNumber(summary.streak)} label={t('stats.summary.streak')} />
			<Stat value={formatNumber(summary.wordsKnown)} label={t('stats.summary.wordsKnown')} />
			<Stat
				value={summary.recall.share === null
					? t('stats.summary.recallLater', { count: RETENTION_MIN_REVIEWS })
					: formatPercent(summary.recall.share)}
				label={t('stats.summary.recall')}
			/>
			<Stat value={formatDuration(summary.studiedSeconds)} label={t('stats.summary.studied')} />
		</div>
	{/if}
</WidgetCard>

<style>
	/* Four columns from 720 px, two by two on the phone (design §9). */
	.numbers {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-5) var(--space-4);
		margin-top: var(--space-4);
	}

	@media (max-width: 719px) {
		.numbers :global(.value) {
			font-size: 1.6rem;
		}
	}

	@media (min-width: 720px) {
		.numbers {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.hint {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}
</style>
