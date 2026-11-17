<script lang="ts">
	import { t } from '$lib/i18n';
	import { tick } from 'svelte';
	import { segmentBatch } from '$lib/api/segment';
	import { loadTokens } from '$lib/study/wordSalad';
	import { workspaces } from '$lib/workspaces';
	import WordSaladBoard from '$lib/features/flashcards/cards/WordSaladBoard.svelte';
	import ClozeChoice from '$lib/components/ClozeChoice.svelte';
	import { buildExercises, clozeParts, firstTry, type Exercise } from './exercises';
	import { loadDisplayLesson, type DisplayLesson } from './lessonData';
	import { recordRun } from './progress';
	import { grammarHref } from './route';
	import type { Progress } from './types';
	// (attempt 0 keeps the plain lesson seed; a retry shuffles anew)

	let { pack, lessonId }: { pack: string; lessonId: string } = $props();

	let data = $state<DisplayLesson | null>(null);
	let status = $state<'loading' | 'ready' | 'missing' | 'error'>('loading');

	$effect(() => {
		let cancelled = false;
		status = 'loading';
		void loadDisplayLesson(pack, lessonId).then(
			(result) => {
				if (cancelled) return;
				data = result;
				status = result === null ? 'missing' : 'ready';
			},
			() => {
				if (!cancelled) status = 'error';
			}
		);
		return () => {
			cancelled = true;
		};
	});

	const language = $derived(data?.view.pack.language ?? '');
	const textLang = $derived(data?.textLang ?? '');
	let attempt = $state(0);
	const exercises = $derived<Exercise[]>(
		data ? buildExercises(data.lesson, attempt === 0 ? data.lesson.id : `${data.lesson.id}:${attempt}`) : []
	);
	let index = $state(0);
	// Per exercise: null while open, then right on the first try or not.
	let results = $state<(boolean | null)[]>([]);
	let tokens = $state<string[] | null>(null);
	let nextButton = $state<HTMLButtonElement | null>(null);
	let instruction = $state<HTMLElement | null>(null);
	let saved = $state<Progress | null>(null);
	let saveError = $state('');

	$effect(() => {
		results = exercises.map(() => null);
		index = 0;
	});

	const current = $derived<Exercise | null>(exercises[index] ?? null);
	const answered = $derived(results[index] !== null && results[index] !== undefined);
	const finished = $derived(exercises.length > 0 && index >= exercises.length);
	const score = $derived(results.filter((r) => r === true).length);

	// Word order needs the sentence cut into tiles.
	$effect(() => {
		const ex = current;
		tokens = null;
		if (ex === null || ex.kind !== 'order') return;
		let cancelled = false;
		void loadTokens(language, ex.example.text, (l, t) => segmentBatch(l, t)).then((t) => {
			if (!cancelled) tokens = t;
		});
		return () => {
			cancelled = true;
		};
	});

	async function record(right: boolean): Promise<void> {
		results[index] = right;
		await tick();
		nextButton?.focus();
	}

	async function advance(): Promise<void> {
		index += 1;
		if (index >= exercises.length) {
			await saveResult();
			return;
		}
		// The button that was pressed is gone: hand focus to the new exercise.
		await tick();
		instruction?.focus();
	}

	async function saveResult(): Promise<void> {
		saved = null;
		saveError = '';
		const ws = $workspaces.current;
		if (ws === null || data === null) return;
		try {
			saved = await recordRun(ws.id, pack, lessonId, score, exercises.length);
		} catch {
			// Nothing was written: a score that could not be compared with the
			// stored best must never replace it.
			saveError = t('grammar.practice.saveFailed');
		}
	}

	function retry(): void {
		attempt += 1;
		results = exercises.map(() => null);
		index = 0;
		saved = null;
		saveError = '';
	}

	const parts = $derived(
		current && current.kind === 'cloze' ? clozeParts(current.example.text, current.example.focus) : null
	);
</script>

<div class="page-body practice">
	<p class="back"><a href={grammarHref({ view: 'lesson', pack, lesson: lessonId })}>{t('grammar.practice.back')}</a></p>

	{#if status === 'loading'}
		<p role="status">{t('common.loading')}</p>
	{:else if status === 'error'}
		<p class="error" role="alert">{t('grammar.lesson.loadFailed')}</p>
	{:else if status === 'missing' || data === null}
		<p>{t('grammar.lesson.gone')}</p>
		<p><a href={grammarHref({ view: 'browse' })}>{t('grammar.lesson.backToLessons')}</a></p>
	{:else if finished}
		<h1>{data.lesson.title}</h1>
		<section aria-label={t('grammar.practice.result')}>
			<p class="score" role="status">
				{t('grammar.practice.score', { score, total: exercises.length })}
			</p>
			{#if saved}
				<p>{t('grammar.practice.best', { best: saved.best, total: saved.total })}</p>
			{/if}
			{#if saveError}
				<p class="error" role="alert">{saveError}</p>
				<button type="button" class="secondary" onclick={() => void saveResult()}>{t('grammar.practice.saveAgain')}</button>
			{/if}
			<div class="actions">
				<button type="button" class="primary" onclick={retry}>{t('grammar.practice.retry')}</button>
				<a class="secondary" href={grammarHref({ view: 'lesson', pack, lesson: lessonId })}>{t('grammar.practice.backToLesson')}</a>
				{#if data.view.next}
					<a class="secondary" href={grammarHref({ view: 'lesson', pack, lesson: data.view.next })}>{t('grammar.practice.nextLesson')}</a>
				{/if}
			</div>
		</section>
	{:else if current === null}
		<p>{t('grammar.practice.noExercises')}</p>
	{:else}
		<h1>{data.lesson.title}</h1>
		<p class="progress" aria-live="polite">{t('grammar.practice.progress', { n: index + 1, total: exercises.length })}</p>

		{#key `${attempt}:${index}`}
			{#if current.kind === 'cloze' && parts}
				<p class="instruction" tabindex="-1" bind:this={instruction}>{t('grammar.practice.cloze')}</p>
				<p class="translation">{current.example.translation}</p>
				<ClozeChoice
					before={parts.before}
					after={parts.after}
					choices={current.choices}
					answer={current.example.focus}
					language={textLang}
					onResult={(r) => void record(r.correct)}
				/>
			{:else if current.kind === 'order'}
				<p class="instruction" tabindex="-1" bind:this={instruction}>{t('grammar.practice.order')}</p>
				<p class="translation">{current.example.translation}</p>
				{#if tokens === null}
					<p role="status">{t('grammar.practice.preparing')}</p>
				{:else}
					<WordSaladBoard
						solution={tokens}
						seed={`${data.lesson.id}:${current.example.id}`}
						disabled={answered}
						language={textLang}
						onResult={(r) => void record(firstTry(r))}
					/>
				{/if}
			{/if}
		{/key}

		{#if answered}
			<section class="reveal" aria-label={t('grammar.practice.sentence')}>
				<p class="sentence" lang={textLang}>{current.example.text}</p>
				{#if current.example.reading}<p class="reading">{current.example.reading}</p>{/if}
			</section>
			<button type="button" class="primary" bind:this={nextButton} onclick={() => void advance()}>
				{index + 1 >= exercises.length ? t('grammar.practice.finish') : t('grammar.practice.next')}
			</button>
		{/if}
	{/if}
</div>

<style>
	.practice {
		max-width: 46rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.back a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}

	h1 {
		margin: 0.25rem 0;
	}

	.progress,
	.reading {
		color: var(--readable-muted);
	}

	.instruction:focus {
		outline: none;
	}

	.instruction {
		margin: 1rem 0 0.25rem;
		font-weight: 600;
	}

	.translation {
		margin: 0 0 0.75rem;
		font-size: 1.1rem;
	}

	.reveal {
		margin: 0.5rem 0 1rem;
	}

	.reveal p {
		margin: 0;
	}

	.sentence {
		font-size: 1.4rem;
	}

	.score {
		font-size: 1.6rem;
		font-weight: 700;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.primary,
	.secondary {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 1.2rem;
		border-radius: 0.4rem;
		font: inherit;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}

	.primary {
		border: 0;
		background: var(--accent);
		color: var(--on-accent);
	}

	.secondary {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
	}

	.primary:focus-visible,
	.secondary:focus-visible,
	a:focus-visible {
		outline: 2px solid var(--focus-colour);
		outline-offset: 2px;
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
