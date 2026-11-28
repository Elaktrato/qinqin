<script lang="ts">
	// The Practice list: "Practise weakest" across the drills, then each drill with its counts and a round.
	import { t } from '$lib/i18n';
	import { Button, Section } from '$lib/ui';
	import { formatNumber } from '$lib/i18n/format';
	import { NOTEBOOK_HREF } from '$lib/notebook/href';
	import { practiceHref } from './route';
	import type { DrillAnswer, DrillStates } from '$lib/studycore/drills';
	import type { DrillSummary } from './overview';
	import type { DrillDef, DrillItem } from './types';

	let {
		summaries,
		weakestCount,
		states,
		now
	}: {
		summaries: readonly { drill: DrillDef; summary: DrillSummary; items: readonly DrillItem[]; answers: readonly DrillAnswer[] }[];
		weakestCount: number;
		states: DrillStates;
		now: number;
	} = $props();
</script>

<h1>{t('practice.title')}</h1>
{#if summaries.length === 0}
	<p>{t('practice.none')}</p>
{:else}
	<p class="intro">{t('practice.intro')}</p>
	<p><a href={NOTEBOOK_HREF}>{t('study.notebook.link')}</a></p>
	<Section title={t('practice.weakest.title')}>
		{#if weakestCount > 0}
			<p>{t('practice.weakest.text', { count: weakestCount })}</p>
			<Button variant="primary" href={practiceHref({ view: 'weakest' })}>{t('practice.weakest.start')}</Button>
		{:else}
			<p class="muted">{t('practice.weakest.empty')}</p>
		{/if}
	</Section>
	<ul class="drills">
		{#each summaries as { drill, summary, items, answers } (drill.id)}
			<li class="drill">
				<h2>{drill.title}</h2>
				<p class="muted">{drill.description}</p>
				{#if summary.total === 0}
					<p class="muted">{t('practice.drill.noItems')}</p>
				{:else}
					<p class="counts">
						<span>{t('practice.drill.due', { n: formatNumber(summary.due) })}</span>
						<span>{t('practice.drill.fresh', { n: formatNumber(summary.fresh) })}</span>
						<span>{t('practice.drill.seen', { n: formatNumber(summary.seen) })}</span>
					</p>
					<Button href={practiceHref({ view: 'drill', drill: drill.id })}>{t('practice.drill.start')}</Button>
				{/if}
				{#if drill.overview !== undefined}
					{@const Overview = drill.overview}
					<Overview {drill} {items} {answers} {states} {now} />
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.intro,
	.muted {
		color: var(--readable-muted);
	}
	.drills {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
	}
	.drill + .drill {
		border-top: 1px solid var(--hair);
	}
	.drill {
		padding-block: var(--space-3);
	}
	.drill h2 {
		margin: 0;
		font-size: var(--font-size-l);
		overflow-wrap: anywhere;
	}
	.drill p {
		overflow-wrap: anywhere;
	}
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
	}
</style>
