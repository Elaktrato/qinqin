<script lang="ts">
	// The four summary numbers (core, Stats → Overview first widget, also
	// selectable for Home): streak, words known, recall over the last 30
	// days and time studied this month. Every number is computed by
	// lib/stats/summary.ts from the shared study history; the widget only
	// formats and lays them out (design §9, §5).
	import { onEventLogChange } from '$lib/events';
	import { featureEnabled, FLASHCARDS_ID } from '$lib/features';
	import { RETENTION_MIN_REVIEWS } from '$lib/features/flashcards/decks/deckStats';
	import { t } from '$lib/i18n';
	import { formatNumber, formatPercent } from '$lib/i18n/format';
	import { pluginStates } from '$lib/plugins/states';
	import { errorText } from '$lib/api/apiErrors';
	import { formatDuration } from '$lib/stats/readingTime';
	import { summaryNumbers, type SummaryNumbers } from '$lib/stats/summary';
	import { contextForData, onContextStale } from '$lib/study/currentContext';
	import { loadStudyHistory } from '$lib/study/history';
	import { ALL_WORKSPACES, onStudyWrite } from '$lib/study/store';
	import { activeWeights } from '$lib/study/readModel';
	import Stat from '$lib/ui/Stat.svelte';
	import { workspaces } from '$lib/workspaces';
	import WidgetCard from './WidgetCard.svelte';
	import type { WidgetStatus } from './types';

	let summary = $state.raw<SummaryNumbers | null>(null);
	let loading = $state(true);
	let error = $state('');
	let noWorkspace = $state(false);

	// Guards against a slow earlier request overwriting a newer view.
	let requestSeq = 0;

	const workspaceId = $derived($workspaces.current?.id ?? null);
	// Before the states are known the feature counts as on (no flash of the note).
	const flashcardsOn = $derived(
		$pluginStates.status === 'ready'
			? featureEnabled(FLASHCARDS_ID, $pluginStates.list)
			: true
	);

	const status = $derived<WidgetStatus>(
		noWorkspace
			? 'no-workspace'
			: !flashcardsOn
				? 'ready'
				: loading
					? 'loading'
					: error
						? 'error'
						: 'ready'
	);

	async function load(workspace: number | null, force = false): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		error = '';
		noWorkspace = false;

		if (workspace === null) {
			summary = null;
			noWorkspace = true;
			loading = false;
			return;
		}

		try {
			// Duplicate cards arrive merged, their reviews re-pointed; the
			// history is shared with the other widgets (history.ts).
			const data = await loadStudyHistory(workspace, { force });
			if (seq !== requestSeq) return;
			const ctx = contextForData(data, workspace);
			summary = summaryNumbers({
				workspaceId: workspace,
				now: Date.now(),
				day: ctx.day,
				cards: data.cards,
				decks: data.decks,
				reviews: data.reviews,
				known: data.known,
				vacation: ctx.vacation,
				w: activeWeights(data),
				kinds: [],
				deckSettings: data.deckSettings
			});
		} catch (err) {
			if (seq !== requestSeq) return;
			summary = null;
			error = errorText(err, t('widgets.summary.loadFailed'));
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	$effect(() => {
		if (!flashcardsOn) {
			// Switching the feature off drops the numbers at once and
			// invalidates a load that is still running.
			requestSeq += 1;
			summary = null;
			loading = false;
			noWorkspace = workspaceId === null;
			return;
		}
		void load(workspaceId);
	});
	$effect(() => onContextStale(() => void load(workspaceId)));

	// A posted review or a study-data write changes the numbers; the history
	// cache is dropped by both. Only this workspace (or all) triggers a load.
	$effect(() => {
		const id = workspaceId;
		const again = (touched: number): void => {
			if (id !== null && (touched === id || touched === ALL_WORKSPACES)) void load(id);
		};
		const offLog = onEventLogChange(again);
		const offWrite = onStudyWrite(again);
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
	{error}
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
