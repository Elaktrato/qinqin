<script lang="ts">
	// Home: this week so far compared with last week up to the
	// same weekday, day by day, and a link to Stats → Week. No mature
	// words or characters here (no replay, no character universe). All
	// logic lives in lib/weekly (loadWeek.ts is the load).
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { onContextStale } from '$lib/studycore/currentContext';
	import { loadWeek, type WeekView } from '$lib/weekly/loadWeek';
	import Button from '$lib/ui/Button.svelte';
	import { STATS_ID, featureKnownOff } from '$lib/features';
	import WeekSummary from '$lib/weekly/WeekSummary.svelte';
	import { weekOf } from '$lib/weekly/week';
	import { onStudyChange, touches } from '$lib/studycore/data';
	import WidgetCard from './WidgetCard.svelte';
	import { WidgetLoad } from './widgetLoad.svelte';
	import type { WidgetStatus } from './types';
	import { useSession } from '$lib/context/context';

	const session = useSession();

	/** The week shown: one scope per workspace and week, so a new week never shows the last one's numbers. */
	function scopeOf(workspace: number): string {
		return `${workspace}:${weekOf(session.zone.day().today())}`;
	}
	// The last summary of this week shows at once on a revisit (#290).
	const current = session.workspaces.current;
	const shown = new WidgetLoad<WeekView>(session, 'weekly-summary', current === null ? null : scopeOf(current.id));
	const view = $derived(shown.value);

	const workspaceId = $derived(session.workspaces.current?.id ?? null);
	const status = $derived<WidgetStatus>(
		workspaceId === null ? 'no-workspace' : shown.loading ? 'loading' : shown.error ? 'error' : 'ready'
	);

	async function load(workspace: number | null, force = false): Promise<void> {
		if (workspace === null) {
			shown.clear();
			return;
		}
		const monday = weekOf(session.zone.day().today());
		await shown.run(`${workspace}:${monday}`, () => loadWeek(session, workspace, monday, { force }), (err) =>
			errorText(err, t('widgets.week.loadFailed'))
		);
	}

	$effect(() => {
		void load(workspaceId);
	});
	// Midnight and zone changes: on Monday 00:00 this becomes a new week.
	$effect(() => onContextStale(session.zone, () => void load(workspaceId)));
	// A write, a refresh behind the held rows (#290) or a posted review changes the week.
	$effect(() => {
		const id = workspaceId;
		const again = (touched: number): void => {
			if (touches(touched, id)) void load(id);
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
	title={t('widgets.week.title')}
	headingId="weekly-summary-heading"
	{status}
	noWorkspaceText={t('widgets.week.noWorkspace')}
	loadingText={t('widgets.week.loading')}
	error={shown.error}
	stale={shown.stale}
	onretry={() => void load(workspaceId, true)}
>
	{#snippet actions()}
		<!-- The Week tab is a Stats page: no link while Stats is switched off (#295). -->
		{#if !featureKnownOff(STATS_ID, session.features)}
			<Button variant="plain" href="/stats/week">{t('widgets.week.more')}</Button>
		{/if}
	{/snippet}

	{#if view !== null}
		<WeekSummary {view} layout="compact" onretry={() => void load(workspaceId, true)} />
	{/if}
</WidgetCard>
