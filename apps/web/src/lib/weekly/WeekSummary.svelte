<script lang="ts">
	// One week's summary. Two layouts:
	//   'page' (Stats → Week): four Stats (reviews, new cards, study time,
	//     journal — reading when the journal row is absent), the paired bars,
	//     the milestone line and every other row as a hairline list;
	//   'compact' (the home widget): today's rows and the seven-day strip.
	// Every word and number comes from weekText.ts (summaryLines); this
	// component only lays them out.
	import { MILESTONE_TEXT } from '$lib/milestones/milestoneText';
	import { t } from '$lib/i18n';
	import { milestonesInWeek, type HistoryItem } from '$lib/milestones/plan';
	import Button from '$lib/ui/Button.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Stat from '$lib/ui/Stat.svelte';
	import type { WeekView } from './loadWeek';
	import WeekBars from './WeekBars.svelte';
	import WeekStrip from './WeekStrip.svelte';
	import {
		compareWindowText,
		offlineText,
		summaryLines,
		weekRangeShort,
		type CharactersState,
		type SummaryLine
	} from './weekText';

	interface Props {
		view: WeekView;
		/** 'pending' while counting, 'unavailable' offline, null when not shown. */
		characters?: CharactersState;
		/** 'page' (Stats → Week) or 'compact' (the home widget). */
		layout?: 'page' | 'compact';
		/** Retry the activity request (offline). */
		onretry?: () => void;
		/** The milestones history (Stats → Week): its items of the shown week make a line. */
		milestones?: { items: HistoryItem[]; titles: ReadonlyMap<string, string> };
		locale?: string;
	}

	let { view, characters = null, layout = 'page', onretry, milestones, locale }: Props = $props();

	const compact = $derived(layout === 'compact');

	const weekMilestones = $derived(
		milestones === undefined || compact
			? null
			: milestonesInWeek(milestones.items, view.summary.monday).flatMap((item) => {
					const title = milestones.titles.get(item.id);
					return title === undefined ? [] : [title];
				})
	);

	const lines = $derived(summaryLines(view.summary, view.sources, characters, compact));
	const offline = $derived(offlineText(view.activityError !== null, characters === 'unavailable'));
	// A browsed past week names its own dates; the current week keeps "this week".
	const shownRange = $derived(weekRangeShort(view.summary.monday, locale));
	const ARROW = { up: '▲', down: '▼', same: '=' } as const;

	// The page's four numbers: reviews, new cards, study time and journal. The
	// journal row is always in the summary (contract), even offline when the
	// activity sources are unknown; only a summary that really lacks the row
	// makes room for reading. `view.sources` must not decide this: it is empty
	// when the activity request failed.
	const statIds = $derived.by(() => {
		if (compact) return [];
		const present = new Set(lines.map((line) => line.id));
		const preferred = ['reviews', 'newCards', 'studyTime', present.has('journal') ? 'journal' : 'reading'];
		const rest = lines.map((line) => line.id).filter((id) => !preferred.includes(id));
		return [...preferred, ...rest].filter((id) => present.has(id)).slice(0, 4);
	});
	const stats = $derived<SummaryLine[]>(
		statIds.map((id) => lines.find((line) => line.id === id)).filter((line): line is SummaryLine => line !== undefined)
	);
	const moreLines = $derived(compact ? [] : lines.filter((line) => !statIds.includes(line.id)));

	function change(line: SummaryLine): { text: string; direction: 'up' | 'down' | 'same' } | undefined {
		return line.comparison !== null && line.trend !== null
			? { text: line.comparison, direction: line.trend }
			: undefined;
	}
</script>

<div class="week-summary" class:compact>
	{#if view.summary.inProgress || view.summary.allVacation}
		<p class="labels">
			{#if view.summary.inProgress}<Chip>{t('weekly.badge.inProgress')}</Chip>{/if}
			{#if view.summary.allVacation}<Chip>{t('weekly.badge.allVacation')}</Chip>{/if}
		</p>
	{/if}
	{#if offline !== null}
		<p class="offline" role="status">
			{offline}
			{#if onretry}<Button variant="secondary" type="button" onclick={onretry}>{t('weekly.retry')}</Button>{/if}
		</p>
	{/if}
	<p class="window">{compareWindowText(view.summary, locale)}</p>

	{#if compact}
		<dl>
			{#each lines as line (line.id)}
				<div class="row">
					<dt>{line.term}</dt>
					<dd>
						<span class="value">{line.value}</span>
						{#if line.comparison !== null}
							<span class="cmp">
								{#if line.trend !== null}<span class="arrow" aria-hidden="true">{ARROW[line.trend]}</span>{/if}
								{line.comparison}
							</span>
						{/if}
					</dd>
				</div>
			{/each}
		</dl>
		<WeekStrip days={view.summary.days} {locale} />
	{:else}
		<div class="stats">
			{#each stats as line (line.id)}
				<Stat value={line.value} label={line.term} change={change(line)} />
			{/each}
		</div>

		<WeekBars summary={view.summary} {locale} />

		{#if weekMilestones !== null}
			<p class="milestone-line">
				{view.summary.inProgress
					? t('weekly.page.milestoneLine', {
							titles: weekMilestones.length > 0 ? weekMilestones.join(', ') : MILESTONE_TEXT.none
						})
					: t('weekly.page.milestoneLinePast', {
							range: shownRange,
							titles: weekMilestones.length > 0 ? weekMilestones.join(', ') : MILESTONE_TEXT.none
						})}
			</p>
		{/if}

		{#if moreLines.length > 0}
			<h3 class="more-title">
				{view.summary.inProgress ? t('weekly.page.more') : t('weekly.page.morePast', { range: shownRange })}
			</h3>
			<dl class="more">
				{#each moreLines as line (line.id)}
					<div class="row">
						<dt>{line.term}</dt>
						<dd>
							<span class="value">{line.value}</span>
							{#if line.comparison !== null}
								<span class="cmp">
									{#if line.trend !== null}<span class="arrow" aria-hidden="true">{ARROW[line.trend]}</span>{/if}
									{line.comparison}
								</span>
							{/if}
						</dd>
					</div>
				{/each}
			</dl>
		{/if}
	{/if}
</div>

<style>
	.week-summary {
		display: grid;
		gap: var(--space-2);
	}

	.labels {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-2) 0 0;
	}

	.window {
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.offline {
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-s);
	}

	.offline {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	/* Four numbers from 720 px, two by two on the phone (design §9). */
	.stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-5) var(--space-4);
		margin-top: var(--space-4);
	}

	@media (max-width: 719px) {
		.stats :global(.value) {
			font-size: 1.6rem;
		}
	}

	@media (min-width: 720px) {
		.stats {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.milestone-line {
		margin: var(--space-4) 0 0;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.more-title {
		margin: var(--space-5) 0 0;
		font-size: var(--font-size-label);
		font-weight: var(--weight-strong);
		color: var(--readable-muted);
	}

	dl {
		display: grid;
		gap: 0.45rem;
		margin: 0.75rem 0 0;
	}

	.more {
		gap: 0;
		margin-top: var(--space-2);
	}

	.row {
		display: grid;
		grid-template-columns: minmax(8rem, 1fr) 2fr;
		gap: 0.75rem;
	}

	.compact .row {
		grid-template-columns: minmax(6rem, 1fr) 2fr;
	}

	.more .row {
		padding: var(--space-2) 0;
		border-top: 1px solid var(--hair);
	}

	dt {
		font-weight: var(--weight-medium);
	}

	dd {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.75rem;
	}

	.value {
		font-variant-numeric: tabular-nums;
	}

	.cmp {
		font-size: var(--font-size-s);
	}

	.arrow {
		margin-right: 0.2rem;
	}
</style>
