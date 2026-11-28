<script lang="ts">
	// What to review after a unit test or section exam (#224, Ruling 11): the words missed with their reading (through
	// the romanisation setting) and meaning, the grammar lessons missed (to the Grammar page), and for an exam the
	// units with misses, each linked to its practice lesson while that lesson is open.
	import type { Course } from '$lib/api/courses';
	import { getLanguage, t } from '$lib/i18n';
	import { studyLang } from '$lib/i18n/lang';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import type { CourseState } from '$lib/studycore/courseProgress';
	import { splitPoint } from '$lib/studycore/grammarRuns';
	import { grammarHref } from '$lib/features/grammar/route';
	import type { WordInfo } from './flow';
	import { titleText } from './roadmap';
	import { courseHref } from './route';
	import type { GapItem, Review } from './tests';

	let {
		review,
		course,
		state,
		info,
		grammar
	}: {
		review: Review;
		course: Course;
		state: CourseState;
		info: ReadonlyMap<string, WordInfo>;
		grammar: ReadonlyMap<string, readonly GapItem[]>;
	} = $props();

	const roman = useRomanisation();
	const lang = $derived(studyLang(course.language) ?? course.language);
	const units = $derived(
		review.units.map((id) => {
			const unit = course.sections.flatMap((s) => s.units).find((u) => u.id === id);
			const us = state.sections.flatMap((s) => s.units).find((u) => u.id === id);
			const practice = us?.lessons.find((l) => l.id === 'practice');
			const open = practice !== undefined && practice.status !== 'locked' && us?.status !== 'locked';
			return { id, title: unit ? titleText(unit.title, getLanguage()) : id, href: open ? courseHref({ view: 'lesson', course: course.id, unit: id, lesson: 'practice' }) : null };
		})
	);

	function grammarLink(point: string): string | null {
		const ids = splitPoint(point);
		return ids === null ? null : grammarHref({ view: 'lesson', pack: ids.packId, lesson: ids.lessonId });
	}
</script>

{#if review.words.length > 0 || review.grammar.length > 0 || units.length > 0}
	<section class="review" aria-labelledby="review-title">
		<h2 id="review-title">{t('courses.review.title')}</h2>
		{#if review.words.length > 0}
			<h3>{t('courses.review.words')}</h3>
			<ul class="words">
				{#each review.words as key (key)}
					{@const w = info.get(key)}
					<li>
						<span class="form" {lang}>{w?.form ?? key}</span>
						{#if w && roman.text(w.reading, course.language)}<span class="reading">{w.reading}</span>{/if}
						{#if w?.gloss}<span class="gloss">{w.gloss}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if review.grammar.length > 0}
			<h3>{t('courses.review.grammar')}</h3>
			<ul class="links">
				{#each review.grammar as point (point)}
					{@const href = grammarLink(point)}
					{@const title = grammar.get(point)?.[0]?.title ?? point}
					<li>{#if href}<a {href}>{title}</a>{:else}{title}{/if}</li>
				{/each}
			</ul>
		{/if}
		{#if units.length > 0}
			<h3>{t('courses.review.units')}</h3>
			<ul class="links">
				{#each units as unit (unit.id)}
					<li>{#if unit.href}<a href={unit.href}>{t('courses.review.practise', { unit: unit.title })}</a>{:else}{unit.title}{/if}</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.review {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	h2,
	h3 {
		margin: 0;
		overflow-wrap: anywhere;
	}

	h3 {
		font-size: var(--font-size-m);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.words li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: baseline;
		overflow-wrap: anywhere;
	}

	.form {
		font-size: var(--font-size-l);
	}

	.reading,
	.gloss {
		color: var(--readable-muted);
	}

	.links a {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit);
		overflow-wrap: anywhere;
	}
</style>
