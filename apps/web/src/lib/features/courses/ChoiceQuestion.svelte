<script lang="ts">
	// A check question of a lesson or test (#222): the prompt (a word to give the meaning of, a meaning to give the
	// word of, or a word to hear) and its choices. The run (run.svelte.ts) holds the answer; this shows it.
	import PlayButton from '$lib/components/PlayButton.svelte';
	import { studyLang } from '$lib/i18n/lang';
	import { t } from '$lib/i18n';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import type { Question, WordInfo } from './flow';

	let {
		question,
		word,
		language,
		deviceVoice,
		chosen,
		retry,
		onchoose
	}: {
		question: Question;
		word: WordInfo | undefined;
		language: string;
		deviceVoice: boolean;
		chosen: string | null;
		retry: boolean;
		onchoose: (choice: string) => void;
	} = $props();

	const roman = useRomanisation();
	const lang = $derived(studyLang(language) ?? language);
	const answered = $derived(chosen !== null);
	const reading = $derived(answered && word ? roman.text(word.reading, language) : '');
	const ASK = { meaning: 'courses.question.meaning', form: 'courses.question.form', listen: 'courses.question.listen' } as const;
</script>

<section class="question" aria-labelledby="question-{question.id}">
	<p class="ask" id="question-{question.id}">{t(ASK[question.type])}{#if retry}<span class="again">{t('courses.question.again')}</span>{/if}</p>
	{#if question.type === 'listen'}
		<PlayButton clips={[]} speakText={question.prompt} lang={language} {deviceVoice} label={t('courses.question.play')} />
	{:else}
		<p class="prompt" lang={question.type === 'meaning' ? lang : undefined}>{question.prompt}</p>
	{/if}
	{#if reading}<p class="reading">{word?.form} · {reading}</p>{/if}
	<ul class="choices">
		{#each question.choices as choice (choice)}
			{@const right = answered && choice === question.answer}
			{@const wrong = answered && choice === chosen && choice !== question.answer}
			<li>
				<button
					type="button"
					class="choice"
					class:right
					class:wrong
					lang={question.type === 'meaning' ? undefined : lang}
					disabled={answered}
					aria-pressed={choice === chosen}
					onclick={() => onchoose(choice)}
				>
					{choice}{#if right}<span class="mark"> · {t('courses.question.right')}</span>{:else if wrong}<span class="mark"> · {t('courses.question.wrong')}</span>{/if}
				</button>
			</li>
		{/each}
	</ul>
</section>

<style>
	.question {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.question p {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.ask,
	.reading {
		color: var(--readable-muted);
	}

	.again {
		margin-inline-start: var(--space-2);
		font-size: var(--font-size-label);
	}

	.prompt {
		font-size: var(--font-size-xl);
		text-align: center;
	}

	.choices {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}

	.choice {
		width: 100%;
		min-height: var(--hit);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: var(--panel);
		color: var(--text);
		font: inherit;
		font-size: var(--font-size-l);
		text-align: start;
		overflow-wrap: anywhere;
		cursor: pointer;
	}

	.choice:disabled {
		cursor: default;
	}

	.choice:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.choice.right {
		border-color: var(--good);
		border-width: 2px;
	}

	.choice.wrong {
		border-color: var(--bad);
		border-width: 2px;
	}

	.mark {
		font-size: var(--font-size-label);
	}
</style>
