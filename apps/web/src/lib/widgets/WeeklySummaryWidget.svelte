<script lang="ts">
	// Home: this week so far compared with last week up to the
	// same weekday, day by day, and a link to Stats → Week. No mature
	// words or characters here (no replay, no character universe). All
	// logic lives in lib/weekly (loadWeek.ts is the load).
	import { errorMessage } from '$lib/stats/errors';
	import { t } from '$lib/i18n';
	import { onContextStale } from '$lib/study/currentContext';
	import { currentStudyDay } from '$lib/time/zone';
	import { loadWeek, type WeekView } from '$lib/weekly/loadWeek';
	import Button from '$lib/ui/Button.svelte';
	import WeekSummary from '$lib/weekly/WeekSummary.svelte';
	import { weekOf } from '$lib/weekly/week';
	import { workspaces } from '$lib/workspaces';
	import WidgetCard from './WidgetCard.svelte';
	import type { WidgetStatus } from './types';

	let view = $state.raw<WeekView | null>(null);
	let loading = $state(true);
	let error = $state('');
	// Guards against a slow earlier request overwriting a newer view.
	let requestSeq = 0;

	const workspaceId = $derived($workspaces.current?.id ?? null);
	const status = $derived<WidgetStatus>(
		workspaceId === null ? 'no-workspace' : loading && view === null ? 'loading' : error ? 'error' : 'ready'
	);

	async function load(workspace: number | null, force = false): Promise<void> {
		const seq = ++requestSeq;
		error = '';
		if (workspace === null) {
			view = null;
			loading = false;
			return;
		}
		loading = true;
		try {
			const monday = weekOf(currentStudyDay().today());
			const next = await loadWeek(workspace, monday, { force });
			if (seq !== requestSeq) return;
			view = next;
		} catch (err) {
			if (seq !== requestSeq) return;
			view = null;
			error = errorMessage(err, t('widgets.week.loadFailed'));
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	$effect(() => {
		void load(workspaceId);
	});
	// Midnight and zone changes: on Monday 00:00 this becomes a new week.
	$effect(() => onContextStale(() => void load(workspaceId)));
</script>

<WidgetCard
	title={t('widgets.week.title')}
	headingId="weekly-summary-heading"
	{status}
	noWorkspaceText={t('widgets.week.noWorkspace')}
	loadingText={t('widgets.week.loading')}
	{error}
	onretry={() => void load(workspaceId, true)}
>
	{#snippet actions()}
		<Button variant="plain" href="/stats/week">{t('widgets.week.more')}</Button>
	{/snippet}

	{#if view !== null}
		<WeekSummary {view} layout="compact" onretry={() => void load(workspaceId, true)} />
	{/if}
</WidgetCard>
