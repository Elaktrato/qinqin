<script lang="ts">
	// One question of the counter-readings drill (#179): a number + counter (3本) with what the counter counts; the
	// reading typed in kana or romaji through the IME (Enter checks once no composition is open; text the IME turned
	// into kanji is not graded but asked again in kana), or chosen after "Show choices" (the common mistakes are the
	// wrong choices). The component stays mounted across items, the field keeps its focus and the phone keyboard
	// stays up. Kana always shows; romaji only through the romanisation setting (#284).
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { studyLang } from '$lib/i18n/lang';
	import { Button, Field } from '$lib/ui';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import { submitsAnswer } from '../conjugation/ime';
	import type { DrillQuestionProps } from '../types';
	import { checkReading, readingChoices, type Verdict } from './check';
	import type { ReadingItemData } from './readingItems';

	let { item, answered, onAnswer, onNext }: DrillQuestionProps = $props();

	const roman = useRomanisation();
	const JA = studyLang('ja');
	const data = $derived(item.data as ReadingItemData);
	const shown = $derived(data.number.answers[0]);
	const others = $derived(data.number.answers.slice(1).map((a) => a.reading));

	let typed = $state('');
	let composing = $state(false);
	let choosing = $state(false);
	let verdict = $state<Verdict | null>(null);
	let picked = $state('');
	let problem = $state('');
	let field = $state<HTMLInputElement | HTMLTextAreaElement | undefined>();
	let options = $state<string[]>([]);

	$effect(() => {
		void item.key;
		const d = item.data as ReadingItemData;
		typed = '';
		composing = false;
		choosing = false;
		verdict = null;
		picked = '';
		problem = '';
		options = readingChoices(d.number, d.counter, Math.random);
		void tick().then(() => {
			if (document.activeElement === null || document.activeElement === document.body) field?.focus();
		});
	});

	function check(): void {
		if (answered || verdict !== null) return;
		const v = checkReading(typed, data.number);
		if (v === 'unread' || v === 'kana') {
			problem = v === 'kana' ? t('practice.counterReadings.kanaPlease') : t('practice.counterReadings.typeFirst');
			return;
		}
		problem = '';
		verdict = v;
		onAnswer({ mode: 'produce', grade: v === 'wrong' ? 1 : 3 });
	}

	function choose(option: string): void {
		if (answered || verdict !== null) return;
		picked = option;
		verdict = checkReading(option, data.number) === 'wrong' ? 'wrong' : 'canonical';
		onAnswer({ mode: 'choose', grade: verdict === 'wrong' ? 1 : 2 });
	}

	function keepFieldFocus(event: PointerEvent): void {
		if (document.activeElement === field) event.preventDefault();
	}

	function onkeydown(event: KeyboardEvent): void {
		if (!submitsAnswer(event, composing)) return;
		event.preventDefault();
		if (answered) onNext();
		else check();
	}

	const answerText = $derived(`${data.number.written}【${shown.reading}】`);
</script>

<p class="counts">{t('practice.counterReadings.counts', { counts: data.counter.counts })}</p>
<p class="prompt" lang={JA}>{data.number.prompt}</p>
<p class="ask">{t('practice.counterReadings.ask')}</p>

{#if choosing}
	<div class="choices" role="group" aria-label={t('practice.counterReadings.choicesLabel')} lang={JA}>
		{#each options as option (option)}
			<Button
				variant={answered && option === shown.reading ? 'primary' : 'secondary'}
				disabled={answered}
				aria-pressed={picked === option}
				onclick={() => choose(option)}>{option}</Button
			>
		{/each}
	</div>
{:else}
	<div class="typed">
		<Field
			label={t('practice.counterReadings.answerLabel')}
			hint={t('practice.counterReadings.answerHint')}
			bind:value={typed}
			bind:element={field}
			readonly={answered}
			lang={JA}
			autocomplete="off"
			autocapitalize="off"
			spellcheck={false}
			enterkeyhint={answered ? 'next' : 'done'}
			{onkeydown}
			oncompositionstart={() => (composing = true)}
			oncompositionend={() => (composing = false)}
		/>
		{#if !answered}
			<div class="actions">
				<Button variant="primary" onpointerdown={keepFieldFocus} onclick={check}>{t('practice.counters.check')}</Button>
				<Button onclick={() => (choosing = true)}>{t('practice.counters.showChoices')}</Button>
			</div>
		{/if}
		<p class="problem">{#if problem}<span role="alert">{problem}</span>{/if}</p>
	</div>
{/if}

{#if answered && verdict !== null}
	<p class="verdict" class:wrong={verdict === 'wrong'} role="status">
		<span lang={JA}>
			{#if verdict === 'wrong'}
				{t('practice.counterReadings.wrong', { answer: answerText })}
			{:else if verdict === 'accepted'}
				{t('practice.counterReadings.accepted', { answer: answerText })}
			{:else}
				{t('practice.counterReadings.right', { answer: answerText })}
			{/if}
		</span>
		{#if roman.shows('romaji') && shown.romaji}<span class="romaji">{shown.romaji}</span>{/if}
		{#if others.length > 0}<span lang={JA}>{t('practice.counters.alsoRight', { list: others.join(t('practice.counters.listSeparator')) })}</span>{/if}
	</p>
{/if}

<style>
	.counts,
	.romaji {
		margin: 0;
		color: var(--readable-muted);
		overflow-wrap: anywhere;
	}
	.prompt {
		margin: 0;
		font-size: var(--font-size-xl);
		overflow-wrap: anywhere;
	}
	.ask {
		margin: 0;
	}
	.choices,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.typed {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}
	.problem {
		margin: 0;
		min-height: 1lh;
	}
	.verdict {
		margin: 0;
		display: grid;
		gap: var(--space-1);
		overflow-wrap: anywhere;
	}
	.verdict.wrong {
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
