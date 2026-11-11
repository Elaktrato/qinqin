<script lang="ts">
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { search } from '$lib/api/search';
	import type { SearchHit } from '$lib/api/types';
	import { record } from '$lib/events';
	import { currentLanguage, workspaces } from '$lib/workspaces';

	let query = $state('');
	let hits = $state<SearchHit[]>([]);
	let loading = $state(false);
	let error = $state('');
	let searched = $state(false);
	// The query whose results are shown, so the retry button and the
	// empty state refer to it even after the input changes.
	let activeQuery = $state('');

	const lang = $derived($currentLanguage);
	const urlQuery = $derived(page.url.searchParams.get('q') ?? '');

	// Guards against a slow earlier request overwriting a newer result.
	let requestSeq = 0;

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	function sourceLabel(source: string): string {
		return source === 'written' ? 'written form' : source;
	}

	async function runSearch(q: string, language: string): Promise<void> {
		const seq = ++requestSeq;
		activeQuery = q;
		searched = true;
		loading = true;
		error = '';
		try {
			const list = await search(language, q);
			if (seq !== requestSeq) return;
			hits = list;
		} catch (err) {
			if (seq !== requestSeq) return;
			hits = [];
			error = message(err, 'Search failed.');
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		const q = query.trim();
		const workspace = get(workspaces).current;
		if (q && workspace) void record('lookup', workspace.id, { query: q });
		void goto(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
	}

	function retry(): void {
		if (lang && activeQuery) void runSearch(activeQuery, lang);
	}

	// The URL is the source of truth for the query: the input mirrors it
	// so reloads and shared links show the same search.
	$effect(() => {
		query = urlQuery;
	});

	// Search whenever the URL query or the workspace language changes.
	$effect(() => {
		const q = urlQuery.trim();
		const language = lang;
		if (!q || !language) {
			requestSeq++;
			hits = [];
			activeQuery = q;
			loading = false;
			error = '';
			searched = false;
			return;
		}
		void runSearch(q, language);
	});
</script>

<main class="search-page">
	<h1>Search</h1>

	<form class="search" role="search" onsubmit={submit}>
		<input
			name="q"
			type="search"
			bind:value={query}
			aria-label="Search entries"
			placeholder="Search entries…"
		/>
		<button type="submit">Search</button>
	</form>

	{#if lang === null}
		<p class="hint">
			No workspace selected. Create or select a workspace in the header to search.
			<a href="/settings">Open settings</a>
		</p>
	{:else if loading}
		<p class="hint" aria-live="polite">Searching…</p>
	{:else if error}
		<p class="error" role="alert">{error}</p>
		<button type="button" class="retry" onclick={retry}>Try again</button>
	{:else if searched && hits.length === 0}
		<p class="hint">No results for “{activeQuery}”.</p>
	{:else if hits.length > 0}
		<ul class="results" aria-label="Search results">
			{#each hits as hit (hit.id)}
				<li class="result">
					<a class="written" href={`/entry/${hit.id}`}>{hit.written}</a>

					<div class="details">
						{#if hit.readings.length > 0}
							<span class="readings">
								{#each hit.readings as reading (reading.ord)}
									<span class="reading" data-type={reading.type}>{reading.value}</span>
								{/each}
							</span>
						{/if}
						<span class="source">matched {sourceLabel(hit.source)}</span>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="hint">Enter a query to search entries.</p>
	{/if}
</main>

<style>
	.search {
		display: flex;
		gap: 0.5rem;
		max-width: 32rem;
	}

	.search input {
		flex: 1;
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}

	.search button {
		font: inherit;
		font-weight: 600;
		padding: 0.6rem 1rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		cursor: pointer;
	}

	.hint {
		margin-top: 1.5rem;
		opacity: 0.75;
	}

	.error {
		margin-top: 1.5rem;
		color: #c62828;
		font-weight: 600;
	}

	.retry {
		margin-top: 0.75rem;
		font: inherit;
		padding: 0.45rem 0.85rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.results {
		list-style: none;
		margin: 1.5rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.result {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.75rem 1rem;
		padding: 0.65rem 0.85rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
	}

	.written {
		font-size: 1.6rem;
		line-height: 1.2;
		font-weight: 600;
		text-decoration: none;
	}

	.written:hover,
	.written:focus-visible {
		text-decoration: underline;
	}

	.details {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35rem 0.85rem;
	}

	.readings {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.reading {
		font-size: 1rem;
	}

	.source {
		font-size: 0.8rem;
		opacity: 0.7;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
	}
</style>
