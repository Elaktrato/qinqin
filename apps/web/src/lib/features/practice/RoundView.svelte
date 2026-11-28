<script lang="ts">
	// One round: the drill's question for each entry, Next, then the result. The question component stays mounted
	// across items (a typed answer keeps focus); after an answer the Next button takes the focus only when the focus
	// was lost (the answer buttons went away), never from a field.
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { Button } from '$lib/ui';
	import { PracticeRound, type RecordAnswer } from './round.svelte';
	import type { DrillAnswerInput, DrillDef, RoundEntry } from './types';

	let {
		title,
		entries,
		drills,
		record,
		backHref,
		onAgain
	}: {
		title: string;
		entries: readonly RoundEntry[];
		drills: readonly DrillDef[];
		record: RecordAnswer;
		backHref: string;
		onAgain: () => void;
	} = $props();

	// The round is fixed when the view mounts (a new round is a new view).
	// svelte-ignore state_referenced_locally
	const round = new PracticeRound(entries, record);
	const current = $derived(round.current);
	const def = $derived(current === null ? undefined : drills.find((d) => d.id === current.drill));
	let nextButton = $state<HTMLElement | undefined>();

	async function answer(input: DrillAnswerInput): Promise<void> {
		const pending = round.answer(input);
		await tick();
		const active = document.activeElement;
		if (active === null || active === document.body) nextButton?.focus();
		await pending;
	}

	function next(): void {
		round.next();
	}

	// A tap on Next leaves the focus in a typed answer field (the next question clears it), so the phone keyboard stays
	// up between questions.
	function keepFieldFocus(event: PointerEvent): void {
		const active = document.activeElement;
		if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) event.preventDefault();
	}

	function labelOf(entry: RoundEntry): string {
		return drills.find((d) => d.id === entry.drill)?.label(entry.item) ?? entry.item.key;
	}
</script>

<h1>{title}</h1>
{#if round.entries.length === 0}
	<p>{t('practice.round.empty')}</p>
	<Button href={backHref}>{t('practice.round.back')}</Button>
{:else if round.done}
	{@const result = round.result}
	<section class="result" aria-labelledby="practice-result">
		<h2 id="practice-result">{t('practice.result.title')}</h2>
		<p role="status">{t('practice.result.score', { right: String(result.right), total: String(result.total) })}</p>
		{#if result.missed.length > 0}
			<h3>{t('practice.result.missed')}</h3>
			<ul class="missed">
				{#each result.missed as entry (`${entry.drill}:${entry.item.key}`)}
					<li>{labelOf(entry)}</li>
				{/each}
			</ul>
		{/if}
		{#if round.notSaved}<p class="error" role="alert">{t('practice.round.notSaved')}</p>{/if}
		<div class="actions">
			<Button variant="primary" onclick={onAgain}>{t('practice.result.again')}</Button>
			<Button href={backHref}>{t('practice.round.back')}</Button>
		</div>
	</section>
{:else if current !== null && def !== undefined}
	{@const Question = def.question}
	<p class="position">{t('practice.round.position', { n: String(round.position.n), of: String(round.position.of) })}</p>
	<div class="question">
		<Question item={current.item} answered={round.answered} onAnswer={(a) => void answer(a)} onNext={next} />
	</div>
	{#if round.answered}
		<div class="actions">
			<Button variant="primary" bind:element={nextButton} onpointerdown={keepFieldFocus} onclick={next}>
				{round.position.n === round.position.of ? t('practice.round.finish') : t('practice.round.next')}
			</Button>
		</div>
	{/if}
	{#if round.notSaved}<p class="error" role="alert">{t('practice.round.notSaved')}</p>{/if}
{/if}

<style>
	.position {
		color: var(--readable-muted);
	}
	.question {
		display: grid;
		gap: var(--space-3);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.missed {
		overflow-wrap: anywhere;
	}
</style>
