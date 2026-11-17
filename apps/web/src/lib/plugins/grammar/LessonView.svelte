<script lang="ts">
	import { t } from '$lib/i18n';
	import { workspaces } from '$lib/workspaces';
	import PopupStackView from '$lib/features/reader/PopupStackView.svelte';
	import { LookupController } from '$lib/features/reader/useLookup.svelte';
	import { recordLookup } from '$lib/lookups/sink';
	import { loadDisplayLesson, type DisplayLesson } from './lessonData';
	import { browserReadingsStorage, loadReadings, saveReadings } from './readings';
	import { grammarHref } from './route';

	let { pack, lessonId }: { pack: string; lessonId: string } = $props();

	let data = $state<DisplayLesson | null>(null);
	let status = $state<'loading' | 'ready' | 'missing' | 'error'>('loading');
	let container = $state<HTMLElement | null>(null);
	let showReadings = $state(loadReadings(browserReadingsStorage()));

	$effect(() => saveReadings(browserReadingsStorage(), showReadings));

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

	const lesson = $derived(data?.lesson ?? null);
	// One lookup paragraph per pattern line, body paragraph and example text,
	// in that order: data-p is the index into this list.
	const texts = $derived(
		lesson ? [...lesson.pattern, ...lesson.body, ...lesson.examples.map((e) => e.text)] : []
	);
	const bodyStart = $derived(lesson?.pattern.length ?? 0);
	const exampleStart = $derived(bodyStart + (lesson?.body.length ?? 0));
	const language = $derived(data?.view.pack.language ?? '');
	const textLang = $derived(data?.textLang ?? '');

	// Words are added to study in the current workspace only when it is the lesson's language.
	const studyWorkspaceId = $derived(
		$workspaces.current && $workspaces.current.language === language ? $workspaces.current.id : null
	);

	const lookup = new LookupController({
		container: () => container,
		lang: () => language,
		textLang: () => textLang,
		runsOf: (p) => [{ text: texts[p] ?? '' }],
		onLookup: (entryId) => recordLookup(studyWorkspaceId, { entryId, source: 'lesson' })
	});
	$effect(() => lookup.attach());
	$effect(() => {
		void texts;
		lookup.close();
	});

	$effect(() => {
		const el = container;
		if (!el) return;
		const options = { passive: true };
		el.addEventListener('pointermove', lookup.pointermove, options);
		el.addEventListener('pointerleave', lookup.pointerleave, options);
		el.addEventListener('pointerdown', lookup.pointerdown, options);
		return () => {
			el.removeEventListener('pointermove', lookup.pointermove);
			el.removeEventListener('pointerleave', lookup.pointerleave);
			el.removeEventListener('pointerdown', lookup.pointerdown);
		};
	});

	const practiceHref = $derived(grammarHref({ view: 'practice', pack, lesson: lessonId }));
	const hasReadings = $derived(lesson?.examples.some((e) => e.reading !== '') ?? false);
</script>

<main class="lesson">
	<p class="back"><a href={grammarHref({ view: 'browse' })}>{t('grammar.lesson.all')}</a></p>

	{#if status === 'loading'}
		<p role="status">{t('common.loading')}</p>
	{:else if status === 'error'}
		<p class="error" role="alert">{t('grammar.lesson.loadFailed')}</p>
	{:else if status === 'missing' || lesson === null || data === null}
		<p>{t('grammar.lesson.gone')}</p>
		<p><a href={grammarHref({ view: 'browse' })}>{t('grammar.lesson.backToLessons')}</a></p>
	{:else}
		<div bind:this={container}>
			<h1 lang={textLang}>{lesson.title}</h1>
			<p class="summary">{lesson.summary}</p>

			{#if lesson.pattern.length > 0}
				<div class="pattern" lang={textLang} aria-label={t('grammar.lesson.pattern')}>
					{#each lesson.pattern as line, i (i)}
						<p data-p={i}><span data-r="0">{line}</span></p>
					{/each}
				</div>
			{/if}

			<div class="body">
				{#each lesson.body as paragraph, i (i)}
					<p data-p={bodyStart + i}><span data-r="0">{paragraph}</span></p>
				{/each}
			</div>

			<h2>{t('grammar.lesson.examples')}</h2>
			{#if hasReadings}
				<label class="toggle">
					<input type="checkbox" bind:checked={showReadings} />
					{t('grammar.lesson.showReadings')}
				</label>
			{/if}
			<ul class="examples">
				{#each lesson.examples as example, i (example.id)}
					<li>
						<p class="text" lang={textLang} data-p={exampleStart + i}>
							<span data-r="0">{example.text}</span>
						</p>
						{#if showReadings && example.reading}<p class="reading">{example.reading}</p>{/if}
						<p class="translation">{example.translation}</p>
					</li>
				{/each}
			</ul>
		</div>

		<p class="practice">
			<a class="button" href={practiceHref}>{t('grammar.lesson.practice')}</a>
		</p>

		<nav class="neighbours" aria-label={t('grammar.lesson.lessons')}>
			{#if data.view.prev}
				<a href={grammarHref({ view: 'lesson', pack, lesson: data.view.prev })}>{t('grammar.lesson.previous')}</a>
			{:else}<span></span>{/if}
			{#if data.view.next}
				<a href={grammarHref({ view: 'lesson', pack, lesson: data.view.next })}>{t('grammar.lesson.next')}</a>
			{/if}
		</nav>

		<footer class="credits">
			{data.view.pack.name} · {data.view.pack.license} · {data.view.pack.attribution}
		</footer>

		<PopupStackView {lookup} {studyWorkspaceId} />
	{/if}
</main>

<style>
	.lesson {
		max-width: 46rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.back a,
	.neighbours a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}

	h1 {
		margin: 0.25rem 0;
	}

	.summary {
		margin: 0 0 1rem;
		color: var(--readable-muted);
	}

	.pattern {
		margin: 0 0 1rem;
		padding: 0.6rem 0.9rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-inline-start: 4px solid var(--accent);
		border-radius: 0.4rem;
		background: color-mix(in srgb, currentColor 5%, transparent);
		font-size: 1.25rem;
	}

	.pattern p {
		margin: 0.2rem 0;
	}

	.body p {
		margin: 0 0 0.8rem;
		line-height: 1.6;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
	}

	.examples {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.9rem;
	}

	.examples p {
		margin: 0;
	}

	.text {
		font-size: 1.6rem;
		line-height: 1.7;
	}

	.reading {
		color: var(--readable-muted);
	}

	.translation {
		color: var(--readable-muted);
	}

	.practice {
		margin: 1.5rem 0 0.5rem;
	}

	.button {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 1.4rem;
		border-radius: 0.4rem;
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
		text-decoration: none;
	}

	.button:focus-visible,
	a:focus-visible {
		outline: 2px solid var(--focus-colour);
		outline-offset: 2px;
	}

	.neighbours {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	.credits {
		margin-top: 1rem;
		font-size: 0.85rem;
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
