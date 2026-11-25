<script lang="ts">
	// One writing system: its progress, the practice modes and the chart. A cell opens its detail (sound, key,
	// notes); Hangul also shows how a syllable block is built.
	import { t } from '$lib/i18n';
	import { formatNumber } from '$lib/i18n/format';
	import PlayButton from '$lib/components/PlayButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Section from '$lib/ui/Section.svelte';
	import Stat from '$lib/ui/Stat.svelte';
	import Tabs from '$lib/ui/Tabs.svelte';
	import { chartGroups, type ChartCell } from './chart';
	import { groupLabel, keyboardNote, masteryLabel, modeHint, modeLabel, systemLabel } from './labels';
	import { summarise, type ItemState } from './progress';
	import { scriptsHref } from './route';
	import SyllableBuilder from './SyllableBuilder.svelte';
	import { MODES, type ScriptItem, type ScriptSystem } from './types';

	let {
		system,
		systems,
		progress,
		deviceVoice
	}: {
		system: ScriptSystem;
		systems: readonly ScriptSystem[];
		progress: ReadonlyMap<string, ItemState>;
		deviceVoice: boolean;
	} = $props();

	const now = Date.now();
	const summary = $derived(summarise(system.items, progress, now));
	const groups = $derived(chartGroups(system, progress, now));
	const tabs = $derived(systems.map((s) => ({ id: s.id, label: systemLabel(s.id), href: scriptsHref({ view: 'overview', system: s.id }) })));

	let openId = $state<string | null>(null);
	const open = $derived(system.items.find((i) => i.id === openId) ?? null);

	const cellLabel = (c: ChartCell): string =>
		t(c.due ? 'scripts.cell.labelDue' : 'scripts.cell.label', {
			glyph: c.item.glyph,
			roman: c.item.roman,
			mastery: masteryLabel(c.mastery)
		});

	function toggle(item: ScriptItem): void {
		openId = openId === item.id ? null : item.id;
	}
</script>

{#if systems.length > 1}
	<Tabs label={t('scripts.systems.label')} {tabs} selected={system.id} />
{/if}

<div class="summary">
	<Stat value={`${formatNumber(summary.known)} / ${formatNumber(summary.total)}`} label={t('scripts.summary.known', { known: formatNumber(summary.known), total: formatNumber(summary.total) })} />
	{#if summary.due > 0}
		<p class="due">{t('scripts.summary.due', { count: summary.due })}</p>
	{/if}
</div>

<Section title={t('scripts.practice.title')}>
	<ul class="modes">
		{#each MODES as mode (mode)}
			<li>
				<Button variant={mode === 'recognise' ? 'primary' : 'secondary'} href={scriptsHref({ view: 'practice', system: system.id, mode })}>{modeLabel(mode)}</Button>
				<span class="hint">{modeHint(mode)}</span>
			</li>
		{/each}
	</ul>
	<p class="hint">{keyboardNote(system.id)}</p>
</Section>

<Section title={t('scripts.chart.title')}>
	<ul class="legend">
		{#each ['unseen', 'learning', 'known'] as const as m (m)}
			<li data-mastery={m}><span class="mark" aria-hidden="true">{m === 'known' ? '✓' : m === 'learning' ? '·' : ''}</span>{masteryLabel(m)}</li>
		{/each}
	</ul>

	{#each groups as group (group.id)}
		<h3 class="group">{groupLabel(group.id)}</h3>
		<ul class="cells">
			{#each group.cells as cell (cell.item.id)}
				<li>
					<button type="button" class="cell" data-mastery={cell.mastery} data-due={cell.due} aria-pressed={openId === cell.item.id} aria-label={cellLabel(cell)} lang={system.language} onclick={() => toggle(cell.item)}>
						<span class="glyph" aria-hidden="true">{cell.item.glyph}</span>
						<span class="roman" aria-hidden="true">{cell.item.roman}</span>
						<span class="mark" aria-hidden="true">{cell.mastery === 'known' ? '✓' : cell.mastery === 'learning' ? '·' : ''}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/each}

	{#if open}
		<div class="detail" role="region" aria-live="polite" aria-label={open.glyph}>
			<span class="big" lang={system.language}>{open.lower === undefined ? open.glyph : `${open.glyph} ${open.lower}`}</span>
			<span class="sound">{open.roman}</span>
			<PlayButton clips={[]} speakText={open.sound} lang={system.language} {deviceVoice} label={open.glyph} />
			{#if open.key}<p class="note">{t('scripts.detail.keyboard', { key: open.key })}</p>{/if}
			{#if open.lookalike}<p class="note">{t('scripts.detail.lookalike')}</p>{/if}
			{#if open.note}<p class="note" >{open.note}</p>{/if}
		</div>
	{/if}
</Section>

{#if system.id === 'hangul'}
	<SyllableBuilder {system} {deviceVoice} />
{/if}

<style>
	.summary {
		display: flex;
		align-items: baseline;
		gap: var(--space-4);
		margin-block: var(--space-3);
	}

	.due,
	.hint,
	.note {
		margin: 0;
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}

	.modes,
	.legend,
	.cells {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.modes li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding-block: var(--space-1);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.group {
		margin-block: var(--space-4) var(--space-2);
		font-size: var(--font-size-m);
	}

	.cells {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(4.25rem, 1fr));
		gap: var(--space-2);
	}

	.cell {
		position: relative;
		display: grid;
		justify-items: center;
		width: 100%;
		min-height: var(--hit);
		padding: var(--space-2) var(--space-1);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.cell[data-mastery='known'] {
		background: var(--primary-wash);
	}

	.cell[data-mastery='learning'] {
		border-style: dashed;
	}

	.cell[data-due='true'] {
		border-color: var(--text);
	}

	.cell[aria-pressed='true'] {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.cell:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.glyph {
		font-size: var(--font-size-xl);
		line-height: var(--line-tight);
	}

	.roman {
		font-size: var(--font-size-xs);
		color: var(--readable-muted);
	}

	.mark {
		margin-inline-end: var(--space-1);
	}

	.cell .mark {
		position: absolute;
		inset-block-start: 0;
		inset-inline-end: var(--space-1);
		margin: 0;
		color: var(--good);
	}

	.detail {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-block-start: var(--space-4);
		padding-block-start: var(--space-3);
		border-top: 1px solid var(--hair);
	}

	.detail .note {
		flex-basis: 100%;
	}

	.big {
		font-size: var(--font-size-xxl);
	}

	.sound {
		font-size: var(--font-size-l);
	}
</style>
