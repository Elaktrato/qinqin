<script lang="ts">
	// The tone-pair grid on the Practice list (#180): the 20 pairs, a row per first tone, each with its accuracy over
	// its last answers and its band in words (new, weak, fair, strong), so weak pairs stand out without colour; a pair
	// without words is dimmed. "Practise my weakest pairs" is the drill's own weakest round. Tone numbers only, no
	// reading.
	import { t } from '$lib/i18n';
	import { formatPercent } from '$lib/i18n/format';
	import { Button } from '$lib/ui';
	import { pairAccuracy, pairTones, TONE_PAIRS, ACCURACY_WINDOW, type PairBand } from '$lib/exercises/tonePairs';
	import { TONE_GLYPHS } from '$lib/exercises/tones';
	import { practiceHref } from '../route';
	import type { DrillOverviewProps } from '../types';

	let { drill, items, answers }: DrillOverviewProps = $props();

	const offered = $derived(new Set(items.map((i) => i.key)));
	const cells = $derived(
		TONE_PAIRS.map((key) => {
			const grades = answers.filter((a) => a.item === key).map((a) => a.grade);
			const tones = pairTones(key)!;
			return { key, tones, has: offered.has(key), ...pairAccuracy(grades) };
		})
	);
	const rows = $derived([0, 1, 2, 3].map((r) => cells.slice(r * 5, r * 5 + 5)));
	const answered = $derived(cells.some((c) => c.answers > 0 && c.has));

	const BAND: Record<PairBand, () => string> = {
		new: () => t('practice.tonePairs.band.new'),
		weak: () => t('practice.tonePairs.band.weak'),
		fair: () => t('practice.tonePairs.band.fair'),
		strong: () => t('practice.tonePairs.band.strong')
	};

	function percent(accuracy: number | null): string {
		return accuracy === null ? '' : formatPercent(accuracy, { maximumFractionDigits: 0 });
	}

	function cellLabel(cell: (typeof cells)[number]): string {
		if (!cell.has) return t('practice.tonePairs.cell.noWords', { pair: cell.key });
		if (cell.accuracy === null) return t('practice.tonePairs.cell.new', { pair: cell.key });
		return t('practice.tonePairs.cell.label', {
			pair: cell.key,
			percent: percent(cell.accuracy),
			count: cell.answers,
			band: BAND[cell.band]()
		});
	}
</script>

<section class="grid" aria-labelledby="tone-pair-grid">
	<h3 id="tone-pair-grid">{t('practice.tonePairs.grid.title')}</h3>
	<ul class="rows">
		{#each rows as row, r (r)}
			<li>
				<ul class="row" aria-label={t('practice.tonePairs.grid.row', { tone: r + 1 })}>
					{#each row as cell (cell.key)}
						<li class="cell band-{cell.band}" class:none={!cell.has} aria-label={cellLabel(cell)} data-pair={cell.key}>
							<span class="pair" aria-hidden="true">{cell.tones[0]}{TONE_GLYPHS[cell.tones[0]]}{cell.tones[1]}{TONE_GLYPHS[cell.tones[1]]}</span>
							<span class="value" aria-hidden="true">{cell.has ? (cell.accuracy === null ? BAND.new() : percent(cell.accuracy)) : '–'}</span>
							{#if cell.has && cell.accuracy !== null}<span class="band" aria-hidden="true">{BAND[cell.band]()}</span>{/if}
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ul>
	<p class="legend">{t('practice.tonePairs.grid.legend', { n: ACCURACY_WINDOW })}</p>
	{#if answered}
		<Button href={practiceHref({ view: 'drillWeakest', drill: drill.id })}>{t('practice.tonePairs.weakest')}</Button>
	{/if}
</section>

<style>
	.grid {
		margin-top: var(--space-3);
	}
	h3 {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-m);
	}
	.rows,
	.row {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows {
		display: grid;
		gap: var(--space-1);
	}
	.row {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: var(--space-1);
	}
	.cell {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 0.125rem;
		min-width: 0;
		min-height: 3.5rem;
		padding: var(--space-1) 0.125rem;
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		text-align: center;
		overflow-wrap: anywhere;
	}
	.pair {
		font-weight: var(--weight-strong);
		white-space: nowrap;
	}
	.value,
	.band {
		font-size: var(--font-size-xs);
	}
	.band {
		color: var(--readable-muted);
	}
	.cell.band-weak {
		border-color: var(--bad);
		border-width: 2px;
	}
	.cell.band-weak .band {
		color: var(--readable-bad);
		font-weight: var(--weight-strong);
	}
	.cell.band-strong {
		border-color: var(--good);
	}
	.cell.none {
		color: var(--readable-muted);
		border-style: dashed;
	}
	.legend {
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}
	@media (forced-colors: active) {
		.cell.band-weak {
			border: 3px solid Highlight;
		}
	}
</style>
