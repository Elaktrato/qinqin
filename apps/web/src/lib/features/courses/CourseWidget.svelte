<script lang="ts">
	// Home: "Continue course" (#225): the workspace's course, its next lesson one tap away and how far along it is.
	// Nothing shows while the course list is first read, nor when the workspace's language has no course (Ruling 18):
	// the widget is in the default layout, and a card saying "no course" on every visit would be noise. The model is
	// home.ts (docs/contracts/courses/home.json); the course comes from what the session or device holds (courseData).
	import { t, getLanguage } from '$lib/i18n';
	import { onStudyChange, touches, loadStudyHistory } from '$lib/studycore/data';
	import { useSession } from '$lib/context/context';
	import { Button } from '$lib/ui';
	import WidgetCard from '$lib/widgets/WidgetCard.svelte';
	import { WidgetLoad } from '$lib/widgets/widgetLoad.svelte';
	import type { Course } from '$lib/api/courses';
	import { NEXT_TEST } from '$lib/studycore/courseProgress';
	import { workspaceCourse } from './courseData';
	import { courseHome, type CourseHomeModel } from './home';
	import { courseState } from './progress';
	import { lessonLabel, titleText } from './roadmap';
	import { courseHref } from './route';

	const session = useSession();

	interface Shown {
		course: Course | null;
		model: CourseHomeModel | null;
	}
	const current = session.workspaces.current;
	const shown = new WidgetLoad<Shown>(session, 'course-continue', current?.id ?? null);
	const workspace = $derived(session.workspaces.current);
	const course = $derived(shown.value?.course ?? null);
	const model = $derived(shown.value?.model ?? null);

	async function load(ws: { id: number; language: string } | null): Promise<void> {
		if (ws === null) {
			shown.clear();
			return;
		}
		await shown.run(
			ws.id,
			async () => {
				const found = await workspaceCourse(session, ws);
				if (found === null) return { course: null, model: null };
				const history = await loadStudyHistory(session.study, ws.id);
				return { course: found, model: courseHome(found, courseState(found, history)) };
			},
			() => ''
		);
	}

	$effect(() => {
		const ws = workspace;
		void load(ws === null ? null : { id: ws.id, language: ws.language });
	});
	// A finished lesson elsewhere (another tab, a sync) moves the next step.
	$effect(() => {
		const ws = workspace;
		if (ws === null) return;
		const again = (touched: number): void => {
			if (touches(touched, ws.id)) void load({ id: ws.id, language: ws.language });
		};
		const offLog = session.events.onChange(again);
		const offWrite = onStudyChange(session.study, again);
		return () => {
			offLog();
			offWrite();
		};
	});

	function unitTitle(c: Course, id: string | null): string {
		const unit = c.sections.flatMap((s) => s.units).find((u) => u.id === id);
		return unit === undefined ? '' : titleText(unit.title, getLanguage());
	}

	function sectionTitle(c: Course, id: string | null): string {
		const section = c.sections.find((s) => s.id === id);
		return section === undefined ? '' : titleText(section.title, getLanguage());
	}

	function nextLabel(c: Course, m: CourseHomeModel): string {
		if (m.next === null) return '';
		if (m.next.lesson === NEXT_TEST) return t('courses.roadmap.takeTest');
		const lesson = c.sections.flatMap((s) => s.units).find((u) => u.id === m.unit)?.lessons.find((l) => l.id === m.next?.lesson);
		return lessonLabel(lesson ?? { id: m.next.lesson, kind: 'words' });
	}
</script>

{#if course !== null && model !== null}
	<WidgetCard title={titleText(course.title, getLanguage())} headingId="course-continue-heading" status="ready">
		{#snippet actions()}
			<Button variant="plain" href={courseHref({ view: 'roadmap', course: null })}>{t('widgets.course.roadmap')}</Button>
		{/snippet}
		<div class="course" data-testid="course-widget">
			{#if model.status === 'done'}
				<p class="where">{t('widgets.course.done')}</p>
				<Button variant="primary" href={courseHref({ view: 'roadmap', course: null })}>{t('widgets.course.whatNext')}</Button>
			{:else if model.next !== null}
				<p class="where">
					{model.status === 'start'
						? t('widgets.course.start')
						: t('widgets.course.where', { section: sectionTitle(course, model.section), unit: unitTitle(course, model.unit) })}
				</p>
				<Button variant="primary" href={model.next.href}>
					{model.status === 'start' ? t('widgets.course.startAction', { lesson: nextLabel(course, model) }) : t('courses.roadmap.continue', { lesson: nextLabel(course, model) })}
				</Button>
			{/if}
			<p class="progress">
				{t('widgets.course.progress', { done: model.units.done, units: model.units.total, met: model.words.met, words: model.words.total })}
			</p>
		</div>
	</WidgetCard>
{/if}

<style>
	.course {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}
	.where,
	.progress {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.progress {
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}
</style>
