<script lang="ts">
	// One conjugation question (#178): the word, then either the form to give (typed through the IME, Enter checks it
	// once no composition is open, "Show choices" swaps the field for four choices) or a form to name (four form
	// names). The component stays mounted across items: the field keeps its focus, read-only after an answer, so the
	// phone keyboard stays up and Enter moves on. Kana is always shown beside a kanji form; romaji only through the
	// romanisation setting (#284).
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { studyLang } from '$lib/i18n/lang';
	import { Button, Field } from '$lib/ui';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import type { DrillQuestionProps } from '../types';
	import { checkTyped, produceChoices, recogniseChoices, shownAnswer, type Verdict } from './check';
	import { submitsAnswer } from './ime';
	import { formLabel } from './labels';
	import type { ConjugationItemData } from './items';
	import type { ConjugationAnswer } from './words';

	let { item, answered, onAnswer, onNext }: DrillQuestionProps = $props();

	const roman = useRomanisation();
	const data = $derived(item.data as ConjugationItemData);
	const word = $derived(data.word);
	const answers = $derived(word.forms[data.form] ?? []);
	const shown = $derived(shownAnswer(answers));
	const wordRomaji = $derived(roman.shows('romaji') ? (word.readings.find((r) => r.type === 'romaji')?.value ?? '') : '');

	let typed = $state('');
	let composing = $state(false);
	let choosing = $state(false);
	let verdict = $state<Verdict | null>(null);
	let picked = $state('');
	let field = $state<HTMLInputElement | HTMLTextAreaElement | undefined>();
	let produceOptions = $state<string[]>([]);
	let recognise = $state<{ options: string[]; right: string[] }>({ options: [], right: [] });

	// A new item: the component is not remounted, so it resets itself; the field keeps its focus.
	$effect(() => {
		void item.key;
		const d = item.data as ConjugationItemData;
		typed = '';
		composing = false;
		choosing = false;
		verdict = null;
		picked = '';
		produceOptions = produceChoices(d.word, d.form, Math.random);
		recognise = recogniseChoices(d.word, d.form, Math.random);
		if (d.mode === 'produce') void tick().then(() => field?.focus());
	});

	const JA = studyLang('ja');
	function answerText(a: ConjugationAnswer): string {
		return a.written === a.reading ? a.written : `${a.written}【${a.reading}】`;
	}

	function check(): void {
		if (answered || verdict !== null) return;
		verdict = checkTyped(typed, answers);
		onAnswer({ mode: 'produce', grade: verdict === 'wrong' ? 1 : 3 });
	}

	function choose(choice: string): void {
		if (answered || verdict !== null) return;
		picked = choice;
		verdict = checkTyped(choice, answers) === 'wrong' ? 'wrong' : 'canonical';
		// Right from the choices is a right answer after a hint: Hard.
		onAnswer({ mode: data.mode, grade: verdict === 'wrong' ? 1 : data.mode === 'produce' ? 2 : 3 });
	}

	function chooseForm(form: string): void {
		if (answered || verdict !== null) return;
		picked = form;
		verdict = recognise.right.includes(form) ? 'canonical' : 'wrong';
		onAnswer({ mode: 'recognise', grade: verdict === 'wrong' ? 1 : 3 });
	}

	function onkeydown(event: KeyboardEvent): void {
		if (!submitsAnswer(event, composing)) return;
		event.preventDefault();
		if (answered) onNext();
		else check();
	}
</script>

<div class="word" lang={JA}>
	<p class="prompt" aria-label={t('practice.conjugation.dictionaryForm')}>{word.written}</p>
	{#if word.reading !== word.written}<p class="kana">{word.reading}</p>{/if}
	{#if wordRomaji}<p class="romaji" >{wordRomaji}</p>{/if}
</div>

{#if data.mode === 'produce'}
	<p class="ask">{t('practice.conjugation.produce')} <strong>{formLabel(data.form)}</strong></p>
	{#if choosing}
		<div class="choices" role="group" aria-label={t('practice.conjugation.choicesLabel')} lang={JA}>
			{#each produceOptions as option (option)}
				<Button
					variant={answered && option === shown.written ? 'primary' : 'secondary'}
					disabled={answered}
					aria-pressed={picked === option}
					onclick={() => choose(option)}>{option}</Button
				>
			{/each}
		</div>
	{:else}
		<div class="typed">
			<Field
				label={t('practice.conjugation.answerLabel')}
				hint={t('practice.conjugation.answerHint')}
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
					<Button variant="primary" onclick={check}>{t('practice.conjugation.check')}</Button>
					<Button onclick={() => (choosing = true)}>{t('practice.conjugation.showChoices')}</Button>
				</div>
			{/if}
		</div>
	{/if}
{:else}
	<p class="ask">{t('practice.conjugation.recognise')}</p>
	<p class="form" lang={JA}>{shown.written}</p>
	{#if shown.reading !== shown.written}<p class="kana" lang={JA}>{shown.reading}</p>{/if}
	{#if roman.shows('romaji') && shown.romaji}<p class="romaji">{shown.romaji}</p>{/if}
	<div class="choices" role="group" aria-label={t('practice.conjugation.choicesLabel')}>
		{#each recognise.options as option (option)}
			<Button
				variant={answered && recognise.right.includes(option) ? 'primary' : 'secondary'}
				disabled={answered}
				aria-pressed={picked === option}
				onclick={() => chooseForm(option)}>{formLabel(option)}</Button
			>
		{/each}
	</div>
{/if}

{#if answered && verdict !== null}
	<p class="verdict" class:wrong={verdict === 'wrong'} role="status">
		{#if verdict === 'wrong' && data.mode === 'recognise'}
			{t('practice.conjugation.wrongForm', { form: recognise.right.map(formLabel).join(' / ') })}
		{:else if verdict === 'wrong'}
			{t('practice.conjugation.wrong', { answer: answerText(shown) })}
		{:else if verdict === 'accepted'}
			{t('practice.conjugation.accepted', { answer: answerText(shown) })}
		{:else}
			{t('practice.conjugation.right')}
		{/if}
		{#if data.mode === 'produce' && roman.shows('romaji') && shown.romaji}<span class="romaji">{shown.romaji}</span>{/if}
	</p>
{/if}

<style>
	.word {
		display: grid;
		gap: var(--space-1);
	}
	.prompt,
	.form {
		margin: 0;
		font-size: var(--font-size-xl);
		overflow-wrap: anywhere;
	}
	.kana,
	.romaji {
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
