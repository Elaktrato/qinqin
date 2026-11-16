<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api/client';
	import { getEntryAudio, type AudioResolution } from '$lib/api/audio';
	import { getCharsUnderRadical, getEntry } from '$lib/api/entries';
	import type { Entry, EntryBase, EntryDetail } from '$lib/api/types';
	import AddToStudy from '$lib/components/AddToStudy.svelte';
	import Badges from '$lib/components/Badges.svelte';
	import EntryEditor from '$lib/components/EntryEditor.svelte';
	import Readings from '$lib/components/Readings.svelte';
	import Senses from '$lib/components/Senses.svelte';
	import Sentences from '$lib/components/Sentences.svelte';
	import StrokePlayer from '$lib/components/StrokePlayer.svelte';
	import { token } from '$lib/auth';
	import { creditLine, headwordClips, readingClips } from '$lib/audio/button';
	import { readAudioSettings } from '$lib/audio/settings';
	import PlayButton from '$lib/components/PlayButton.svelte';
	import { record } from '$lib/events';
	import { loadEntryExtras } from '$lib/entry/extras';
	import { formatReading } from '$lib/format';
	import { languageLabel } from '$lib/languages';
	import { entryRadicalLinks } from '$lib/radicals/selection';
	import { workspaces } from '$lib/workspaces';
	import EntryNote from '$lib/notes/EntryNote.svelte';

	let entry = $state<Entry | null>(null);
	let chars = $state<EntryBase[]>([]);
	// The radical's written form, once fetched; empty shows the id instead.
	let radicalWritten = $state('');
	let loading = $state(true);
	let notFound = $state(false);
	let error = $state('');
	// The entry a view event was already recorded for, so a re-render
	// or a workspace arriving late never double-counts one visit.
	let viewedEntry = $state<number | null>(null);

	// The entry's recordings (signed-in users only; the device voice needs none).
	let audio = $state<AudioResolution | null>(null);

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
		radicalWritten = '';
		try {
			const loaded = await getEntry(id);
			if (seq !== requestSeq) return;
			entry = loaded;
			// The optional sections must never blank the page: they load after
			// the entry is on screen and fall back to nothing on failure.
			void loadExtras(loaded, seq);
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

	async function loadExtras(loaded: Entry, seq: number): Promise<void> {
		const extras = await loadEntryExtras(loaded, { chars: getCharsUnderRadical, entry: getEntry });
		if (seq !== requestSeq) return;
		chars = extras.chars;
		radicalWritten = extras.radicalWritten;
	}

	function retry(): void {
		const id = entryId;
		if (id !== null) void load(id);
	}

	const entryId = $derived(parseEntryId(page.params.id));
	const editing = $derived(page.url.searchParams.get('edit') === '1');

	// Cancel drops ?edit=1 without a round trip or a scroll jump. The
	// entry effect keys on the id only, so the view is not refetched.
	function closeEditor(): void {
		const id = entryId;
		if (id === null) return;
		void goto(`/entry/${id}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function handleSaved(updated: EntryDetail): void {
		// The PUT response is the caller's patched view, so it replaces
		// the entry without another GET.
		entry = updated;
	}

	// The route param is the source of truth: loading it also makes
	// navigating between entries refetch instead of showing stale data.
	$effect(() => {
		const id = entryId;
		if (id === null) {
			requestSeq++;
			entry = null;
			chars = [];
			radicalWritten = '';
			loading = false;
			error = '';
			notFound = true;
			return;
		}
		void load(id);
	});

	const lookupLinks = $derived(
		entry === null ? {} : entryRadicalLinks(entry.written, entry.kind, radicalWritten)
	);
	const audioSettings = $derived(readAudioSettings($workspaces.current?.settings));
	const headClips = $derived(headwordClips(audio));
	const audioFor = $derived(entry ? readingClips(audio, entry.readings) : null);
	// The credit of every recording this page can play.
	const credit = $derived(
		creditLine([...headClips, ...(audio?.syllables ?? []).flatMap((slot) => slot ?? [])])
	);

	// Load the recordings once the entry is known; a failure just means no audio.
	$effect(() => {
		const id = entry?.id ?? null;
		audio = null;
		if (id === null || !$token) return;
		void getEntryAudio(id).then(
			(r) => {
				if (entry?.id === id) audio = r;
			},
			() => {}
		);
	});

	// Record the visit once the entry and the workspace are both known:
	// the shell may still be loading workspaces when the entry lands.
	$effect(() => {
		const viewed = entry?.id ?? null;
		const workspace = $workspaces.current?.id ?? null;
		if (viewed === null || workspace === null || viewedEntry === viewed) return;
		viewedEntry = viewed;
		void record('view', workspace, { entryId: viewed });
	});
</script>

<svelte:head>
	<title>{pageTitle(notFound ? 'Entry not found' : (entry?.written ?? ''))}</title>
</svelte:head>

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
				<div class="headword">
					<h1 class="written">{entry.written}</h1>
					<PlayButton
						clips={headClips}
						speakText={entry.written}
						lang={entry.language}
						deviceVoice={audioSettings.deviceVoice}
						label={entry.written}
					/>
				</div>
				<div class="chips">
					<span class="chip">{entry.kind}</span>
					<span class="chip" title={entry.language}>{languageLabel(entry.language)}</span>
				</div>
				{#if entry.kind === 'character' && entry.language === 'zh'}
					<StrokePlayer char={entry.written} />
				{/if}
			</div>
			<div class="actions">
				<AddToStudy
					entryId={entry.id}
					written={entry.written}
					sentenceId={entry.sentences?.[0]?.id}
					kind={entry.kind}
				/>
				{#if !editing}
					<a class="edit" href={`/entry/${entry.id}?edit=1`}>Edit</a>
				{/if}
			</div>
		</header>

		{#if editing}
			{#key entry.id}
				<EntryEditor entry={entry} onSaved={handleSaved} onCancel={closeEditor} />
			{/key}
		{:else}
			<Readings
				readings={entry.readings}
				audioFor={audioFor ?? undefined}
				word={entry.written}
				lang={entry.language}
				deviceVoice={audioSettings.deviceVoice}
			/>
			{#if credit}
				<p class="credit">{credit}</p>
			{/if}
		{/if}
		<Badges badges={entry.badges} />
		{#key entry.id}
			<Senses senses={entry.senses} />
		{/key}
		{#if !editing && $workspaces.current}
			{#key `${$workspaces.current.id}:${entry.id}`}
				<EntryNote workspaceId={$workspaces.current.id} entryId={entry.id} />
			{/key}
		{/if}

		{#if entry.variants.length > 0}
			<section class="variants" aria-labelledby="variants-heading">
				<h2 id="variants-heading">Variants</h2>
				<ul>
					{#each entry.variants as variant (variant.id)}
						<li>
							<a href={`/entry/${variant.id}`}>{variant.written}</a>
							{#if variant.readings.length > 0}
								<span class="reading">{formatReading(variant.readings[0].type, variant.readings[0].value)}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if entry.radicalId !== null}
			<section class="radical" aria-labelledby="radical-heading">
				<h2 id="radical-heading">Radical</h2>
				<p>
					<a href={`/entry/${entry.radicalId}`}>
						{radicalWritten || `Radical entry #${entry.radicalId}`}
					</a>
					{#if lookupLinks.withRadical}
						· <a href={lookupLinks.withRadical}>All characters with this radical</a>
					{/if}
				</p>
			</section>
		{/if}

		{#if chars.length > 0}
			<section class="chars" aria-labelledby="chars-heading">
				<h2 id="chars-heading">Characters under this radical</h2>
				{#if lookupLinks.browse}
					<p class="browse"><a href={lookupLinks.browse}>Browse by stroke count</a></p>
				{/if}
				<ul>
					{#each chars as char (char.id)}
						<li>
							<a href={`/entry/${char.id}`}>{char.written}</a>
							{#if char.readings.length > 0}
								<span class="reading">{formatReading(char.readings[0].type, char.readings[0].value)}</span>
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

	.headword {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.credit {
		margin: 0.5rem 0 0;
		font-size: 0.8rem;
		opacity: 0.7;
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

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.6rem;
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
