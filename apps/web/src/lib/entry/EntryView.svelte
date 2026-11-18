<script lang="ts">
	import Msg from '$lib/i18n/Msg.svelte';
	import { t } from '$lib/i18n';
	import { formatNumber } from '$lib/i18n/format';
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
	import { viewPayload } from '$lib/eventPayloads';
	import { loadEntryExtras } from '$lib/entry/extras';
	import ReadingText from '$lib/components/ReadingText.svelte';
	import { studyLang } from '$lib/i18n/lang';
	import { languageLabel } from '$lib/languages';
	import { entryRadicalLinks } from '$lib/radicals/selection';
	import { workspaces } from '$lib/workspaces';
	import EntryNote from '$lib/notes/EntryNote.svelte';
	import { joinForms, otherForms } from '$lib/features/reader/entryDisplay';
	import Chip from '$lib/ui/Chip.svelte';
	import { relatedWords } from './related';
	import { decksContaining } from './decks';
	import { getEntryRanks } from '$lib/api/frequency';
	import { getStudyData } from '$lib/study/studyData';

	let {
		entryId: requestedId,
		headingLevel = 1,
		recordView = true,
		focusOnLoad = false,
		ontitle,
		onstate
	}: {
		entryId: number | null;
		headingLevel?: 1 | 2;
		recordView?: boolean;
		/** A phone navigation focuses the entry heading once the entry is on screen. */
		focusOnLoad?: boolean;
		ontitle?: (written: string) => void;
		/** The load's state, so the route's document title can follow it. */
		onstate?: (state: 'loading' | 'ready' | 'notfound' | 'error') => void;
	} = $props();

	let entry = $state<Entry | null>(null);
	let chars = $state<EntryBase[]>([]);
	// The other written forms (事 on the entry shown as こと); search-only ones never.
	const alsoWritten = $derived(
		entry ? otherForms({ forms: entry.forms ?? [], term: entry.written }, Infinity) : []
	);
	// The radical's written form, once fetched; empty shows the id instead.
	let radicalWritten = $state('');
	let rank = $state<number | null>(null);
	let chosenChar = $state<string | null>(null);
	let inDecks = $state(0);
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

	// The word heading, so a phone navigation can move focus into the entry.
	let headingEl = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!focusOnLoad || entry === null || headingEl === null) return;
		headingEl.focus();
	});

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
		chosenChar = null;
		onstate?.('loading');
		try {
			const loaded = await getEntry(id);
			if (seq !== requestSeq) return;
			entry = loaded;
			ontitle?.(loaded.written);
			onstate?.('ready');
			// The optional sections must never blank the page: they load after
			// the entry is on screen and fall back to nothing on failure.
			void loadExtras(loaded, seq);
		} catch (err) {
			if (seq !== requestSeq) return;
			if (err instanceof ApiError && err.status === 404) {
				notFound = true;
				onstate?.('notfound');
			} else {
				error = message(err, t('entry.page.loadFailed'));
				onstate?.('error');
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
		const id = requestedId;
		if (id !== null) void load(id);
	}

	const editing = $derived(page.url.searchParams.get('edit') === '1');

	// Cancel drops ?edit=1 without a round trip or a scroll jump. The
	// entry effect keys on the id only, so the view is not refetched.
	function closeEditor(): void {
		const id = requestedId;
		if (id === null) return;
		void goto(`/entry/${id}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function handleSaved(updated: EntryDetail): void {
		// The PUT response is the caller's patched view, so it replaces
		// the entry without another GET; the route's title follows the edit.
		entry = updated;
		ontitle?.(updated.written);
	}

	// The route param is the source of truth: loading it also makes
	// navigating between entries refetch instead of showing stale data.
	$effect(() => {
		const id = requestedId;
		if (id === null) {
			requestSeq++;
			entry = null;
			chars = [];
			radicalWritten = '';
			loading = false;
			error = '';
			notFound = true;
			onstate?.('notfound');
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
	const related = $derived(entry ? relatedWords(entry) : []);
	const strokeChar = $derived(
		entry?.kind === 'character' ? entry.written : (chosenChar ?? entry?.characters?.[0]?.written ?? null)
	);
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

	// Frequency rank and deck count are optional extras: failures leave them out.
	$effect(() => {
		const current = entry;
		rank = null;
		if (!current) return;
		void getEntryRanks(current.language, [current.id]).then(
			(r) => {
				if (entry?.id === current.id) rank = r.ranks.find((x) => x.id === current.id)?.rank ?? null;
			},
			() => {}
		);
	});

	$effect(() => {
		const current = entry;
		const workspace = $workspaces.current?.id;
		inDecks = 0;
		if (!current || workspace === undefined) return;
		void getStudyData(workspace).then(
			(data) => {
				if (entry?.id === current.id) inDecks = decksContaining(data, current.id);
			},
			() => {}
		);
	});

	// Record the visit once the entry and the workspace are both known:
	// the shell may still be loading workspaces when the entry lands.
	$effect(() => {
		if (!recordView) return;
		const viewed = entry?.id ?? null;
		const workspace = $workspaces.current?.id ?? null;
		if (viewed === null || workspace === null || viewedEntry === viewed) return;
		viewedEntry = viewed;
		void record('view', workspace, viewPayload(viewed));
	});
</script>

<div class="entry-view">
	{#if loading}
		<p class="hint" aria-live="polite">{t('entry.page.loading')}</p>
	{:else if notFound}
		<section class="not-found">
			<h1>{t('entry.page.notFound')}</h1>
			<p>{t('entry.page.notFoundText')}</p>
			<p><a href="/search">{t('entry.page.backToSearch')}</a></p>
		</section>
	{:else if error}
		<p class="error" role="alert">{error}</p>
		<button type="button" class="retry" onclick={retry}>{t('common.action.retry')}</button>
	{:else if entry}
		<header class="head">
			<div>
				<div class="headword">
					<svelte:element this={headingLevel === 1 ? 'h1' : 'h2'} class="written" bind:this={headingEl} tabindex="-1" lang={studyLang(entry.language)}>{entry.written}</svelte:element>
					<PlayButton
						clips={headClips}
						speakText={entry.written}
						lang={entry.language}
						deviceVoice={audioSettings.deviceVoice}
						label={entry.written}
					/>
				</div>
				{#if alsoWritten.length > 0}
					<p class="also-written">
						<Msg key="entry.page.alsoWritten" args={{ forms: joinForms(alsoWritten, entry.language) }}
							>{#snippet forms(text: string)}<span lang={studyLang(entry?.language)}>{text}</span>{/snippet}</Msg
						>
					</p>
				{/if}
				<div class="chips">
					<Chip>{t(entry.kind === 'character' ? 'entry.chips.character' : 'entry.chips.word')}</Chip>
					{#if rank !== null}<Chip>#{t('entry.chips.frequency', { rank: formatNumber(rank) })}</Chip>{/if}
					{#if inDecks > 0}<Chip tone="good">{t('entry.chips.inDecks', { count: inDecks })}</Chip>{/if}
					{#if entry.language !== $workspaces.current?.language}
						<Chip>{languageLabel(entry.language)}</Chip>
					{/if}
				</div>
			</div>
			<div class="actions">
				<AddToStudy
					entryId={entry.id}
					written={entry.written}
					sentenceId={entry.sentences?.[0]?.id}
					kind={entry.kind}
				/>
				{#if !editing}
					<a class="edit" href={`/entry/${entry.id}?edit=1`}>{t('entry.page.edit')}</a>
				{/if}
			</div>
		</header>

		{#if editing}
		{#key entry.id}
			<EntryEditor entry={entry} onSaved={handleSaved} onCancel={closeEditor} />
		{/key}
	{:else}
		<div class="columns">
			<div class="main">
				<Readings
					readings={entry.readings}
					audioFor={audioFor ?? undefined}
					word={entry.written}
					lang={entry.language}
					language={entry.language}
					deviceVoice={audioSettings.deviceVoice}
				/>
				{#if credit}<p class="credit">{credit}</p>{/if}
				<Badges badges={entry.badges} />
				{#key entry.id}<Senses senses={entry.senses} />{/key}
				{#if related.length > 0}
					<section class="section related" aria-labelledby="related-heading">
						<h2 id="related-heading">{t('entry.page.related')}</h2>
						<p class="related-row">
							{#each related as word, i (word)}
								{#if i > 0}<span class="sep" aria-hidden="true">·</span>{/if}
								<a href={`/search?q=${encodeURIComponent(word)}`} lang={studyLang(entry.language)}>{word}</a>
							{/each}
						</p>
					</section>
				{/if}
				<Sentences sentences={entry.sentences} language={entry.language} />
			</div>
			<aside class="side">
				{#if !editing && $workspaces.current}
					{#key `${$workspaces.current.id}:${entry.id}`}
						<EntryNote workspaceId={$workspaces.current.id} entryId={entry.id} />
					{/key}
				{/if}
				{#if entry.characters && entry.characters.length > 0}
					<section class="section chars-of-word" aria-labelledby="chars-of-word-heading">
						<h2 id="chars-of-word-heading">{t('entry.page.characters')}</h2>
						<ul class="char-list">
							{#each entry.characters as c (c.id)}
								<li>
									<a class="char" href={`/entry/${c.id}`}>
										<span class="glyph" lang={studyLang(entry.language)}>{c.written}</span>
										<span class="char-meta">
											{#if c.reading}<span class="reading" lang={studyLang(entry.language)}>{c.reading.value}</span>{/if}
											{#if c.gloss}<span class="gloss">{c.gloss}</span>{/if}
											<small>
												{#if c.radical}{t('entry.char.meta', { radical: c.radical.written })} · {/if}{t('entry.char.strokes', { strokes: c.strokes })}
											</small>
										</span>
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				{#if entry.language === 'zh' && strokeChar !== null}
					<section class="section" aria-labelledby="stroke-heading">
						<h2 id="stroke-heading">{t('entry.page.strokeOrder')}</h2>
						{#if entry.kind === 'word' && entry.characters && entry.characters.length > 1}
							<p class="pick">
								{#each entry.characters as c (c.id)}
									<button type="button" class="pick-char" aria-pressed={strokeChar === c.written} onclick={() => (chosenChar = c.written)} lang={studyLang(entry.language)}>{c.written}</button>
								{/each}
							</p>
						{/if}
						<StrokePlayer char={strokeChar} />
					</section>
				{/if}
				{#if entry.variants.length > 0}
					<section class="section" aria-labelledby="variants-heading">
						<h2 id="variants-heading">{t('entry.page.variants')}</h2>
						<ul class="plain-list">
							{#each entry.variants as variant (variant.id)}
								<li>
									<a href={`/entry/${variant.id}`} lang={studyLang(entry.language)}>{variant.written}</a>
									{#if variant.readings.length > 0}<span class="reading"><ReadingText type={variant.readings[0].type} value={variant.readings[0].value} language={entry.language} /></span>{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				{#if entry.radicalId !== null}
					<section class="section" aria-labelledby="radical-heading">
						<h2 id="radical-heading">{t('entry.page.radical')}</h2>
						<p>
							<a href={`/entry/${entry.radicalId}`}>{radicalWritten || t('entry.page.radicalFallback', { number: `#${entry.radicalId}` })}</a>
							{#if lookupLinks.withRadical}· <a href={lookupLinks.withRadical}>{t('entry.page.withRadical')}</a>{/if}
						</p>
					</section>
				{/if}
				{#if chars.length > 0}
					<section class="section" aria-labelledby="chars-heading">
						<h2 id="chars-heading">{t('entry.page.underRadical')}</h2>
						{#if lookupLinks.browse}<p class="browse"><a href={lookupLinks.browse}>{t('entry.page.browseStrokes')}</a></p>{/if}
						<ul class="plain-list">
							{#each chars as char (char.id)}
								<li><a href={`/entry/${char.id}`} lang={studyLang(entry.language)}>{char.written}</a>
									{#if char.readings.length > 0}<span class="reading"><ReadingText type={char.readings[0].type} value={char.readings[0].value} language={entry.language} /></span>{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</aside>
		</div>
	{/if}
	{/if}
</div>

<style>
	.hint {
		margin-top: 1.5rem;
		color: var(--readable-muted);
	}

	.error {
		margin-top: 1.5rem;
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
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

	.also-written {
		margin: 0.25rem 0 0;
		color: var(--readable-muted);
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
		color: var(--readable-muted);
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
		gap: var(--space-1);
		margin-top: var(--space-2);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.edit {
		font-size: var(--font-size-label);
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		text-decoration: none;
		color: var(--text);
	}

	.edit:hover,
	.edit:focus-visible {
		border-color: var(--line);
	}

	.entry-view {
		container-type: inline-size;
	}

	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
		align-items: start;
	}

	.main,
	.side {
		min-width: 0;
		display: grid;
		gap: var(--space-4);
		align-content: start;
	}

	@container (min-width: 48rem) {
		.columns {
			grid-template-columns: minmax(0, 1fr) 17rem;
		}
		.side {
			box-shadow: inset 1px 0 0 var(--hair);
			padding-inline-start: var(--space-4);
		}
	}

	.section h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-label);
		font-weight: var(--weight-medium);
		color: var(--readable-muted);
	}

	.plain-list,
	.char-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--space-1);
	}

	.plain-list li {
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
	}

	.plain-list a,
	.char-list a,
	.related-row a,
	.section > p a {
		color: var(--text);
		text-decoration: none;
		box-shadow: inset 0 -1px 0 var(--line);
	}

	.char-list a.char {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		box-shadow: none;
	}

	.char-list .glyph {
		font-size: 2rem;
		line-height: 1;
	}

	.char-meta {
		display: grid;
		gap: 2px;
		font-size: var(--font-size-label);
	}

	.char-meta .reading {
		color: var(--reading-accent);
		font-weight: var(--weight-medium);
	}

	.char-meta small {
		color: var(--readable-muted);
	}

	.related-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		font-size: 1.0625rem;
	}

	.sep {
		color: var(--readable-muted);
	}

	.pick {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0 0 var(--space-2);
	}

	.pick-char {
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font-size: 1.125rem;
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
	}

	.pick-char[aria-pressed='true'] {
		background: var(--selected-wash);
		border-color: var(--accent);
	}
</style>
