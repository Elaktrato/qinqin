<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError } from '$lib/api/client';
	import { SOURCE_SEARCH_LIMIT, importFromSource, listSources, searchSource } from '$lib/api/library';
	import type { Book, SourceInfo, SourceResult } from '$lib/api/types';
	import { currentLanguage } from '$lib/workspaces';
	import { apiErrorMessage } from './errors';
	import { libraryKey } from './libraryKey';
	import { LIBRARY_HREF, bookHref } from './route';
	import { resultCountText } from './sourceResults';

	let sources = $state<SourceInfo[]>([]);
	let active = $state('');
	let sourcesError = $state('');
	let loadingSources = $state(true);

	let query = $state('');
	let results = $state<SourceResult[]>([]);
	let searched = $state(false);
	let searching = $state(false);
	let searchError = $state('');
	let showAll = $state(false);
	let requestCounter = 0;

	// Imports by sourceId: the created book, or null when it was already there.
	let inLibrary = $state<Record<string, Book | null>>({});
	let importing = $state<string | null>(null);
	let importError = $state('');
	let importStatus = $state('');

	const filterLanguage = $derived(
		$currentLanguage === 'zh' || $currentLanguage === 'ja' ? $currentLanguage : null
	);
	const visible = $derived(
		filterLanguage && !showAll
			? results.filter((r) => !r.language || r.language === filterLanguage)
			: results
	);

	async function loadSources(): Promise<void> {
		loadingSources = true;
		sourcesError = '';
		try {
			sources = await listSources();
			active = sources[0]?.id ?? '';
		} catch (err) {
			sourcesError = apiErrorMessage(err, 'list');
		} finally {
			loadingSources = false;
		}
	}

	onMount(loadSources);

	function pick(id: string): void {
		active = id;
		results = [];
		searched = false;
		searchError = '';
		importError = '';
		requestCounter++; // drop any in-flight search for the previous source
		searching = false;
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
		if (importing !== null) return;
		const source = active;
		const key = libraryKey(source, result.sourceId);
		importing = key;
		importError = '';
		importStatus = '';
		try {
			inLibrary[key] = await importFromSource(source, result.sourceId);
			importStatus = `Imported "${result.title}".`;
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				inLibrary[key] = null;
			}
			importError = apiErrorMessage(err, 'import');
		} finally {
			importing = null;
		}
	}
</script>

<main class="sources">
	<p><a href={LIBRARY_HREF}>Back to library</a></p>
	<h1>Browse sources</h1>

	{#if loadingSources}
		<p>Loading sources…</p>
	{:else if sourcesError}
		<p class="error" role="alert">{sourcesError}</p>
		<button type="button" onclick={loadSources}>Retry</button>
	{:else if sources.length === 0}
		<p>No sources are available.</p>
	{:else}
		<div class="tabs" role="group" aria-label="Sources">
			{#each sources as source (source.id)}
				<button
					type="button"
					class:selected={source.id === active}
					aria-pressed={source.id === active}
					onclick={() => pick(source.id)}>{source.name}</button
				>
			{/each}
		</div>

		<form onsubmit={search} role="search">
			<label for="source-query">Search title or author</label>
			<input id="source-query" type="search" bind:value={query} />
			<button type="submit" disabled={searching || !query.trim()}>Search</button>
		</form>

		{#if filterLanguage}
			<label class="toggle">
				<input type="checkbox" bind:checked={showAll} /> Show all languages
			</label>
		{/if}

		<p role="status" aria-live="polite">
			{#if searching}Searching…{:else if searched && !searchError}{resultCountText(
					visible.length,
					results.length,
					SOURCE_SEARCH_LIMIT
				)}{/if}
		</p>
		<p class="visually-hidden" role="status" aria-live="polite">{importStatus}</p>
		{#if searchError}
			<p class="error" role="alert">{searchError}</p>
		{/if}
		{#if importError}
			<p class="error" role="alert">{importError}</p>
		{/if}

		<ul class="results">
			{#each visible as result (result.sourceId)}
				{@const key = libraryKey(active, result.sourceId)}
				{@const done = key in inLibrary}
				<li>
					<div class="info">
						<strong>{result.title}</strong>
						<span class="meta">
							{result.author || 'Unknown author'}{result.language ? ` · ${result.language}` : ''}{result.note
								? ` · ${result.note}`
								: ''}
						</span>
					</div>
					{#if done}
						<span>
							In library
							{#if inLibrary[key]}
								<a href={bookHref(inLibrary[key]!.id, 0)}>Imported — open it</a>
							{/if}
						</span>
					{:else}
						<button
							type="button"
							disabled={importing !== null}
							onclick={() => doImport(result)}
						>
							{importing === key ? 'Importing…' : 'Import'}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<p class="attribution">
		Texts from Aozora Bunko (public domain works only) and Project Gutenberg (public domain in
		the USA).
	</p>
</main>

<style>
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 1rem 0;
	}

	.tabs .selected {
		font-weight: 700;
		text-decoration: underline;
	}

	form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
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
	.attribution {
		font-size: 0.9rem;
		opacity: 0.75;
	}

	.error {
		color: #b3261e;
	}
</style>
