<script lang="ts">
	// The Graded readers tab of the Sources page (#231): the catalogue of the workspace language with a level filter;
	// each text's level, kind, length and review state, its new words (glosses, readings through the hidden
	// romanisation rule), and Read (add to the library and open) or Open. Logic: ./catalogue.ts; the add itself is
	// the Sources page's (onread).
	import { t } from '$lib/i18n';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import { gradedCatalogue } from '$lib/api/library';
	import type { Book, GradedText } from '$lib/api/types';
	import { Button, Chip, Select } from '$lib/ui';
	import { apiErrorMessage } from '../errors';
	import { bookHref } from '../route';
	import { KIND_KEYS, levelChoices, textsAt } from './catalogue';

	let {
		language,
		books,
		busy,
		onread
	}: {
		/** The workspace language ('' when no workspace is chosen). */
		language: string;
		/** The workspace's books by text id: the book, or null when the server said it is there (409). */
		books: Record<string, Book | null>;
		/** The id of the text being added, or null. */
		busy: string | null;
		onread: (text: GradedText) => void;
	} = $props();

	const roman = useRomanisation();

	let texts = $state<GradedText[]>([]);
	let loading = $state(true);
	let error = $state('');
	let attempt = $state(0);
	let level = $state('all');

	$effect(() => {
		const lang = language;
		void attempt;
		texts = [];
		error = '';
		level = 'all';
		if (!lang) {
			loading = false;
			return;
		}
		loading = true;
		let stale = false;
		gradedCatalogue(lang).then(
			(found) => {
				if (stale) return;
				texts = found;
				loading = false;
			},
			(err) => {
				if (stale) return;
				error = apiErrorMessage(err, 'list');
				loading = false;
			}
		);
		return () => {
			stale = true;
		};
	});

	const choices = $derived(levelChoices(texts));
	const shown = $derived(textsAt(texts, level === 'all' ? null : Number(level)));
</script>

<section class="graded" aria-labelledby="graded-heading">
	<h2 id="graded-heading">{t('reader.graded.title')}</h2>
	<p class="hint">{t('reader.graded.intro')}</p>
	{#if !language}
		<p class="hint">{t('reader.sources.chooseWorkspace')}</p>
	{:else if loading}
		<p role="status" aria-live="polite">{t('reader.graded.loading')}</p>
	{:else if error}
		<p class="error" role="alert">{error}</p>
		<Button onclick={() => attempt++}>{t('reader.sources.retry')}</Button>
	{:else if texts.length === 0}
		<p class="hint">{t('reader.graded.none')}</p>
	{:else}
		<div class="filter">
			<Select
				label={t('reader.graded.level')}
				id="graded-level"
				bind:value={level}
				options={[
					{ value: 'all', label: t('reader.graded.allLevels') },
					...choices.map((c) => ({ value: String(c.level), label: c.name }))
				]}
			/>
		</div>
		<ul class="texts" data-testid="graded-texts">
			{#each shown as text (text.id)}
				{@const book = books[text.id]}
				<li>
					<div class="info">
						<strong lang={text.language}>{text.title}</strong>
						<span class="chips">
							<Chip tone="accent">{text.levelName}</Chip>
							<Chip>{t(KIND_KEYS[text.kind])}</Chip>
							<Chip>{t('reader.graded.length', { count: text.length })}</Chip>
							{#if !text.humanReviewed}<Chip>{t('reader.graded.reviewedByAgents')}</Chip>{/if}
						</span>
						{#if text.glosses.length > 0}
							<details>
								<summary>{t('reader.graded.newWords', { count: text.glosses.length })}</summary>
								<ul class="glosses">
									{#each text.glosses as gloss (gloss.word)}
										{@const reading = roman.text(gloss.reading, text.language)}
										<li>
											<span lang={text.language}>{gloss.word}</span>{#if reading && reading !== gloss.word}
												<span class="reading" lang={text.language}> {reading}</span>{/if}
											<span class="meaning"> — {gloss.meaning}</span>
										</li>
									{/each}
								</ul>
							</details>
						{/if}
					</div>
					{#if text.id in books}
						<span class="in-library">
							{t('reader.sources.inLibrary')}
							{#if book}<a href={bookHref(book.id, 0)}>{t('reader.sources.open')}</a>{/if}
						</span>
					{:else}
						<Button variant="primary" disabled={busy !== null} onclick={() => onread(text)}>
							{busy === text.id ? t('reader.graded.adding') : t('reader.graded.read')}
						</Button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	h2 {
		font-size: var(--font-size-l);
		margin-block: var(--space-2);
	}

	.hint,
	.reading,
	.meaning {
		color: var(--readable-muted);
	}

	.filter {
		max-width: 16rem;
	}

	.texts {
		list-style: none;
		padding: 0;
	}

	.texts > li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		padding-block: var(--space-2);
		border-bottom: 1px solid var(--hair);
	}

	.info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.glosses {
		margin: var(--space-1) 0 0;
		padding-inline-start: var(--space-4);
		font-size: var(--font-size-label);
		overflow-wrap: anywhere;
	}

	.in-library {
		display: inline-flex;
		gap: var(--space-2);
		align-items: baseline;
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
