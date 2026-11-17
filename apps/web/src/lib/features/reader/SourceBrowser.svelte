<script lang="ts">
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { onMount, tick } from 'svelte';
	import { ApiError } from '$lib/api/client';
	import {
		SOURCE_SEARCH_LIMIT,
		browseSource,
		importFromSource,
		listBooks,
		listSources,
		searchSource
	} from '$lib/api/library';
	import type { Book, SourceInfo, SourceResult } from '$lib/api/types';
	import WorkspaceLabel from '$lib/components/WorkspaceLabel.svelte';
	import { languageLabel } from '$lib/languages';
	import { workspaces } from '$lib/workspaces';
	import { currentStudyDay } from '$lib/time/zone';
	import { browseSeed, shuffleSeed } from './browse';
	import { apiErrorMessage } from './errors';
	import { libraryKey } from './libraryKey';
	import { LIBRARY_HREF, bookHref } from './route';
	import { resultCountText } from './sourceResults';

	// Imports go to the selected workspace's library, and only works in its
	// language can be imported there.
	const workspace = $derived($workspaces.current);
	const workspaceId = $derived(workspace?.id ?? null);
	const language = $derived(workspace?.language ?? '');

	let sources = $state<SourceInfo[]>([]);
	// Set once the user picks a tab: from then on their choice is kept.
	let userPicked = false;
	let active = $state('');
	let sourcesError = $state('');
	let loadingSources = $state(true);
	let tabButtons = $state<HTMLButtonElement[]>([]);

	let query = $state('');
	let results = $state<SourceResult[]>([]);
	let searched = $state(false);
	let searching = $state(false);
	let searchError = $state('');
	let showAll = $state(false);
	let requestCounter = 0;

	// The browse assortment of the active source: today's, until Shuffle.
	let seed = $state(browseSeed(new Date(), currentStudyDay()));
	let suggestions = $state<SourceResult[]>([]);
	let browsing = $state(false);
	let browseError = $state('');
	let browseCounter = 0;
	// Bumped by Retry: asks for the same assortment again.
	let browseAttempt = $state(0);

	// Works in a library, by libraryKey (workspace, source, id): the book,
	// or null when the server said it was already there (409).
	let inLibrary = $state<Record<string, Book | null>>({});
	let importing = $state<string | null>(null);
	let importError = $state('');
	let importStatus = $state('');

	const activeSource = $derived(sources.find((s) => s.id === active) ?? null);
	const servesLanguage = $derived(
		!!activeSource && !!language && activeSource.languages.includes(language)
	);
	const visible = $derived(
		showAll ? results : results.filter((r) => !r.language || r.language === language)
	);
	const showingSearch = $derived(searched || searching);

	async function loadSources(): Promise<void> {
		loadingSources = true;
		sourcesError = '';
		try {
			sources = await listSources();
			// A retry keeps the tab the user picked, if that source is still there.
			if (!userPicked || !sources.some((s) => s.id === active)) {
				const lang = language;
				active = (sources.find((s) => s.languages.includes(lang)) ?? sources[0])?.id ?? '';
			}
		} catch (err) {
			sourcesError = apiErrorMessage(err, 'list');
		} finally {
			loadingSources = false;
		}
	}

	onMount(loadSources);

	// Until the user picks a tab, the first source with texts in the
	// workspace language is shown (the workspace list may load after the
	// sources, and the header may switch the workspace).
	$effect(() => {
		const lang = language;
		if (userPicked || sources.length === 0) return;
		const match = sources.find((s) => s.languages.includes(lang));
		if (match && match.id !== active) {
			active = match.id;
			seed = browseSeed(new Date(), currentStudyDay());
			clearSearch();
		}
	});

	// The works already in this workspace's library show "In library".
	$effect(() => {
		const id = workspaceId;
		if (id === null) return;
		let stale = false;
		listBooks(id).then(
			(books) => {
				if (stale) return;
				for (const book of books) {
					const key = libraryKey(id, book.source, book.sourceId);
					if (!(key in inLibrary)) inLibrary[key] = book;
				}
			},
			() => {
				// Only a hint: importing still answers 409 for a duplicate.
			}
		);
		return () => {
			stale = true;
		};
	});

	// Suggestions of the active source in the workspace language.
	$effect(() => {
		const source = active;
		const lang = language;
		const s = seed;
		void browseAttempt;
		const ok = servesLanguage;
		const ticket = ++browseCounter;
		suggestions = [];
		browseError = '';
		if (!source || !ok) {
			browsing = false;
			return;
		}
		browsing = true;
		browseSource(source, { language: lang, seed: s }).then(
			(found) => {
				if (ticket !== browseCounter) return;
				suggestions = found;
				browsing = false;
			},
			(err) => {
				if (ticket !== browseCounter) return;
				browseError = apiErrorMessage(err, 'browse');
				browsing = false;
			}
		);
	});

	function clearSearch(): void {
		results = [];
		searched = false;
		searchError = '';
		requestCounter++; // drop any in-flight search
		searching = false;
	}

	function pick(id: string): void {
		userPicked = true;
		if (id === active) return;
		active = id;
		seed = browseSeed(new Date(), currentStudyDay());
		importError = '';
		clearSearch();
	}

	// Tabs: arrow keys move and select, wrapping around; Home/End jump.
	async function tabKey(event: KeyboardEvent, index: number): Promise<void> {
		const count = sources.length;
		let next = -1;
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % count;
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + count) % count;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = count - 1;
		if (next < 0) return;
		event.preventDefault();
		pick(sources[next].id);
		await tick();
		tabButtons[next]?.focus();
	}

	async function search(event: Event): Promise<void> {
		event.preventDefault();
		const q = query.trim();
		if (!q || !active) return;
		const ticket = ++requestCounter;
		searching = true;
		searchError = '';
		importError = '';
		try {
			const found = await searchSource(active, q);
			if (ticket !== requestCounter) return;
			results = found;
			searched = true;
		} catch (err) {
			if (ticket !== requestCounter) return;
			results = [];
			searched = true;
			searchError = apiErrorMessage(err, 'search');
		} finally {
			if (ticket === requestCounter) searching = false;
		}
	}

	async function doImport(result: SourceResult): Promise<void> {
		const id = workspaceId;
		if (importing !== null || id === null) return;
		const source = active;
		const key = libraryKey(id, source, result.sourceId);
		importing = key;
		importError = '';
		importStatus = '';
		try {
			inLibrary[key] = await importFromSource(source, result.sourceId, id);
			importStatus = t('reader.sources.imported', { title: result.title });
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				inLibrary[key] = null;
				importStatus = t('reader.sources.already', { title: result.title });
			} else {
				importError = apiErrorMessage(err, 'import');
			}
		} finally {
			importing = null;
		}
	}
</script>

{#snippet work(result: SourceResult)}
	{@const key = workspaceId === null ? '' : libraryKey(workspaceId, active, result.sourceId)}
	{@const done = key !== '' && key in inLibrary}
	{@const other = !!result.language && result.language !== language}
	<li>
		<div class="info">
			<strong lang={result.language || undefined}>{result.title}</strong>
			<span class="meta">
				<span lang={result.language || undefined}>{result.author || t('reader.library.unknownAuthor')}</span
				>{result.language ? ` · ${languageLabel(result.language)}` : ''}{result.note
					? ` · ${result.note}`
					: ''}
			</span>
			{#if result.reading}
				<span class="reading"
					><Msg key="reader.sources.matchedReading" args={{ reading: result.reading }}
						>{#snippet reading(text: string)}<span lang={result.language || undefined}>{text}</span>{/snippet}</Msg
					></span
				>
			{/if}
		</div>
		{#if done}
			<span class="in-library">
				{t('reader.sources.inLibrary')}
				{#if inLibrary[key]}
					<a href={bookHref(inLibrary[key]!.id, 0)}>{t('reader.sources.open')}</a>
				{/if}
			</span>
		{:else if other}
			<span class="meta">{t('reader.sources.needs', { language: languageLabel(result.language) })}</span>
		{:else}
			<button
				type="button"
				disabled={importing !== null || workspaceId === null}
				onclick={() => doImport(result)}
			>
				{importing === key ? t('reader.sources.importing') : t('reader.sources.import')}
			</button>
		{/if}
	</li>
{/snippet}

<div class="sources">
	<p><a href={LIBRARY_HREF}>{t('reader.sources.back')}</a></p>
	<h1 class="heading">
		{t('reader.sources.title')}
		{#if workspace}<WorkspaceLabel {workspace} list={$workspaces.list} size={18} />{/if}
	</h1>
	{#if workspace}
		<p class="hint">{t('reader.sources.importsGo', { language: languageLabel(language) })}</p>
	{/if}

	{#if loadingSources}
		<p>{t('reader.sources.loading')}</p>
	{:else if sourcesError}
		<p class="error" role="alert">{sourcesError}</p>
		<button type="button" onclick={loadSources}>{t('reader.sources.retry')}</button>
	{:else if sources.length === 0}
		<p>{t('reader.sources.none')}</p>
	{:else}
		<div class="tabs" role="tablist" aria-label={t('reader.sources.tabs')}>
			{#each sources as source, i (source.id)}
				<button
					type="button"
					role="tab"
					id="source-tab-{source.id}"
					aria-selected={source.id === active}
					aria-controls="source-panel"
					tabindex={source.id === active ? 0 : -1}
					bind:this={tabButtons[i]}
					onclick={() => pick(source.id)}
					onkeydown={(e) => tabKey(e, i)}>{source.name}</button
				>
			{/each}
		</div>

		<div class="panel" id="source-panel" role="tabpanel" aria-labelledby="source-tab-{active}">
			<form onsubmit={search} role="search">
				<label for="source-query"
					>{activeSource ? t('reader.sources.searchNamed', { name: activeSource.name }) : t('reader.sources.searchSource')}</label
				>
				<input
					id="source-query"
					type="search"
					placeholder={t('reader.sources.placeholder')}
					bind:value={query}
				/>
				<button type="submit" disabled={searching || !query.trim()}>{t('reader.sources.search')}</button>
				{#if showingSearch}
					<button type="button" class="link" onclick={clearSearch}>{t('reader.sources.backToSuggestions')}</button>
				{/if}
			</form>

			<p class="visually-hidden" role="status" aria-live="polite">{importStatus}</p>
			{#if importError}
				<p class="error" role="alert">{importError}</p>
			{/if}

			{#if showingSearch}
				<section aria-labelledby="results-heading">
					<h2 id="results-heading" class="visually-hidden">{t('reader.sources.results')}</h2>
					<label class="toggle">
						<input type="checkbox" bind:checked={showAll} /> {t('reader.sources.allLanguages')}
					</label>
					<p role="status" aria-live="polite">
						{#if searching}{t('reader.sources.searching')}{:else if searched && !searchError}{resultCountText(
								visible.length,
								results.length,
								SOURCE_SEARCH_LIMIT
							)}{/if}
					</p>
					{#if searchError}
						<p class="error" role="alert">{searchError}</p>
					{/if}
					<ul class="results">
						{#each visible as result (result.sourceId)}
							{@render work(result)}
						{/each}
					</ul>
				</section>
			{:else}
				<section aria-labelledby="browse-heading">
					<div class="browse-head">
						<h2 id="browse-heading">{t('reader.sources.suggestions')}</h2>
						{#if servesLanguage}
							<button type="button" onclick={() => (seed = shuffleSeed())} disabled={browsing}>
								{t('reader.sources.shuffle')}
							</button>
						{/if}
					</div>
					{#if !workspace}
						<p class="hint">{t('reader.sources.chooseWorkspace')}</p>
					{:else if !servesLanguage}
						<p class="hint">{t('reader.sources.noTexts', { source: activeSource?.name ?? '', language: languageLabel(language) })}</p>
					{:else if browsing}
						<p role="status" aria-live="polite">
							{t('reader.sources.loadingSuggestions')}
						</p>
					{:else if browseError}
						<p class="error" role="alert">{browseError}</p>
						<button type="button" onclick={() => browseAttempt++}>{t('reader.sources.retry')}</button>
					{:else if suggestions.length === 0}
						<p class="hint">
							{t('reader.sources.noSuggestions')}
						</p>
					{:else}
						<ul class="results">
							{#each suggestions as result (result.sourceId)}
								{@render work(result)}
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		</div>
	{/if}

	<p class="attribution">
		{t('reader.sources.attribution')}
	</p>
</div>

<style>
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}

	.hint {
		color: var(--readable-muted);
	}

	/* Tabs: an underlined row that wraps on narrow screens. */
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.25rem;
		margin: 1rem 0 0;
		border-bottom: 1px solid color-mix(in srgb, currentColor 22%, transparent);
	}

	[role='tab'] {
		font: inherit;
		padding: 0.5rem 0.9rem;
		margin-bottom: -1px;
		border: none;
		border-bottom: 2px solid transparent;
		border-radius: 0.3rem 0.3rem 0 0;
		background: transparent;
		color: var(--readable-muted);
		cursor: pointer;
	}

	[role='tab']:hover {
		color: var(--text);
		background: color-mix(in srgb, currentColor 6%, transparent);
	}

	[role='tab'][aria-selected='true'] {
		font-weight: 600;
		color: var(--text);
		border-bottom-color: var(--accent);
	}

	[role='tab']:focus-visible {
		outline: 2px solid var(--focus-colour);
		outline-offset: -2px;
	}

	.panel {
		padding-top: 1rem;
	}

	form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	input[type='search'] {
		min-width: min(18rem, 100%);
	}

	.link {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: var(--reading-accent);
		text-decoration: underline;
		cursor: pointer;
	}

	.browse-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem 1rem;
	}

	.browse-head h2 {
		font-size: 1.15rem;
		margin: 1rem 0 0.25rem;
	}

	.results {
		list-style: none;
		padding: 0;
	}

	.results li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
	}

	.info {
		display: flex;
		flex-direction: column;
	}

	.meta,
	.attribution,
	.reading {
		font-size: 0.9rem;
		color: var(--readable-muted);
	}

	.in-library {
		display: inline-flex;
		gap: 0.5rem;
		align-items: baseline;
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
