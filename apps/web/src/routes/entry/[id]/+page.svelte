<script lang="ts">
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { getCharsUnderRadical, getEntry } from '$lib/api/entries';
	import type { Entry, EntryBase } from '$lib/api/types';
	import Badges from '$lib/components/Badges.svelte';
	import Readings from '$lib/components/Readings.svelte';
	import Senses from '$lib/components/Senses.svelte';
	import Sentences from '$lib/components/Sentences.svelte';
	import StrokePlayer from '$lib/components/StrokePlayer.svelte';

	let entry = $state<Entry | null>(null);
	let chars = $state<EntryBase[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let error = $state('');

	// Guards against a slow earlier request overwriting a newer entry.
	let requestSeq = 0;

	function parseEntryId(raw: string | undefined): number | null {
		if (!raw || !/^\d+$/.test(raw)) return null;
		const id = Number(raw);
		return Number.isSafeInteger(id) && id > 0 ? id : null;
	}

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	async function load(id: number): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		notFound = false;
		error = '';
		entry = null;
		chars = [];
		try {
			const [loaded, underRadical] = await Promise.all([
				getEntry(id),
				getCharsUnderRadical(id)
			]);
			if (seq !== requestSeq) return;
			entry = loaded;
			chars = underRadical;
		} catch (err) {
			if (seq !== requestSeq) return;
			if (err instanceof ApiError && err.status === 404) {
				notFound = true;
			} else {
				error = message(err, 'Could not load this entry.');
			}
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	function retry(): void {
		const id = entryId;
		if (id !== null) void load(id);
	}

	const entryId = $derived(parseEntryId(page.params.id));

	// The route param is the source of truth: loading it also makes
	// navigating between entries refetch instead of showing stale data.
	$effect(() => {
		const id = entryId;
		if (id === null) {
			requestSeq++;
			entry = null;
			chars = [];
			loading = false;
			error = '';
			notFound = true;
			return;
		}
		void load(id);
	});
</script>

<main class="entry-page">
	{#if loading}
		<p class="hint" aria-live="polite">Loading entry…</p>
	{:else if notFound}
		<section class="not-found">
			<h1>Entry not found</h1>
			<p>There is no entry with this id, or it may have been removed.</p>
			<p><a href="/search">Back to search</a></p>
		</section>
	{:else if error}
		<p class="error" role="alert">{error}</p>
		<button type="button" class="retry" onclick={retry}>Try again</button>
	{:else if entry}
		<header class="head">
			<div>
				<h1 class="written">{entry.written}</h1>
				<div class="chips">
					<span class="chip">{entry.kind}</span>
					<span class="chip">{entry.language}</span>
				</div>
				{#if entry.kind === 'character' && entry.language === 'zh'}
					<StrokePlayer char={entry.written} />
				{/if}
			</div>
			<a class="edit" href={`/entry/${entry.id}?edit=1`}>Edit</a>
		</header>

		<Readings readings={entry.readings} />
		<Badges badges={entry.badges} />
		<Senses senses={entry.senses} />

		{#if entry.variants.length > 0}
			<section class="variants" aria-labelledby="variants-heading">
				<h2 id="variants-heading">Variants</h2>
				<ul>
					{#each entry.variants as variant (variant.id)}
						<li>
							<a href={`/entry/${variant.id}`}>{variant.written}</a>
							{#if variant.readings.length > 0}
								<span class="reading">{variant.readings[0].value}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if entry.radicalId !== null}
			<section class="radical" aria-labelledby="radical-heading">
				<h2 id="radical-heading">Radical</h2>
				<p><a href={`/entry/${entry.radicalId}`}>Radical entry #{entry.radicalId}</a></p>
			</section>
		{/if}

		{#if chars.length > 0}
			<section class="chars" aria-labelledby="chars-heading">
				<h2 id="chars-heading">Characters under this radical</h2>
				<ul>
					{#each chars as char (char.id)}
						<li>
							<a href={`/entry/${char.id}`}>{char.written}</a>
							{#if char.readings.length > 0}
								<span class="reading">{char.readings[0].value}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<Sentences sentences={entry.sentences} />
	{/if}
</main>

<style>
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

	.not-found h1 {
		margin-bottom: 0.5rem;
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.written {
		margin: 0;
		font-size: 4rem;
		line-height: 1.05;
		/* Give the written form room without letting a long word overflow. */
		overflow-wrap: anywhere;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.6rem;
	}

	.chip {
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 0.15rem 0.5rem;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 999px;
		opacity: 0.8;
	}

	.edit {
		font-size: 0.9rem;
		padding: 0.4rem 0.9rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		text-decoration: none;
		color: inherit;
	}

	.edit:hover,
	.edit:focus-visible {
		border-color: #0b6bcb;
		color: #0b6bcb;
	}

	.variants,
	.radical,
	.chars {
		margin-top: 2rem;
	}

	.variants h2,
	.radical h2,
	.chars h2 {
		margin: 0;
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.variants ul,
	.chars ul {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.variants li,
	.chars li {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
	}

	.variants a,
	.chars a,
	.radical a {
		color: inherit;
		text-decoration: none;
		font-weight: 600;
	}

	.variants a:hover,
	.chars a:hover,
	.radical a:hover,
	.variants a:focus-visible,
	.chars a:focus-visible,
	.radical a:focus-visible {
		text-decoration: underline;
	}

	.reading {
		font-size: 0.8rem;
		opacity: 0.7;
	}

	.radical p {
		margin: 0.5rem 0 0;
	}
</style>
