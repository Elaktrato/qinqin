<script lang="ts">
	// The unit's reading text (#222, Ruling 23): every word the learner has not reached carries its reading (as the
	// workspace's romanisation setting allows, #284) and is listed below with its gloss; the translation is one tap
	// away. Words are found with the server's segmenter; offline the text shows plain.
	import { getEntry } from '$lib/api/entries';
	import { segmentWithReadings } from '$lib/api/segment';
	import type { CourseText } from '$lib/api/courses';
	import { studyLang } from '$lib/i18n/lang';
	import { getLanguage, t } from '$lib/i18n';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import { Button } from '$lib/ui';
	import { shortGloss } from './flow';
	import { readingParts, unreachedEntries, type ReadingPart } from './readingText';
	import { titleText } from './roadmap';

	let { text, language, reached }: { text: CourseText; language: string; reached: ReadonlySet<number> } = $props();

	const roman = useRomanisation();
	const lang = $derived(studyLang(language) ?? language);
	let parts = $state<ReadingPart[] | null>(null);
	let glosses = $state<Record<number, string | null>>({});
	let showTranslation = $state(false);

	$effect(() => {
		let cancelled = false;
		void segmentWithReadings(language, text.body).then(
			(matches) => {
				if (cancelled) return;
				parts = readingParts(text.body, matches, reached);
				for (const w of unreachedEntries(parts)) {
					void getEntry(w.entryId).then(
						(e) => !cancelled && (glosses = { ...glosses, [w.entryId]: shortGloss(e.senses ?? []) }),
						() => undefined
					);
				}
			},
			() => {
				if (!cancelled) parts = [{ text: text.body, entryId: null, reading: null }];
			}
		);
		return () => {
			cancelled = true;
		};
	});

	const unreached = $derived(parts ? unreachedEntries(parts) : []);
	const translation = $derived(text.translation ? titleText(text.translation, getLanguage()) : null);
</script>

<section class="reading-text" aria-labelledby="text-title">
	<h2 id="text-title" {lang}>{text.title}</h2>
	{#if parts === null}
		<p role="status">{t('common.loading')}</p>
	{:else}
		<p class="body" {lang}>
			{#each parts as part, i (i)}{#if part.reading && roman.shows(part.reading.type)}<ruby>{part.text}<rt>{part.reading.value}</rt></ruby>{:else}{part.text}{/if}{/each}
		</p>
		{#if unreached.length > 0}
			<h3>{t('courses.reading.newWords')}</h3>
			<ul class="new-words">
				{#each unreached as w (w.entryId)}
					<li>
						<span class="form" {lang}>{w.text}</span>
						{#if roman.shows(w.reading.type)}<span class="muted">{w.reading.value}</span>{/if}
						{#if glosses[w.entryId]}<span>{glosses[w.entryId]}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if translation}
			{#if showTranslation}
				<p class="translation">{translation}</p>
			{:else}
				<Button onclick={() => (showTranslation = true)}>{t('courses.reading.showTranslation')}</Button>
			{/if}
		{/if}
	{/if}
</section>

<style>
	.reading-text p,
	h2,
	h3 {
		margin-block: 0 var(--space-2);
		overflow-wrap: anywhere;
	}

	.body {
		font-size: var(--font-size-xl);
		line-height: 2;
	}

	rt {
		font-size: var(--font-size-xs);
		color: var(--readable-muted);
	}

	.new-words {
		list-style: none;
		margin: 0 0 var(--space-3);
		padding: 0;
	}

	.new-words li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding-block: var(--space-1);
		border-block-end: 1px solid var(--hair);
		overflow-wrap: anywhere;
	}

	.form {
		font-weight: var(--weight-medium);
	}

	.muted,
	.translation {
		color: var(--readable-muted);
	}
</style>
