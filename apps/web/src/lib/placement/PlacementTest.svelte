<script lang="ts">
	// The placement test (#74): one item at a time, "I know it" or "Not sure",
	// then a result the learner can change before anything is marked. The
	// algorithm is pure (./placement.ts); this component only asks, shows and
	// reports the confirmed level (a position in `levels`) through
	// `onconfirm`. Nothing is written here.
	import { t } from '$lib/i18n';
	import { Button, Select } from '$lib/ui';
	import type { EntryBase } from '$lib/api/types';
	import SelfAssessQuestion from './SelfAssessQuestion.svelte';
	import { newMarks, rangeEntries, type LevelMembers } from './declare';
	import { answer, currentItem, placementResult, startPlacement, type PlacementState } from './placement';

	let {
		levels,
		entries,
		unit,
		language,
		marked,
		busy = false,
		seed = Math.floor(Math.random() * 2 ** 32),
		onconfirm,
		oncancel
	}: {
		/** Non-empty levels in level order. */
		levels: readonly LevelMembers[];
		entries: ReadonlyMap<number, EntryBase>;
		unit: 'word' | 'character';
		language: string;
		marked: ReadonlySet<number>;
		/** A declaration is being written: the confirm button waits. */
		busy?: boolean;
		seed?: number;
		onconfirm: (position: number) => void;
		oncancel: () => void;
	} = $props();

	const counts = (): number[] => levels.map((l) => l.entryIds.length);
	let attempt = $state(0);
	// The levels and the seed are fixed for the life of the component: a new scheme remounts it.
	// svelte-ignore state_referenced_locally
	let test = $state.raw<PlacementState>(startPlacement({ counts: counts(), seed }));
	const item = $derived(currentItem(test));
	const result = $derived(placementResult(test));
	const entry = $derived(item === null ? null : entries.get(levels[item.level - 1].entryIds[item.index]));
	let chosen = $state<number | null>(null);
	const position = $derived(chosen ?? result.placed);

	const options = $derived([
		{ value: '0', label: t('settings.placement.nothing') },
		...levels.map((level, i) => ({ value: String(i + 1), label: level.name }))
	]);
	const fresh = $derived(newMarks(rangeEntries(levels, position), marked).length);

	function reply(known: boolean): void {
		test = answer(test, known);
	}

	function again(): void {
		attempt += 1;
		chosen = null;
		test = startPlacement({ counts: counts(), seed: seed + attempt * 7919 });
	}
</script>

{#if !result.done && entry}
	<SelfAssessQuestion
		written={entry.written}
		{language}
		{unit}
		progress={t('settings.placement.progress', { n: result.answered + 1 })}
		cancelLabel={t('settings.placement.cancel')}
		onreply={reply}
		oncancel={oncancel}
	/>
{:else}
	<div class="test" data-testid="placement-result">
		<h4 class="result-title">{t('settings.placement.resultTitle')}</h4>
		<p>
			{result.placed === 0
				? t('settings.placement.noneKnown')
				: t('settings.placement.resultLevel', { level: levels[result.placed - 1].name })}
		</p>
		<p class="hint">{t('settings.placement.estimate', { count: result.answered })}</p>
		<Select
			label={t('settings.known.upTo')}
			value={String(position)}
			{options}
			onchange={(e) => (chosen = Number((e.currentTarget as HTMLSelectElement).value))}
		/>
		<p class="hint" aria-live="polite">
			{position === 0 || fresh === 0 ? t('settings.known.nothingNew') : t('settings.known.preview', { count: fresh })}
		</p>
		<div class="row">
			<Button variant="primary" {busy} disabled={busy || fresh === 0} onclick={() => onconfirm(position)} data-testid="placement-confirm">
				{t('settings.known.mark')}
			</Button>
			<Button onclick={again}>{t('settings.placement.retake')}</Button>
			<Button variant="plain" onclick={oncancel}>{t('settings.placement.skip')}</Button>
		</div>
	</div>
{/if}

<style>
	.test {
		display: grid;
		gap: var(--space-2);
		max-width: 28rem;
	}
	.hint {
		margin: 0;
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.result-title {
		margin: 0;
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
	}
</style>
