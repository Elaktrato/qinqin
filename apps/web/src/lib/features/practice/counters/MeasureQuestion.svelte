<script lang="ts">
	// One noun question of the measure-word (Chinese) and counter (Japanese) drills (#179): the noun with its gloss,
	// then its measure word or counter, typed through the IME (Enter checks once no composition is open) or chosen
	// after "Show choices". The component stays mounted across items: the field keeps its focus, read-only after an
	// answer, so the phone keyboard stays up and Enter moves on. Pinyin, bopomofo and romaji show only through the
	// romanisation setting (#284); kana always shows.
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { studyLang } from '$lib/i18n/lang';
	import { Button, Field } from '$lib/ui';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import { submitsAnswer } from '../conjugation/ime';
	import type { DrillQuestionProps } from '../types';
	import { checkMeasure, nounChoices, type Verdict } from './check';
	import { measureAnswer, otherAnswers, phraseOf, type NounItemData } from './nounItems';

	let { item, answered, onAnswer, onNext }: DrillQuestionProps = $props();

	const roman = useRomanisation();
	const data = $derived(item.data as NounItemData);
	const noun = $derived(data.noun);
	const chinese = $derived(noun.language !== 'ja');
	const lang = $derived(studyLang(noun.language));
	const nounReading = $derived(
		chinese ? (roman.shown(noun.readings)[0]?.value ?? '') : (noun.readings.find((r) => r.type === 'kana' && r.value !== noun.written)?.value ?? '')
	);
	const nounRomaji = $derived(!chinese && roman.shows('romaji') ? (noun.readings.find((r) => r.type === 'romaji')?.value ?? '') : '');
	const right = $derived(noun.measures[0]);

	let typed = $state('');
	let composing = $state(false);
	let choosing = $state(false);
	let verdict = $state<Verdict | null>(null);
	let picked = $state('');
	let problem = $state('');
	let field = $state<HTMLInputElement | HTMLTextAreaElement | undefined>();
	let options = $state<string[]>([]);

	// A new item: the component is not remounted, so it resets itself; the field keeps its focus.
	$effect(() => {
		void item.key;
		const d = item.data as NounItemData;
		typed = '';
		composing = false;
		choosing = false;
		verdict = null;
		picked = '';
		problem = '';
		options = nounChoices(d.noun, d.pool, Math.random);
		void tick().then(() => {
			if (document.activeElement === null || document.activeElement === document.body) field?.focus();
		});
	});

	function grade(v: Verdict, fromChoices: boolean): 1 | 2 | 3 {
		if (v === 'wrong') return 1;
		return fromChoices || v === 'fallback' ? 2 : 3;
	}

	function check(): void {
		if (answered || verdict !== null) return;
		const v = checkMeasure(typed, noun);
		if (v === 'unread') {
			problem = chinese ? t('practice.measureWords.typeFirst') : t('practice.counters.typeFirst');
			return;
		}
		problem = '';
		verdict = v;
		onAnswer({ mode: 'produce', grade: grade(v, false) });
	}

	function choose(option: string): void {
		if (answered || verdict !== null) return;
		picked = option;
		const v = checkMeasure(option, noun);
		verdict = v === 'unread' ? 'wrong' : v;
		onAnswer({ mode: 'choose', grade: grade(verdict, true) });
	}

	// A tap on a button leaves the focus in a focused field (the phone keyboard stays up).
	function keepFieldFocus(event: PointerEvent): void {
		if (document.activeElement === field) event.preventDefault();
	}

	function onkeydown(event: KeyboardEvent): void {
		if (!submitsAnswer(event, composing)) return;
		event.preventDefault();
		if (answered) onNext();
		else check();
	}

	const answerText = $derived(measureAnswer(right, roman));
	const also = $derived(otherAnswers(noun));
</script>

<div class="noun" {lang}>
	{#if chinese}
		<p class="prompt">一 <span class="gap">＿</span> {noun.written}</p>
	{:else}
		<p class="prompt">{noun.written}</p>
	{/if}
	{#if nounReading}<p class="reading">{nounReading}</p>{/if}
	{#if nounRomaji}<p class="reading">{nounRomaji}</p>{/if}
</div>
{#if noun.gloss}<p class="gloss">{noun.gloss}</p>{/if}

<p class="ask">{chinese ? t('practice.measureWords.ask') : t('practice.counters.ask')}</p>
{#if choosing}
	<div class="choices" role="group" aria-label={chinese ? t('practice.measureWords.choicesLabel') : t('practice.counters.choicesLabel')} {lang}>
		{#each options as option (option)}
			<Button
				variant={answered && option === right.written ? 'primary' : 'secondary'}
				disabled={answered}
				aria-pressed={picked === option}
				onclick={() => choose(option)}>{option}</Button
			>
		{/each}
	</div>
{:else}
	<div class="typed">
		<Field
			label={chinese ? t('practice.measureWords.answerLabel') : t('practice.counters.answerLabel')}
			hint={chinese ? t('practice.measureWords.answerHint') : t('practice.counters.answerHint')}
			bind:value={typed}
			bind:element={field}
			readonly={answered}
			{lang}
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
		{#if verdict === 'wrong'}
			{t('practice.counters.wrong', { answer: answerText })}
		{:else if verdict === 'fallback' && noun.fallback}
			{t('practice.measureWords.fallback', { fallback: noun.fallback.written, answer: answerText })}
		{:else if verdict === 'accepted'}
			{t('practice.counters.accepted', { answer: answerText })}
		{:else}
			{t('practice.counters.right', { answer: answerText })}
		{/if}
		{#if chinese}<span lang={lang}>{phraseOf(noun)}</span>{/if}
		{#if !chinese && right.counts}<span>{t('practice.counters.counts', { counts: right.counts })}</span>{/if}
		{#if also.length > 0}<span>{t('practice.counters.alsoRight', { list: also.join(t('practice.counters.listSeparator')) })}</span>{/if}
	</p>
{/if}

<style>
	.noun {
		display: grid;
		gap: var(--space-1);
	}
	.prompt {
		margin: 0;
		font-size: var(--font-size-xl);
		overflow-wrap: anywhere;
	}
	.gap {
		color: var(--readable-muted);
	}
	.reading,
	.gloss {
		margin: 0;
		color: var(--readable-muted);
		overflow-wrap: anywhere;
	}
	.ask {
		margin: 0;
		overflow-wrap: anywhere;
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
