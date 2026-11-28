<script lang="ts">
	// A grammar review round (#181): the due points and today's new points (review.ts, the study core's rules), one
	// point after another, each with the exercises of its review; a finished point is one `grammar` event of mode
	// `review`. On its own page (`/grammar/review`) it ends with a summary; inside a study session (`embedded`) it
	// hands its runs to the session and the session shows the summary.
	import { t } from '$lib/i18n';
	import { untrack } from 'svelte';
	import { formatDateTime } from '$lib/i18n/format';
	import { splitPoint, type GrammarRun } from '$lib/studycore/grammarRuns';
	import { Button, Section } from '$lib/ui';
	import { useSession } from '$lib/context/context';
	import { loadDisplayLesson, type DisplayLesson } from '../lessonData';
	import { grammarHref } from '../route';
	import type { Exercise } from '../exercises';
	import ReviewExercise from './ReviewExercise.svelte';
	import { loadReview, recordReview, reviewExercises, type ReviewData } from './review';

	interface Props {
		/** Inside a study session: no summary of its own, `onDone` gets the runs. */
		embedded?: boolean;
		onDone?: (runs: GrammarRun[]) => void;
	}

	let { embedded = false, onDone }: Props = $props();

	const session = useSession();
	const workspace = $derived(session.workspaces.current);

	let status = $state<'loading' | 'error' | 'ready'>('loading');
	let data = $state.raw<ReviewData | null>(null);
	let pointIndex = $state(0);
	let lesson = $state.raw<DisplayLesson | null>(null);
	let lessonStatus = $state<'loading' | 'ready' | 'error'>('loading');
	let exercises = $state.raw<Exercise[]>([]);
	let exIndex = $state(0);
	let score = $state(0);
	let runs = $state.raw<GrammarRun[]>([]);
	let saveError = $state('');
	let ended = $state(false);

	const items = $derived(data?.round.items ?? []);
	const item = $derived(items[pointIndex]);
	const finished = $derived(ended || (status === 'ready' && pointIndex >= items.length));
	const ids = $derived(item ? splitPoint(item.point) : null);
	const nextDue = $derived.by(() => {
		if (data === null) return null;
		let min: string | null = null;
		for (const s of data.states.values()) {
			if (!data.titles.has(s.point)) continue;
			if (min === null || Date.parse(s.due) < Date.parse(min)) min = s.due;
		}
		return min;
	});

	$effect(() => {
		const ws = workspace;
		if (ws === null) return;
		let cancelled = false;
		status = 'loading';
		void loadReview(session, ws).then(
			(d) => {
				if (cancelled) return;
				data = d;
				pointIndex = 0;
				status = 'ready';
			},
			() => {
				if (!cancelled) status = 'error';
			}
		);
		return () => {
			cancelled = true;
		};
	});

	// Each point: its lesson as displayed (the script setting), then its review's exercises. A point whose lesson
	// is gone, or which has no exercise, is passed over.
	$effect(() => {
		const point = item;
		const pair = ids;
		if (status !== 'ready' || point === undefined || pair === null) return;
		let cancelled = false;
		lessonStatus = 'loading';
		exIndex = 0;
		score = 0;
		void loadDisplayLesson(pair.packId, pair.lessonId).then(
			(display) => {
				if (cancelled) return;
				const list = display === null ? [] : reviewExercises(display.lesson, data?.states.get(point.point)?.reviews ?? 0);
				if (display === null || list.length === 0) {
					untrack(() => (pointIndex += 1));
					return;
				}
				lesson = display;
				exercises = list;
				lessonStatus = 'ready';
			},
			() => {
				if (!cancelled) lessonStatus = 'error';
			}
		);
		return () => {
			cancelled = true;
		};
	});

	// The round's end inside a session: hand over the runs once.
	let handed = false;
	$effect(() => {
		if (!embedded || !finished || handed) return;
		handed = true;
		const done = runs;
		untrack(() => onDone?.(done));
	});

	async function next(right: boolean): Promise<void> {
		if (right) score += 1;
		if (exIndex + 1 < exercises.length) {
			exIndex += 1;
			return;
		}
		const ws = workspace;
		const pair = ids;
		if (ws !== null && pair !== null) {
			try {
				// A run that cannot be sent now waits in the outbox and is sent later.
				runs = [...runs, await recordReview(session, ws.id, pair.packId, pair.lessonId, score, exercises.length)];
			} catch {
				saveError = t('grammar.practice.saveFailed');
			}
		}
		pointIndex += 1;
	}

	function skip(): void {
		pointIndex += 1;
	}

	function stop(): void {
		ended = true;
	}
</script>

<div class="review" class:page-body={!embedded}>
	{#if !embedded}
		<p class="back"><a href={grammarHref({ view: 'browse' })}>{t('grammar.review.back')}</a></p>
	{/if}
	<h1>{t('grammar.review.title')}</h1>

	{#if workspace === null}
		<p>{t('grammar.chooseWorkspace')}</p>
	{:else if status === 'loading'}
		<p role="status">{t('common.loading')}</p>
	{:else if status === 'error'}
		<p class="error" role="alert">{t('grammar.review.loadFailed')}</p>
		{#if embedded}
			<div class="actions"><Button onclick={stop}>{t('grammar.review.skipAll')}</Button></div>
		{/if}
	{:else if finished}
		{#if !embedded}
			<Section>
				<p class="score" role="status">
					{items.length > 0 ? t('grammar.review.reviewed', { count: runs.length }) : t('grammar.review.nothingDue')}
				</p>
				{#if nextDue && items.length === 0}
					<p class="hint">{t('grammar.review.nextDue', { when: formatDateTime(nextDue) })}</p>
				{/if}
				{#if saveError}
					<p class="error" role="alert">{saveError}</p>
				{/if}
				<div class="actions">
					<Button variant="primary" href={grammarHref({ view: 'browse' })}>{t('grammar.review.done')}</Button>
				</div>
			</Section>
		{:else}
			<p role="status">{t('grammar.review.reviewed', { count: runs.length })}</p>
		{/if}
	{:else if item}
		<p class="progress" aria-live="polite">
			{t('grammar.review.progress', { n: pointIndex + 1, total: items.length })}
			{#if item.why === 'new'}<span class="new"> · {t('grammar.review.firstReview')}</span>{/if}
		</p>
		<h2>{data?.titles.get(item.point) ?? item.point}</h2>
		{#if lessonStatus === 'loading'}
			<p role="status">{t('common.loading')}</p>
		{:else if lessonStatus === 'error'}
			<p class="error" role="alert">{t('grammar.lesson.loadFailed')}</p>
		{:else if lesson && exercises[exIndex]}
			<p class="step">{t('grammar.practice.progress', { n: exIndex + 1, total: exercises.length })}</p>
			{#key `${pointIndex}:${exIndex}`}
				<ReviewExercise
					exercise={exercises[exIndex]}
					language={lesson.view.pack.language}
					textLang={lesson.textLang}
					seed={`${item.point}:${exIndex}`}
					last={exIndex + 1 >= exercises.length && pointIndex + 1 >= items.length}
					onNext={(right) => void next(right)}
				/>
			{/key}
		{/if}
		{#if saveError}
			<p class="error" role="alert">{saveError}</p>
		{/if}
		<div class="actions secondary">
			<Button onclick={skip}>{t('grammar.review.skip')}</Button>
			<Button onclick={stop}>{t('grammar.review.stop')}</Button>
		</div>
	{/if}
</div>

<style>
	/* No second page container: .page-body owns the column (#106). */
	.back a {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit);
	}

	.back a:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	h1 {
		margin-block: var(--space-1);
	}

	h2 {
		margin-block: var(--space-1) 0;
		font-size: var(--font-size-l);
		overflow-wrap: anywhere;
	}

	.progress,
	.step,
	.hint {
		color: var(--readable-muted);
	}

	.step {
		margin-block: var(--space-1) 0;
		font-size: var(--font-size-s);
	}

	.score {
		font-size: var(--font-size-xl);
		font-weight: var(--weight-strong);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.secondary {
		margin-block-start: var(--space-5);
	}

	.error {
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
