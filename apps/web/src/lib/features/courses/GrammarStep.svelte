<script lang="ts">
	// A grammar lesson inside the course (#222, Ruling 20): the shipped lesson's pattern, explanation and examples
	// (grammar's lesson data), then its fill-the-gap exercises with grammar's ClozeChoice. A finished run is a grammar
	// run (#277) as on the Grammar page; the player records the course lesson. Word order is left out (its board is
	// the flashcards feature's).
	import { tick } from 'svelte';
	import { useSession } from '$lib/context/context';
	import { t } from '$lib/i18n';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import { splitPoint } from '$lib/studycore/grammarRuns';
	import { Button } from '$lib/ui';
	import ClozeChoice from '$lib/features/grammar/ClozeChoice.svelte';
	import { buildExercises, clozeParts } from '$lib/features/grammar/exercises';
	import { loadDisplayLesson, type DisplayLesson } from '$lib/features/grammar/lessonData';
	import { recordRun } from '$lib/features/grammar/progress';
	import { grammarHref } from '$lib/features/grammar/route';

	let { point, available, workspaceId, ondone }: { point: string; available: boolean; workspaceId: number; ondone: (score: number, total: number) => void } = $props();

	const session = useSession();
	const roman = useRomanisation();
	// svelte-ignore state_referenced_locally
	const ids = splitPoint(point);
	let data = $state<DisplayLesson | null>(null);
	let status = $state<'loading' | 'ready' | 'missing' | 'error'>('loading');
	let phase = $state<'explain' | 'practise'>('explain');
	let index = $state(0);
	let results = $state<boolean[]>([]);
	let answered = $state(false);
	let heading = $state<HTMLElement | null>(null);

	$effect(() => {
		if (ids === null || !available) {
			status = 'missing';
			return;
		}
		let cancelled = false;
		void loadDisplayLesson(ids.packId, ids.lessonId).then(
			(r) => {
				if (cancelled) return;
				data = r;
				status = r === null ? 'missing' : 'ready';
			},
			() => {
				if (!cancelled) status = 'error';
			}
		);
		return () => {
			cancelled = true;
		};
	});

	const exercises = $derived(data ? buildExercises(data.lesson, data.lesson.id).filter((e) => e.kind === 'cloze') : []);
	const current = $derived(exercises[index] ?? null);
	const parts = $derived(current ? clozeParts(current.example.text, current.example.focus) : null);

	async function practise(): Promise<void> {
		if (exercises.length === 0) {
			ondone(0, 0);
			return;
		}
		phase = 'practise';
		await tick();
		heading?.focus();
	}

	async function next(): Promise<void> {
		answered = false;
		index += 1;
		if (index < exercises.length) {
			await tick();
			heading?.focus();
			return;
		}
		const score = results.filter(Boolean).length;
		if (ids !== null) {
			// A run that cannot be sent now waits in the outbox; a deleted workspace loses it.
			await recordRun(session, workspaceId, ids.packId, ids.lessonId, score, exercises.length, undefined).catch(() => undefined);
		}
		ondone(score, exercises.length);
	}
</script>

{#if status === 'loading'}
	<p role="status">{t('common.loading')}</p>
{:else if status === 'missing' || status === 'error' || data === null}
	<p>{status === 'error' ? t('courses.grammar.loadFailed') : t('courses.grammar.unavailable')}</p>
	<Button variant="primary" onclick={() => ondone(0, 0)}>{t('courses.player.continue')}</Button>
{:else if phase === 'explain'}
	<section class="grammar" aria-labelledby="grammar-title">
		<h2 id="grammar-title">{data.lesson.title}</h2>
		{#if data.lesson.summary}<p class="summary">{data.lesson.summary}</p>{/if}
		{#each data.lesson.pattern as line, i (i)}<p class="pattern" lang={data.textLang}>{line}</p>{/each}
		{#each data.lesson.body as para, i (i)}<p>{para}</p>{/each}
		<ul class="examples">
			{#each data.lesson.examples as ex (ex.id)}
				<li>
					<p class="example" lang={data.textLang}>{ex.text}</p>
					{#if roman.text(ex.reading, data.view.pack.language)}<p class="reading">{ex.reading}</p>{/if}
					<p class="translation">{ex.translation}</p>
				</li>
			{/each}
		</ul>
		<p class="more"><a href={grammarHref({ view: 'lesson', pack: data.view.pack.packId, lesson: data.lesson.id })}>{t('courses.grammar.open')}</a></p>
		<Button variant="primary" onclick={() => void practise()}>{exercises.length > 0 ? t('courses.grammar.practise') : t('courses.player.continue')}</Button>
	</section>
{:else if current && parts}
	{#key index}
		<p class="instruction" tabindex="-1" bind:this={heading}>{t('courses.grammar.cloze', { n: index + 1, total: exercises.length })}</p>
		<p class="translation">{current.example.translation}</p>
		<ClozeChoice
			before={parts.before}
			after={parts.after}
			choices={current.choices}
			answer={current.example.focus}
			language={data.textLang}
			onResult={(r) => {
				results = [...results, r.correct];
				answered = true;
			}}
		/>
	{/key}
	{#if answered}
		<Button variant="primary" onclick={() => void next()}>{t('courses.player.continue')}</Button>
	{/if}
{/if}

<style>
	.grammar p,
	.examples p {
		margin-block: 0 var(--space-2);
		overflow-wrap: anywhere;
	}

	.summary,
	.reading,
	.translation {
		color: var(--readable-muted);
	}

	.pattern {
		font-weight: var(--weight-medium);
	}

	.examples {
		list-style: none;
		margin: var(--space-3) 0;
		padding: 0;
	}

	.example {
		font-size: var(--font-size-l);
	}

	.instruction:focus {
		outline: none;
	}

	.more a {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit);
	}
</style>
