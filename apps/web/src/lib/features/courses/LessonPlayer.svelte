<script lang="ts">
	// The lesson player (#222): a full-screen flow like the study session (the frame hides the bottom bar under
	// /courses/play), a thin progress line, the step, docked actions, and a summary at the end. It hosts every lesson
	// kind (flow.ts) and the first unit test and section exam (Ruling 25). Steps push no history: Back leaves the lesson
	// (Ruling 5).
	import { onMount, tick } from 'svelte';
	import { errorText } from '$lib/api/apiErrors';
	import { readAudioSettings } from '$lib/audio/settings';
	import { hasDeviceVoice } from '$lib/audio/player';
	import { probeVoice } from '$lib/native/speech';
	import { useSession } from '$lib/context/context';
	import { getLanguage, t } from '$lib/i18n';
	import { studyLang } from '$lib/i18n/lang';
	import { pageTitle } from '$lib/routing/pageTitle';
	import { Button } from '$lib/ui';
	import { systemLabel } from '$lib/features/scripts/labels';
	import { scriptsHref } from '$lib/features/scripts/route';
	import type { CourseLesson, CourseUnit } from '$lib/api/courses';
	import { addCourseCards, courseDeckId, recordFirstReviews } from './cards';
	import ChoiceQuestion from './ChoiceQuestion.svelte';
	import { CourseView } from './courseView.svelte';
	import { buildExamFlow, buildLessonFlow, buildTestFlow, passed as passedMark, scoreOf, wordGrades, type Step, type WordInfo } from './flow';
	import GrammarStep from './GrammarStep.svelte';
	import { loadCharacterInfo, loadWordInfo } from './lessonData';
	import { courseEvent, recordCourseEvent } from './progress';
	import ReadingStep from './ReadingStep.svelte';
	import { lessonLabel, roadmap, titleText } from './roadmap';
	import { courseHref, type CourseRoute } from './route';
	import { FlowRun } from './run.svelte';
	import WordCard from './WordCard.svelte';

	let { route }: { route: Exclude<CourseRoute, { view: 'roadmap' }> } = $props();

	const session = useSession();
	const workspace = session.workspaces.current;
	// The page is keyed on its route (CoursesPage).
	// svelte-ignore state_referenced_locally
	const view = workspace === null ? null : new CourseView(session, workspace, route.course);
	const deviceVoice = readAudioSettings(workspace?.settings).deviceVoice;
	const back = courseHref({ view: 'roadmap', course: null });

	type Found = { unit: CourseUnit | null; lesson: CourseLesson | null; title: string; locked: boolean };
	let status = $state<'loading' | 'ready' | 'gone' | 'locked' | 'error'>('loading');
	let found = $state.raw<Found | null>(null);
	let info = $state.raw<Map<string, WordInfo>>(new Map());
	let characters = $state.raw<Map<string, WordInfo>>(new Map());
	let run = $state<FlowRun | null>(null);
	let words = $state.raw<string[]>([]);
	let cards = false;
	let passPercent = $state(0);
	let grammarScore = $state<{ score: number; total: number } | null>(null);
	let summary = $state<{ score: number; total: number; passed: boolean | null; added: number; error: string } | null>(null);
	let saving = $state(false);
	let stepHeading = $state<HTMLElement | null>(null);
	let continueButton = $state<HTMLElement | undefined>(undefined);
	const language = $derived(view?.course?.language ?? workspace?.language ?? '');

	onMount(() => {
		void start();
	});

	async function voiceFor(lang: string): Promise<boolean> {
		if (!deviceVoice) return false;
		await probeVoice(lang).catch(() => undefined);
		return hasDeviceVoice(lang);
	}

	async function start(): Promise<void> {
		if (view === null) {
			status = 'error';
			return;
		}
		await view.load();
		const course = view.course;
		const state = view.state;
		if (view.status !== 'ready' || course === null || state === null) {
			status = view.status === 'error' ? 'error' : 'gone';
			return;
		}
		const units = course.sections.flatMap((s) => s.units);
		const met = new Set(state.met);
		const seed = `${route.course}:${Date.now()}`;
		const voice = await voiceFor(course.language);
		let steps: Step[] = [];
		if (route.view === 'exam') {
			const section = course.sections.find((s) => s.id === route.section);
			if (!section) return void (status = 'gone');
			const pool = section.units.flatMap((u) => u.words);
			info = await loadWordInfo(pool.slice(0, Math.max(course.checkpoints.section.questions * 2, 20)));
			const flow = buildExamFlow({ course, info, met, voice, seed, section: section.id })!;
			steps = flow.steps;
			passPercent = flow.passPercent;
			found = { unit: null, lesson: null, title: t('courses.player.exam', { section: titleText(section.title, getLanguage()) }), locked: false };
		} else {
			const unit = units.find((u) => u.id === route.unit);
			if (!unit) return void (status = 'gone');
			const unitState = state.sections.flatMap((s) => s.units).find((u) => u.id === unit.id)!;
			info = await loadWordInfo(unit.words);
			if (route.view === 'test') {
				const flow = buildTestFlow({ course, info, met, voice, seed, unit: unit.id })!;
				steps = flow.steps;
				passPercent = flow.passPercent;
				found = { unit, lesson: null, title: t('courses.player.test', { unit: titleText(unit.title, getLanguage()) }), locked: false };
			} else {
				const lesson = unit.lessons.find((l) => l.id === route.lesson) ?? unitState.catchUp.find((c) => c.id === route.lesson) ?? null;
				if (lesson === null) return void (status = 'gone');
				const ls = unitState.lessons.find((l) => l.id === lesson.id);
				found = { unit, lesson, title: lessonLabel(lesson), locked: ls?.status === 'locked' };
				if (found.locked) return void (status = 'locked');
				if (lesson.kind === 'words') info = await loadWordInfo([...unit.words, ...lesson.words.map((k) => units.flatMap((u) => u.words).find((w) => w.key === k)).filter((w) => w !== undefined)]);
				if (lesson.kind === 'script') characters = await loadCharacterInfo(course.language, lesson.characters);
				const flow = buildLessonFlow({ course, info, met, voice, seed, characters, unit: unit.id, lesson })!;
				steps = flow.steps;
				words = flow.words;
				cards = flow.cards;
				void recordCourseEvent(session, courseEvent(view.workspaceId, { kind: 'lesson-started', course: course.id, unit: unit.id, lesson: lesson.id })).catch(() => undefined);
			}
		}
		run = new FlowRun(steps, { retry: route.view === 'lesson' });
		status = 'ready';
		if (run.done) await finish();
		await tick();
		stepHeading?.focus();
	}

	async function choose(choice: string): Promise<void> {
		run?.answer(choice);
		await tick();
		continueButton?.focus();
	}

	async function next(): Promise<void> {
		if (run === null) return;
		run.next();
		if (run.done) {
			await finish();
			return;
		}
		await tick();
		stepHeading?.focus();
	}

	async function grammarDone(score: number, total: number): Promise<void> {
		grammarScore = { score, total };
		await next();
	}

	async function finish(): Promise<void> {
		const course = view?.course;
		const state = view?.state;
		if (!view || !course || !state || run === null || summary !== null || saving) return;
		saving = true;
		const results = run.results;
		const { score, total } = grammarScore ?? scoreOf(results);
		let added = 0;
		let error = '';
		let passed: boolean | null = null;
		try {
			if (route.view === 'lesson' && found?.unit && found.lesson) {
				// The lesson counts first (the outbox keeps it offline); its cards need the server.
				await recordCourseEvent(session, courseEvent(view.workspaceId, { kind: 'lesson-finished', course: course.id, unit: found.unit.id, lesson: found.lesson.id, score, total, words }));
				if (cards && words.length > 0) {
					try {
						const created = await addCourseCards(
							session.study,
							view.workspaceId,
							course,
							words.map((k) => info.get(k)).filter((w): w is WordInfo => w !== undefined)
						);
						added = created.length;
						const grades = wordGrades(words, results);
						const byEntry = new Map([...grades].map(([k, g]) => [info.get(k)?.entryId ?? -1, g]));
						await recordFirstReviews(session, view.workspaceId, created, byEntry);
					} catch (err) {
						error = errorText(err, t('courses.summary.cardsFailed'));
					}
				}
			} else if (route.view === 'test' && found?.unit) {
				passed = passedMark(score, total, passPercent);
				const us = state.sections.flatMap((s) => s.units).find((u) => u.id === found!.unit!.id);
				const early = us === undefined || us.lessons.some((l) => l.status !== 'done');
				await recordCourseEvent(session, courseEvent(view.workspaceId, { kind: 'unit-test', course: course.id, unit: found.unit.id, score, total, passed, early }));
			} else if (route.view === 'exam') {
				passed = passedMark(score, total, passPercent);
				await recordCourseEvent(session, courseEvent(view.workspaceId, { kind: 'section-exam', course: course.id, section: route.section, score, total, passed }));
			}
			await view.reread();
		} catch (err) {
			error = errorText(err, t('courses.summary.saveFailed'));
		}
		summary = { score, total, passed, added, error };
		saving = false;
		await tick();
		stepHeading?.focus();
	}

	const nextStep = $derived(view?.course && view.state && summary ? roadmap(view.course, view.state, getLanguage()).next : null);
	const step = $derived(run?.step ?? null);
	const lang = $derived(studyLang(language) ?? language);
	const reached = $derived.by(() => {
		const course = view?.course;
		const state = view?.state;
		if (!course || !state) return new Set<number>();
		const keys = new Set([...state.met]);
		const ids = new Set(view?.history?.known ?? []);
		for (const s of course.sections) for (const u of s.units) for (const w of u.words) if (keys.has(w.key)) ids.add(w.entryId);
		return ids;
	});
	const unitText = $derived(found?.unit?.text ?? null);
</script>

<svelte:head>
	<title>{pageTitle(found?.title ?? t('features.courses.title'), t('features.courses.title'))}</title>
</svelte:head>

<div class="player">
	<header class="top">
		<a class="close" href={back} aria-label={t('courses.player.close')}>✕</a>
		<div
			class="line"
			role="progressbar"
			aria-label={t('courses.player.progress')}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={Math.round((summary ? 1 : (run?.progress ?? 0)) * 100)}
		>
			<span style:inline-size="{(summary ? 1 : (run?.progress ?? 0)) * 100}%"></span>
		</div>
	</header>

	<div class="stage">
		{#if status === 'loading'}
			<h1 tabindex="-1">{t('features.courses.title')}</h1>
			<p role="status">{t('common.loading')}</p>
		{:else if status === 'error'}
			<h1 tabindex="-1">{t('features.courses.title')}</h1>
			<p class="error" role="alert">{t('courses.roadmap.loadFailed')}</p>
			<Button href={back}>{t('courses.player.backToCourse')}</Button>
		{:else if status === 'gone'}
			<h1 tabindex="-1">{t('features.courses.title')}</h1>
			<p>{t('courses.player.gone')}</p>
			<Button href={back}>{t('courses.player.backToCourse')}</Button>
		{:else if status === 'locked'}
			<h1 tabindex="-1">{found?.title}</h1>
			<p>{t('courses.player.locked')}</p>
			<Button href={back}>{t('courses.player.backToCourse')}</Button>
		{:else if summary}
			<h1 tabindex="-1" bind:this={stepHeading}>
				{summary.passed === null ? t('courses.summary.done') : summary.passed ? t('courses.summary.passed') : t('courses.summary.notPassed')}
			</h1>
			<p class="title">{found?.title}</p>
			{#if summary.total > 0}<p class="score">{t('courses.summary.score', { score: summary.score, total: summary.total })}</p>{/if}
			{#if summary.passed === false}<p>{t('courses.summary.passMark', { percent: passPercent })}</p>{/if}
			{#if words.length > 0}
				<p>{t('courses.summary.words', { count: words.length })}</p>
				<ul class="learnt" {lang}>
					{#each words as key (key)}<li>{info.get(key)?.form ?? key}</li>{/each}
				</ul>
				{#if summary.added > 0}
					<p>
						{t('courses.summary.cards', { count: summary.added })}
						<a href="/flashcards/deck/{encodeURIComponent(courseDeckId(view?.course?.id ?? ''))}">{view?.course ? titleText(view.course.title, getLanguage()) : ''}</a>
					</p>
				{/if}
			{/if}
			{#if summary.error}<p class="error" role="alert">{summary.error}</p>{/if}
		{:else if run && step}
			<h1 class="visually-hidden" tabindex="-1" bind:this={stepHeading}>{found?.title}</h1>
			{#if step.kind === 'intro'}
				{@const w = info.get(step.word)}
				{#if w}<WordCard word={w} {language} {deviceVoice} heading={t('courses.player.newWord')} />{:else}<p {lang}>{step.word}</p>{/if}
			{:else if step.kind === 'character'}
				{@const c = characters.get(step.char) ?? { key: step.char, form: step.char, reading: '', entryId: 0, gloss: null }}
				<WordCard word={c} {language} {deviceVoice} heading={t('courses.player.newCharacter')} />
			{:else if step.kind === 'scripts'}
				<p>{t('courses.player.scripts')}</p>
				<ul class="links">
					{#each step.scripts as id (id)}<li><a href={scriptsHref({ view: 'overview', system: id })}>{systemLabel(id)}</a></li>{/each}
				</ul>
			{:else if step.kind === 'say'}
				{@const w = info.get(step.word)}
				<p>{t('courses.player.say')}</p>
				{#if w}<WordCard word={w} {language} {deviceVoice} heading={t('courses.player.sayWord')} />{/if}
			{:else if step.kind === 'note'}
				<p>{step.note === 'noVoice' ? t('courses.player.noVoice') : t('courses.player.noWords')}</p>
			{:else if step.kind === 'reading'}
				{#if unitText}<ReadingStep text={unitText} {language} {reached} />{:else}<p>{t('courses.player.noText')}</p>{/if}
			{:else if step.kind === 'grammar' && view}
				<GrammarStep point={step.point} available={step.available} workspaceId={view.workspaceId} ondone={(s, n) => void grammarDone(s, n)} />
			{:else if step.kind === 'question'}
				<ChoiceQuestion
					question={step.question}
					word={info.get(step.question.word) ?? characters.get(step.question.word)}
					{language}
					{deviceVoice}
					chosen={run.chosen}
					retry={run.retrying}
					onchoose={(c) => void choose(c)}
				/>
			{/if}
		{/if}
	</div>

	{#if status === 'ready'}
		<footer class="dock">
			{#if summary}
				{#if nextStep}
					<Button variant="primary" href={nextStep.href}>{t('courses.roadmap.continue', { lesson: nextStep.label })}</Button>
				{/if}
				<Button href={back}>{t('courses.player.backToCourse')}</Button>
			{:else if run && step && step.kind !== 'grammar'}
				<Button variant="primary" bind:element={continueButton} disabled={!run.canContinue || saving} busy={saving} onclick={() => void next()}>
					{step.kind === 'say' ? t('courses.player.saidIt') : t('courses.player.continue')}
				</Button>
			{/if}
		</footer>
	{/if}
</div>

<style>
	.player {
		display: flex;
		flex-direction: column;
		min-block-size: calc(100dvh - var(--space-6));
		max-inline-size: 40rem;
		margin-inline: auto;
		padding-inline: var(--space-3);
		box-sizing: border-box;
	}

	.top {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding-block: var(--space-2);
	}

	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-inline-size: var(--hit);
		min-block-size: var(--hit);
		color: var(--text);
		text-decoration: none;
		font-size: var(--font-size-l);
	}

	.close:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.line {
		flex: 1;
		block-size: 4px;
		border-radius: 2px;
		background: var(--hair);
		overflow: hidden;
	}

	.line span {
		display: block;
		block-size: 100%;
		background: var(--accent);
		transition: inline-size var(--motion-fast) var(--ease-standard);
	}

	.stage {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-block: var(--space-3);
		min-inline-size: 0;
	}

	.stage :global(h1:focus) {
		outline: none;
	}

	.stage p {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.title {
		color: var(--readable-muted);
	}

	.score {
		font-size: var(--font-size-xl);
		font-weight: var(--weight-strong);
	}

	.learnt,
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: var(--font-size-l);
	}

	.links a {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit);
	}

	.dock {
		position: sticky;
		inset-block-end: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding-block: var(--space-3);
		background: var(--panel);
		border-block-start: 1px solid var(--hair);
	}

	.visually-hidden {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.error {
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
	}
</style>
