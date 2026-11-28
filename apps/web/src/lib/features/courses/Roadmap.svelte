<script lang="ts">
	// The course roadmap (#222): the path of sections and units, the next step one tap away, the unit tests and
	// section exams to skip ahead, the words of skipped units to add as cards, and the word marks along the way. The
	// model is roadmap.ts; loading is CourseView.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { errorText } from '$lib/api/apiErrors';
	import { useSession } from '$lib/context/context';
	import { getLanguage, t } from '$lib/i18n';
	import { pageTitle } from '$lib/routing/pageTitle';
	import { Button, Select, Tag } from '$lib/ui';
	import { addCourseCards, markCourseKnown, uncardedMetWords } from './cards';
	import type { CourseWord } from '$lib/api/courses';
	import { pickCourse } from './courseData';
	import { CourseView } from './courseView.svelte';
	import { loadWordInfo } from './lessonData';
	import { roadmap as buildRoadmap, titleText, type RoadmapUnit } from './roadmap';
	import { courseHref } from './route';

	let { courseId }: { courseId: string | null } = $props();

	const session = useSession();
	const workspace = session.workspaces.current;
	// The page is keyed on its route (CoursesPage): a new course id is a new view.
	// svelte-ignore state_referenced_locally
	const view = workspace === null ? null : new CourseView(session, workspace, courseId);
	const language = getLanguage();
	const map = $derived(view?.course && view.state ? buildRoadmap(view.course, view.state, language) : null);
	let adding = $state<string | null>(null);
	let message = $state('');
	let marking = false;

	const STATUS = {
		done: 'courses.status.done',
		current: 'courses.status.current',
		unlocked: 'courses.status.unlocked',
		locked: 'courses.status.locked'
	} as const;

	const LESSON_STATUS = {
		done: 'courses.lessonStatus.done',
		next: 'courses.lessonStatus.next',
		unlocked: 'courses.lessonStatus.unlocked',
		locked: 'courses.lessonStatus.locked'
	} as const;

	onMount(() => {
		void view?.load();
	});

	// The state's `known` words are marked known once (Ruling 12), then the path is replayed with them.
	$effect(() => {
		const state = view?.state;
		const course = view?.course;
		if (!view || !state || !course || state.known.length === 0 || marking) return;
		marking = true;
		void markCourseKnown(session.study, view.workspaceId, course, state.known)
			.then(() => view.reread())
			.catch(() => undefined)
			.finally(() => (marking = false));
	});

	// While online, the entries of the current unit and the next one are fetched, so the worker keeps them (Ruling 9).
	$effect(() => {
		const course = view?.course;
		const current = view?.state?.current;
		if (!course || !current) return;
		const units = course.sections.flatMap((s) => s.units);
		const at = units.findIndex((u) => u.id === current.unit);
		if (at < 0) return;
		void loadWordInfo(units.slice(at, at + 2).flatMap((u) => u.words));
	});

	const uncarded = $derived(view?.course && view.state && view.history ? uncardedMetWords(view.course, view.state.met, view.history.cards) : []);

	function addUnitCards(unit: RoadmapUnit): Promise<void> {
		const words = view?.course?.sections.flatMap((s) => s.units).find((u) => u.id === unit.id)?.words ?? [];
		return addCards(unit.id, words);
	}

	async function addCards(id: string, words: readonly CourseWord[]): Promise<void> {
		const course = view?.course;
		if (!view || !course) return;
		adding = id;
		message = '';
		try {
			const created = await addCourseCards(session.study, view.workspaceId, course, words);
			message = created.length === 0 ? t('courses.roadmap.noneAdded') : t('courses.roadmap.cardsAdded', { count: created.length });
			await view.reread();
		} catch (err) {
			message = errorText(err, t('courses.roadmap.addFailed'));
		} finally {
			adding = null;
		}
	}

	function choose(id: string): void {
		if (!view || id === view.course?.id) return;
		pickCourse(session, view.workspaceId, id);
		void goto(courseHref({ view: 'roadmap', course: id }));
	}
</script>

<svelte:head>
	<title>{pageTitle(view?.course ? titleText(view.course.title, language) : t('features.courses.title'))}</title>
</svelte:head>

<div class="page-body roadmap">
	{#if view === null}
		<h1>{t('features.courses.title')}</h1>
		<p>{t('courses.roadmap.noWorkspace')}</p>
	{:else if view.status === 'loading'}
		<h1>{t('features.courses.title')}</h1>
		<p role="status">{t('common.loading')}</p>
	{:else if view.status === 'error'}
		<h1>{t('features.courses.title')}</h1>
		<p class="error" role="alert">{t('courses.roadmap.loadFailed')}</p>
	{:else if view.status === 'none'}
		<h1>{t('features.courses.title')}</h1>
		<p>{t('courses.roadmap.none')}</p>
	{:else if view.status === 'missing' || !map || !view.course}
		<h1>{t('features.courses.title')}</h1>
		<p>{t('courses.roadmap.missing')}</p>
		<p><a href={courseHref({ view: 'roadmap', course: null })}>{t('courses.roadmap.backToCourse')}</a></p>
	{:else}
		{@const course = view.course}
		<header class="head">
			<h1>{titleText(course.title, language)}</h1>
			<p class="count">{t('courses.roadmap.words', { met: map.met, total: map.total })}</p>
			{#if map.next}
				<Button variant="primary" href={map.next.href}>{t('courses.roadmap.continue', { lesson: map.next.label })}</Button>
			{:else}
				<p role="status">{t('courses.roadmap.finished')}</p>
			{/if}
			{#if view.stale}<p class="quiet" role="status">{t('courses.roadmap.stale')}</p>{/if}
			{#if message}<p role="status">{message}</p>{/if}
			{#if uncarded.length > 0}
				<p class="quiet">{t('courses.roadmap.uncarded', { count: uncarded.length })}</p>
				<Button busy={adding === 'met'} onclick={() => void addCards('met', uncarded)}>{t('courses.roadmap.addCards')}</Button>
			{/if}
			{#if view.list.length > 1}
				<Select
					label={t('courses.roadmap.pick')}
					value={course.id}
					options={view.list.map((c) => ({ value: c.id, label: titleText(c.title, language) }))}
					onchange={(e: Event) => choose((e.currentTarget as HTMLSelectElement).value)}
				/>
			{/if}
		</header>

		{#each map.sections as section (section.id)}
			<section class="section {section.status}" aria-labelledby="section-{section.id}">
				<h2 id="section-{section.id}">
					{section.title}
					{#if section.levelName}<span class="level">{section.levelName}</span>{/if}
				</h2>
				<p class="section-status"><Tag tone={section.status === 'current' ? 'accent' : 'neutral'}>{t(STATUS[section.status])}</Tag></p>
				<ol class="path">
					{#each section.units as unit (unit.id)}
						<li class="unit {unit.status}" class:current={unit.current} aria-current={unit.current ? 'step' : undefined}>
							<div class="unit-head">
								<h3>{unit.title}</h3>
								<Tag tone={unit.current ? 'accent' : 'neutral'}>{unit.skipped ? t('courses.status.skipped') : t(STATUS[unit.status])}</Tag>
							</div>
							{#if unit.status === 'current' || unit.status === 'unlocked'}
								<ol class="lessons">
									{#each unit.lessons as lesson (lesson.id)}
										<li class="lesson {lesson.status}">
											{#if lesson.href}
												<a href={lesson.href} aria-current={lesson.status === 'next' ? 'step' : undefined}>{lesson.label}</a>
											{:else}
												<span>{lesson.label}</span>
											{/if}
											<span class="lesson-status">{t(LESSON_STATUS[lesson.status])}</span>
										</li>
									{/each}
								</ol>
							{:else}
								<p class="quiet">{t('courses.roadmap.lessonCount', { count: unit.lessons.length })} · {t('courses.roadmap.wordCount', { count: unit.words })}</p>
							{/if}
							{#if unit.catchUp.length > 0}
								<ul class="lessons">
									{#each unit.catchUp as lesson (lesson.id)}
										<li class="lesson next"><a href={lesson.href}>{lesson.label}</a></li>
									{/each}
								</ul>
							{/if}
							<div class="unit-actions">
								{#if unit.test}
									<Button href={unit.test}>{t('courses.roadmap.takeTest')}</Button>
								{/if}
								{#if unit.skippedWords.length > 0}
									<Button busy={adding === unit.id} onclick={() => void addUnitCards(unit)}>{t('courses.roadmap.addCards')}</Button>
								{/if}
							</div>
							{#each unit.milestones as mark (mark.words)}
								<p class="milestone" class:reached={mark.reached}>{t('courses.roadmap.milestone', { count: mark.words })}</p>
							{/each}
						</li>
					{/each}
				</ol>
				{#if section.exam}
					<p class="exam"><Button href={section.exam}>{t('courses.roadmap.takeExam')}</Button></p>
				{/if}
			</section>
		{/each}

		<footer class="credits">
			<p>{course.name} · {course.license}{course.attribution ? ` · ${course.attribution}` : ''}</p>
		</footer>
	{/if}
</div>

<style>
	.head {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		margin-block-end: var(--space-4);
	}

	h1,
	h2,
	h3 {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.count,
	.quiet,
	.credits,
	.lesson-status,
	.level {
		color: var(--readable-muted);
	}

	.level {
		margin-inline-start: var(--space-2);
		font-size: var(--font-size-label);
		font-weight: var(--weight-regular);
	}

	.section {
		margin-block: var(--space-4);
	}

	.section-status {
		margin-block: var(--space-1) var(--space-2);
	}

	.path {
		list-style: none;
		margin: 0;
		padding: 0;
		border-inline-start: 1px solid var(--hair);
	}

	.unit {
		position: relative;
		margin: 0 0 var(--space-3);
		padding-inline-start: var(--space-3);
	}

	.unit::before {
		content: '';
		position: absolute;
		inset-inline-start: -6px;
		top: 0.45em;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 1px solid var(--hair);
		background: var(--panel);
	}

	.unit.done::before {
		background: var(--readable-muted);
		border-color: var(--readable-muted);
	}

	.unit.current::before {
		background: var(--accent);
		border-color: var(--accent);
	}

	.unit.locked h3 {
		color: var(--readable-muted);
	}

	.unit-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.lessons {
		list-style: none;
		margin: var(--space-1) 0 0;
		padding: 0;
	}

	.lesson {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: var(--hit);
		align-items: center;
		border-block-end: 1px solid var(--hair);
	}

	.lesson a {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit);
		overflow-wrap: anywhere;
	}

	.lesson.next a {
		font-weight: var(--weight-strong);
	}

	.lesson a:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.unit-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-block-start: var(--space-2);
	}

	.unit-actions:empty {
		display: none;
	}

	.milestone {
		margin-block: var(--space-2) 0;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.milestone.reached {
		color: var(--text);
		font-weight: var(--weight-medium);
	}

	.credits {
		margin-block-start: var(--space-5);
		font-size: var(--font-size-label);
		overflow-wrap: anywhere;
	}

	.error {
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
	}
</style>
