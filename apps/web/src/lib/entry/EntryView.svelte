<script lang="ts">
	import { tick } from 'svelte';
	import { profileOf } from '$lib/languageProfiles';
	import { errorText } from '$lib/api/apiErrors';
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
	import { creditLine, headwordClips, readingClips } from '$lib/audio/button';
	import { readAudioSettings } from '$lib/audio/settings';
	import PlayButton from '$lib/components/PlayButton.svelte';
	import { viewPayload } from '$lib/eventPayloads';
	import { loadEntryExtras } from '$lib/entry/extras';
	import ReadingText from '$lib/components/ReadingText.svelte';
	import { glossLang, readingLang, studyLang } from '$lib/i18n/lang';
	import { languageLabel } from '$lib/languages';
	import { entryRadicalLinks } from '$lib/radicals/selection';
	import EntryNote from '$lib/notes/EntryNote.svelte';
	import { joinForms, otherForms } from '$lib/features/reader/entryDisplay';
	import Chip from '$lib/ui/Chip.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { relatedWords } from './related';
	import { decksContaining } from './decks';
	import { variantLabel } from './variant';
	import { characterMeta } from './characterMeta';
	import { getEntryRanks } from '$lib/api/frequency';
	import { getStudyData } from '$lib/study/data';
	import { setPageActions } from '$lib/frame/pageFrame.svelte';
	import { useApp } from '$lib/context/context';
	import { useSession } from '$lib/context/context';
	import AiExamples from './examples/AiExamples.svelte';
	import ExampleActions from './examples/ExampleActions.svelte';
	import { aiLabel, generateErrorText } from './examples/examples';
	import { aiMark, deleteAiSentence, type ReportReason } from '$lib/api/examples';
	import type { Sentence } from '$lib/api/types';
	import { loadProviderNames } from '$lib/features/journal/providerNames';

	const session = useSession();
	const app = useApp();

	let {
		entryId: requestedId,
		headingLevel = 1,
		recordView = true,
		focusOnLoad = false,
		backHref = '/search',
		ontitle,
		onstate
	}: {
		entryId: number | null;
		headingLevel?: 1 | 2;
		recordView?: boolean;
		/** Where the not-found state links back (the search detail keeps its query). */
		backHref?: string;
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

	// The study action's state, mirrored for the phone bar's Add to deck.
	let study = $state<AddToStudy | null>(null);
	let studyInDeck = $state<boolean | null>(null);

	// The entry's recordings (signed-in users only; the device voice needs none).
	let audio = $state<AudioResolution | null>(null);

	// AI examples (#186): provider names for the "AI-written" label, and the
	// last delete or report failure of a kept one.
	let providerNames = $state<ReadonlyMap<string, string>>(new Map());
	let exampleError = $state('');
	$effect(() => {
		if (entry?.sentences.some((s) => aiMark(s.ai) !== null)) {
			void loadProviderNames(session.caches.providerNames).then((m) => (providerNames = m));
		}
	});

	// After a kept or deleted AI example the entry is fetched again in the
	// background: the service worker's offline copy of the answer follows.
	function refreshOfflineCopy(id: number): void {
		void getEntry(id).catch(() => {});
	}

	function addSentence(sentence: Sentence): void {
		if (entry && sentence.entryId === entry.id) {
			entry = { ...entry, sentences: [...entry.sentences, sentence] };
			refreshOfflineCopy(entry.id);
		}
	}

	async function removeAiSentence(sentence: Sentence, reason?: ReportReason): Promise<void> {
		if (!entry) return;
		exampleError = '';
		try {
			await deleteAiSentence(entry.id, sentence.id, reason);
			const aiIds = entry.sentences.filter((s) => aiMark(s.ai) !== null).map((s) => s.id);
			const index = aiIds.indexOf(sentence.id);
			entry = { ...entry, sentences: entry.sentences.filter((s) => s.id !== sentence.id) };
			refreshOfflineCopy(entry.id);
			// The focus stays in the examples: the next AI example's first button,
			// else the AI examples heading, the examples heading or the word.
			await tick();
			const left = aiIds.filter((id) => id !== sentence.id);
			const next = left[Math.min(Math.max(index, 0), left.length - 1)];
			const button = next === undefined ? null : document.querySelector<HTMLElement>(`[aria-describedby="sentence-${next}"]`);
			(button ?? document.getElementById('ai-examples-heading') ?? document.getElementById('sentences-heading') ?? headingEl)?.focus();
		} catch (err) {
			exampleError = generateErrorText(err);
		}
	}

	// Guards against a slow earlier request overwriting a newer entry.
	let requestSeq = 0;

	// The word heading, so a phone navigation can move focus into the entry.
	let headingEl = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!focusOnLoad || entry === null || headingEl === null) return;
		headingEl.focus();
	});

	// The phone bar's Add to deck is the first action the entry offers there.
	setPageActions(phoneActions);

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
				error = errorText(err, t('entry.page.loadFailed'));
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
	const audioSettings = $derived(readAudioSettings(session.workspaces.current?.settings));
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
		if (id === null || !app.auth.token) return;
		void getEntryAudio(session.caches.audio, id).then(
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
		if (!current || !app.auth.token) return;
		void getEntryRanks(current.language, [current.id]).then(
			(r) => {
				if (entry?.id === current.id) rank = r.ranks.find((x) => x.id === current.id)?.rank ?? null;
			},
			() => {}
		);
	});

	function refreshDecks(): void {
		const current = entry;
		const workspace = session.workspaces.current?.id;
		if (!current || workspace === undefined) return;
		void getStudyData(session.study, workspace, { force: true }).then(
			(data) => {
				if (entry?.id === current.id) inDecks = decksContaining(data, current.id);
			},
			() => {}
		);
	}

	$effect(() => {
		const current = entry;
		const workspace = session.workspaces.current?.id;
		inDecks = 0;
		if (!current || workspace === undefined) return;
		void getStudyData(session.study, workspace).then(
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
		const workspace = session.workspaces.current?.id ?? null;
		if (viewed === null || workspace === null || viewedEntry === viewed) return;
		viewedEntry = viewed;
		void session.events.record('view', workspace, viewPayload(viewed));
	});

	function variantText(variant: EntryBase): string {
		if (!entry) return '';
		const label = variantLabel(entry, variant);
		return label === 'traditional'
			? t('entry.page.traditional')
			: label === 'simplified'
				? t('entry.page.simplified')
				: t('entry.page.variant');
	}
</script>

{#snippet phoneActions()}
	{#if entry !== null && studyInDeck === false}
		<IconButton label={t('entry.study.add')} icon="add" onclick={() => study?.addToGeneral()} />
	{/if}
{/snippet}

<div class="entry-view">
	{#if loading}
		<p class="hint" aria-live="polite">{t('entry.page.loading')}</p>
	{:else if notFound}
		<section class="not-found">
			<svelte:element this={headingLevel === 1 ? 'h1' : 'h2'}>{t('entry.page.notFound')}</svelte:element>
			<p>{t('entry.page.notFoundText')}</p>
			<p><a href={backHref}>{t('entry.page.backToSearch')}</a></p>
		</section>
	{:else if error}
		<p class="error" role="alert">{error}</p>
		<button type="button" class="retry" onclick={retry}>{t('common.action.retry')}</button>
	{:else if entry}
		<header class="head">
			<div class="word-line">
				<svelte:element this={headingLevel === 1 ? 'h1' : 'h2'} class="written" bind:this={headingEl} tabindex="-1" lang={studyLang(entry.language)}>{entry.written}</svelte:element>
				{#each entry.variants as variant (variant.id)}
					<a class="variant" href={`/entry/${variant.id}`} lang={studyLang(entry.language)}
						>{variant.written} <small>{variantText(variant)}</small></a
					>
				{/each}
			</div>
			{#if alsoWritten.length > 0}
				<p class="also-written">
					<Msg key="entry.page.alsoWritten" args={{ forms: joinForms(alsoWritten, entry.language) }}
						>{#snippet forms(text: string)}<span lang={studyLang(entry?.language)}>{text}</span>{/snippet}</Msg
					>
				</p>
			{/if}
			<div class="reads">
				<Readings
					readings={entry.readings}
					audioFor={audioFor ?? undefined}
					word={entry.written}
					lang={entry.language}
					language={entry.language}
					deviceVoice={audioSettings.deviceVoice}
				/>
				<PlayButton
					clips={headClips}
					speakText={entry.written}
					lang={entry.language}
					deviceVoice={audioSettings.deviceVoice}
					label={entry.written}
				/>
			</div>
			{#if credit}<p class="credit">{credit}</p>{/if}
			<div class="chips">
				<Badges badges={entry.badges} />
				{#if rank !== null}<Chip>#{t('entry.chips.frequency', { rank: formatNumber(rank) })}</Chip>{/if}
				<Chip>{t(entry.kind === 'character' ? 'entry.chips.character' : 'entry.chips.word')}</Chip>
				{#if inDecks > 0}<Chip tone="good">{t('entry.chips.inDecks', { count: inDecks })}</Chip>{/if}
				{#if entry.language !== session.workspaces.current?.language}
					<Chip>{languageLabel(entry.language)}</Chip>
				{/if}
			</div>
			<div class="actions">
				<AddToStudy
					bind:this={study}
					onchange={(v) => (studyInDeck = v)}
					onadded={refreshDecks}
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
				{#key entry.id}<Senses senses={entry.senses} senseGroups={entry.senseGroups} />{/key}
				<Sentences sentences={entry.sentences} language={entry.language} term={entry.written} aiLabelOf={(mark) => aiLabel(mark, providerNames)}>
					{#snippet actions(sentence: Sentence, id: string)}
						<ExampleActions describedBy={id} onremove={(reason) => removeAiSentence(sentence, reason)} />
					{/snippet}
				</Sentences>
				{#if exampleError}<p class="example-error" role="alert">{exampleError}</p>{/if}
				{#key entry.id}<AiExamples entry={entry} onkept={addSentence} />{/key}
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
			</div>
			<aside class="side">
				{#if entry.characters && entry.characters.length > 0}
					<section class="section chars-of-word" aria-labelledby="chars-of-word-heading">
						<h2 id="chars-of-word-heading">{t('entry.page.characters')}</h2>
						<ul class="char-list">
							{#each entry.characters as c (c.id)}
								<li>
									<a class="char" href={`/entry/${c.id}`}>
										<span class="glyph" lang={studyLang(entry.language)}>{c.written}</span>
										<span class="char-meta">
											{#if c.reading}<span class="reading" lang={readingLang(c.reading.type, entry.language)}>{c.reading.value}</span>{/if}
											{#if c.gloss}<span class="gloss" lang={glossLang(undefined)}>{c.gloss}</span>{/if}
											{#if characterMeta(c)}<small>{characterMeta(c)}</small>{/if}
										</span>
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				{#if profileOf(entry.language).strokes && strokeChar !== null}
					<section class="section" aria-labelledby="stroke-heading">
						<h2 id="stroke-heading">{t('entry.page.strokeOrder')}</h2>
						{#if entry.kind === 'word' && entry.characters && entry.characters.length > 1}
							<p class="pick">
								{#each entry.characters as c (c.id)}
									<button
									type="button"
									class="pick-char"
									aria-pressed={strokeChar === c.written}
									aria-label={t('entry.strokes.pick', { char: c.written })}
									onclick={() => (chosenChar = c.written)}
									lang={studyLang(entry.language)}>{c.written}</button>
								{/each}
							</p>
						{/if}
						<StrokePlayer char={strokeChar} />
					</section>
				{/if}
				{#if !editing && session.workspaces.current}
					{#key `${session.workspaces.current.id}:${entry.id}`}
						<EntryNote workspaceId={session.workspaces.current.id} entryId={entry.id} />
					{/key}
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
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.not-found h1,
	.not-found h2 {
		margin-bottom: 0.5rem;
	}

	.head {
		display: grid;
		gap: var(--space-2);
		padding-bottom: var(--space-4);
		box-shadow: inset 0 -1px 0 var(--hair);
	}

	.word-line {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
	}

	.written {
		margin: 0;
		font-size: 3.5rem;
		font-weight: var(--weight-regular);
		line-height: 1.05;
		/* Give the written form room without letting a long word overflow. */
		overflow-wrap: anywhere;
	}

	.variant {
		color: var(--readable-muted);
		font-size: 1.25rem;
		text-decoration: none;
		box-shadow: inset 0 -1px 0 var(--line);
	}

	.variant small {
		font-size: var(--font-size-label);
	}

	.also-written {
		margin: 0;
		color: var(--readable-muted);
	}

	.reads {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.credit {
		margin: 0;
		font-size: 0.8rem;
		color: var(--readable-muted);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.edit {
		font-size: var(--font-size-label);
		padding: var(--space-1) 0;
		text-decoration: none;
		color: var(--text);
		box-shadow: inset 0 -1px 0 var(--line);
	}

	.entry-view {
		container-type: inline-size;
	}

	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
		align-items: start;
		margin-top: var(--space-4);
	}

	.example-error {
		margin: 0;
		color: var(--readable-bad);
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
