<script lang="ts">
	import { t } from '$lib/i18n';
	import PopupStackView from '$lib/features/reader/PopupStackView.svelte';
	import { LookupController } from '$lib/features/reader/useLookup.svelte';
	import { recordLookup } from '$lib/lookups/sink';
	import { loadDisplayLesson, type DisplayLesson } from './lessonData';
	import { browserReadingsStorage, loadReadings, saveReadings } from './readings';
	import { grammarHref } from './route';
	import { Button } from '$lib/ui';
	import { useSession } from '$lib/context/context';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	const session = useSession();

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
	// Hidden romanisation (#284): an example's reading line follows the workspace's switches.
	const roman = useRomanisation();
	const textLang = $derived(data?.textLang ?? '');

	// Words are added to study in the current workspace only when it is the lesson's language.
	const studyWorkspaceId = $derived(
		session.workspaces.current && session.workspaces.current.language === language ? session.workspaces.current.id : null
	);

	const lookup = new LookupController({
		container: () => container,
		lang: () => language,
		textLang: () => textLang,
		runsOf: (p) => [{ text: texts[p] ?? '' }],
		onLookup: (entryId) => recordLookup(session.lookups.recorder, studyWorkspaceId, { entryId, source: 'lesson' })
	});
	$effect(() => lookup.attach());
	$effect(() => {
		void texts;
		lookup.close();
	});

	$effect(() => {
		const el = container;
		if (!el) return;
		return lookup.listen(el);
	});

	const practiceHref = $derived(grammarHref({ view: 'practice', pack, lesson: lessonId }));
	const hasReadings = $derived(lesson?.examples.some((e) => roman.text(e.reading, language) !== '') ?? false);
</script>

<div class="page-body lesson">
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
					{@const at = example.focus ? example.text.indexOf(example.focus) : -1}
					<li>
						<p class="text" lang={textLang} data-p={exampleStart + i}>
							<span data-r="0"
								>{#if at >= 0}{example.text.slice(0, at)}<span class="target">{example.focus}</span>{example.text.slice(
										at + example.focus.length
									)}{:else}{example.text}{/if}</span
							>
						</p>
						{#if showReadings && roman.text(example.reading, language)}<p class="reading">{example.reading}</p>{/if}
						<p class="translation">{example.translation}</p>
					</li>
				{/each}
			</ul>
		</div>

		<p class="practice">
			<Button variant="primary" href={practiceHref}>{t('grammar.lesson.practice')}</Button>
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
</div>

<style>
		/* No second page container: .page-body owns the column (#106). */
	.back a,
	.neighbours a {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit);
	}

	.back a:focus-visible,
	.neighbours a:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	h1 {
		margin-block: var(--space-1);
	}

	.summary {
		margin-block: 0 var(--space-4);
		color: var(--readable-muted);
	}

	/* The pattern is marked by an accent rule, not a box (#106). */
	.pattern {
		margin-block: 0 var(--space-4);
		padding-inline-start: var(--space-3);
		box-shadow: inset 2px 0 0 var(--accent);
		font-size: var(--font-size-l);
	}

	.pattern p {
		margin-block: var(--space-1);
	}

	.body p {
		margin-block: 0 var(--space-3);
		line-height: var(--line-body);
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
	}

	.examples {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.examples li + li {
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--hair);
	}

	.examples p {
		margin: 0;
	}

	.text {
		font-size: var(--font-size-xl);
		line-height: var(--line-body);
	}

	.target {
		color: var(--reading-accent);
	}

	.reading {
		color: var(--readable-muted);
	}

	.translation {
		color: var(--readable-muted);
	}

	.practice {
		margin-block: var(--space-5) var(--space-2);
	}

	.neighbours {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.credits {
		margin-top: var(--space-4);
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
