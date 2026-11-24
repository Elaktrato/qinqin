<script lang="ts">
	import { pageTitle } from '$lib/routing/pageTitle';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import Msg from '$lib/ui/Msg.svelte';
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import { Button } from '$lib/ui';
	import type { ComponentPack, Dictionary, FrequencyPack, LemmaPack, Scheme, StrokePack } from '$lib/api/types';
	import { getComponentPacks, getLemmaPacks } from '$lib/api/components';
	import { getStrokePacks } from '$lib/api/packages';
	import { getFonts, type FontList } from '$lib/api/fonts';
	import { audioSection, type AudioPackInfo } from '$lib/sources/audioSection';
	import { languageLabel } from '$lib/languages';
	import { coreFeatures } from '$lib/features';
	import { listGrammar } from '$lib/features/grammar/api';
	import type { PackInfo } from '$lib/features/grammar/types';
	import { coreCredits } from '$lib/sources/coreCredits';
	import { cjkLang, scriptRuns, type NoticeParagraph } from '$lib/sources/notice';
	import { listSentencePacks, type SentencePack } from '$lib/api/packs';
	import { getThemes, type ThemesAnswer } from '$lib/api/themes';
	import {
		componentsSection,
		lemmaSection,
		creditView,
		fontsSection,
		packTable,
		featureCredits,
		sentencePackSources,
		strokesSection,
		themesSection,
		type CreditView,
		type PackTable
	} from '$lib/sources/sections';

	// Credits declared in code: the app's own, and each core feature's.
	const coreViews = coreCredits.map(creditView);
	const features = featureCredits(coreFeatures, coreCredits);

	let dictionaries = $state<Dictionary[]>([]);
	let loading = $state(true);
	let error = $state('');
	const dictionaryTable = $derived(packTable('dictionaries', dictionaries));

	let sentencePacks = $state<SentencePack[]>([]);
	let sentencesError = $state('');
	const sentencesTable = $derived(packTable('sentences', sentencePackSources(sentencePacks)));

	async function loadSentences(): Promise<void> {
		sentencesError = '';
		try {
			sentencePacks = await listSentencePacks();
		} catch (err) {
			sentencePacks = [];
			sentencesError = message(err, t('sources.error.sentences'));
		}
	}

	let frequencyPacks = $state<FrequencyPack[]>([]);
	let frequencyLoading = $state(true);
	let frequencyError = $state('');
	const frequencyTable = $derived(packTable('frequency', frequencyPacks));

	// The Audio section exists only while an audio pack is installed.
	let audioPacks = $state<AudioPackInfo[]>([]);
	let audioError = $state('');
	const audio = $derived(audioSection(audioPacks));

	async function loadAudio(): Promise<void> {
		audioError = '';
		try {
			audioPacks = await api<AudioPackInfo[]>('/api/audio-packs', { auth: false });
		} catch (err) {
			audioPacks = [];
			audioError = message(err, t('sources.error.audio'));
		}
	}

	const message = errorText;

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			// The list endpoint is public; a stale token must not turn a
			// credits page into a login redirect.
			dictionaries = await api<Dictionary[]>('/api/dictionaries', { auth: false });
		} catch (err) {
			dictionaries = [];
			error = message(err, t('sources.error.dictionaries'));
		} finally {
			loading = false;
		}
	}

	async function loadFrequency(): Promise<void> {
		frequencyLoading = true;
		frequencyError = '';
		try {
			frequencyPacks = await api<FrequencyPack[]>('/api/frequency-packs', { auth: false });
		} catch (err) {
			frequencyPacks = [];
			frequencyError = message(err, t('sources.error.frequency'));
		} finally {
			frequencyLoading = false;
		}
	}

	// The Character components section exists only while a pack is installed.
	let componentPacks = $state<ComponentPack[]>([]);
	let componentsError = $state('');
	const components = $derived(componentsSection(componentPacks, componentsError));

	// The Lemmatizer rules section exists only while a rule-table pack is installed.
	let lemmaPacks = $state<LemmaPack[]>([]);
	let lemmaError = $state('');
	const lemmaRules = $derived(lemmaSection(lemmaPacks, lemmaError));

	async function loadLemma(): Promise<void> {
		lemmaError = '';
		try {
			lemmaPacks = await getLemmaPacks();
		} catch (err) {
			lemmaPacks = [];
			lemmaError = message(err, t('sources.error.lemma'));
		}
	}

	async function loadComponents(): Promise<void> {
		componentsError = '';
		try {
			componentPacks = await getComponentPacks();
		} catch (err) {
			componentPacks = [];
			componentsError = message(err, t('sources.error.components'));
		}
	}

	// The Stroke data section exists only while a stroke pack is installed.
	let strokePacks = $state<StrokePack[]>([]);
	let strokesError = $state('');
	const strokes = $derived(strokesSection(strokePacks, strokesError));

	async function loadStrokes(): Promise<void> {
		strokesError = '';
		try {
			strokePacks = await getStrokePacks();
		} catch (err) {
			strokePacks = [];
			strokesError = message(err, t('sources.error.strokes'));
		}
	}

	// Theme packs (#96): the built-in ones are always listed.
	let themesAnswer = $state<ThemesAnswer>({ themes: [], packs: [] });
	let themesError = $state('');
	const themes = $derived(themesSection(themesAnswer, themesError));

	async function loadThemes(): Promise<void> {
		themesError = '';
		try {
			themesAnswer = await getThemes();
		} catch (err) {
			themesAnswer = { themes: [], packs: [] };
			themesError = message(err, t('sources.error.themes'));
		}
	}

	// The Fonts section exists only while a font pack is installed; the list
	// needs a session, so a signed-out visitor sees none.
	let fontList = $state<FontList>({ faces: [], packs: [] });
	let fontsError = $state('');
	const fonts = $derived(fontsSection(fontList, fontsError));

	async function loadFonts(): Promise<void> {
		fontsError = '';
		try {
			fontList = await getFonts();
		} catch (err) {
			fontList = { faces: [], packs: [] };
			fontsError = message(err, t('sources.error.fonts'));
		}
	}

	let schemes = $state<Scheme[]>([]);
	let schemesLoading = $state(true);
	let schemesError = $state('');
	const levelTable = $derived(packTable('levels', schemes));

	async function loadSchemes(): Promise<void> {
		schemesLoading = true;
		schemesError = '';
		try {
			schemes = await api<Scheme[]>('/api/schemes', { auth: false });
		} catch (err) {
			schemes = [];
			schemesError = message(err, t('sources.error.levels'));
		} finally {
			schemesLoading = false;
		}
	}

	let grammarPacks = $state<PackInfo[]>([]);
	let grammarLoading = $state(true);
	let grammarError = $state('');
	const grammarTable = $derived(
		packTable(
			'grammar',
			grammarPacks.map((pack, id) => ({ ...pack, id, name: pack.name }))
		)
	);

	async function loadGrammar(): Promise<void> {
		grammarLoading = true;
		grammarError = '';
		try {
			grammarPacks = await listGrammar();
		} catch (err) {
			grammarPacks = [];
			grammarError = message(err, t('sources.error.grammar'));
		} finally {
			grammarLoading = false;
		}
	}

	onMount(() => {
		loadGrammar();
		load();
		loadFrequency();
		loadSentences();
		loadAudio();
		loadSchemes();
		loadComponents();
		loadLemma();
		loadStrokes();
		loadThemes();
		loadFonts();
	});
</script>

<svelte:head>
	<title>{pageTitle(t('sources.title'))}</title>
</svelte:head>

{#snippet text(value: string, lang: string)}{#each scriptRuns(value, lang) as run, i (i)}{#if run.lang}<span
				lang={run.lang}>{run.text}</span
			>{:else}{run.text}{/if}{/each}{/snippet}

{#snippet cell(value: string, language: string)}{@render text(value, cjkLang(value, language))}{/snippet}

{#snippet paragraphs(list: NoticeParagraph[], lang: string)}
	{#each list as paragraph, i (i)}
		<p>
			{#each paragraph.parts as part, j (j)}{#if part.type === 'link'}<a
						href={part.href}
						rel="noreferrer">{@render text(part.text, lang)}</a
					>{:else}{@render text(part.text, lang)}{/if}{/each}
		</p>
	{/each}
{/snippet}

<!-- The note link sits in a cell of its own, so the row header (announced
     with every cell) holds only the pack name. -->
{#snippet noteHeader(table: PackTable)}
	{#if table.notes.length > 0}<th scope="col"><span class="visually-hidden">{t('sources.note')}</span></th>{/if}
{/snippet}

{#snippet noteCell(table: PackTable, noteId: string | undefined, name: string)}
	{#if table.notes.length > 0}
		<td class="note-cell">
			{#if noteId}<a href={`#${noteId}`}
					>{t('sources.note')}<span class="visually-hidden">{` ${t('sources.noteOn', { name })}`}</span></a
				>{/if}
		</td>
	{/if}
{/snippet}

<!-- The visible "Notes" heading names the list: a dl has no role that
     aria-labelledby could reliably name. -->
{#snippet notes(table: PackTable)}
	{#if table.notes.length > 0}
		<h3 class="notes-heading">{t('sources.notes')}</h3>
		<dl class="notes">
			{#each table.notes as note (note.id)}
				<dt id={note.id} tabindex="-1">{note.name}</dt>
				<dd>
					{@render paragraphs(note.paragraphs, note.lang)}
					{#each note.sharedWith as shared (shared.id)}
						<p class="shared">
							<Msg key="sources.shared" args={{ name: shared.name }}
								>{#snippet link(text: string)}<a href={`#${shared.id}`}>{text}</a>{/snippet}</Msg
							>
						</p>
					{/each}
				</dd>
			{/each}
		</dl>
	{/if}
{/snippet}

{#snippet credit(view: CreditView, level: 'h3' | 'h4')}
	<li class="credit">
		<svelte:element this={level} class="credit-name">
			{#if view.href}<a href={view.href} rel="noreferrer">{view.name}</a>{:else}{view.name}{/if}
		</svelte:element>
		{#if view.license || view.attribution}
			<dl class="facts">
				{#if view.license}
					<dt>{t('sources.license')}</dt>
					<dd>{@render text(view.license, view.lang)}</dd>
				{/if}
				{#if view.attribution}
					<dt>{t('sources.attribution')}</dt>
					<dd>{@render text(view.attribution, view.lang)}</dd>
				{/if}
			</dl>
		{/if}
		<div class="credit-notice">{@render paragraphs(view.paragraphs, view.lang)}</div>
		{#if view.licenseTexts.length > 0}
			<p class="license-texts">
				{#each view.licenseTexts as licence, i (licence.path)}{#if i > 0}{', '}{/if}<a
						href={licence.path}
						data-sveltekit-reload>{licence.label}</a
					>{/each}
			</p>
		{/if}
	</li>
{/snippet}

<div class="page-body sources">
	<h1>{t('sources.title')}</h1>
	<p class="lede">
		{t('sources.lede')}
	</p>

	<section>
		<h2 id="sources-dictionaries">{t('sources.dictionaries.title')}</h2>

		{#if loading}
			<p>{t('sources.dictionaries.loading')}</p>
		{:else if error}
			<p class="error" role="alert">{error}</p>
			<Button onclick={load}>{t('sources.retry')}</Button>
		{:else if dictionaries.length === 0}
			<p>{t('sources.dictionaries.none')}</p>
			<p class="hint">
				<Msg key="sources.dictionaries.hint">{#snippet code(text: string)}<code>{text}</code>{/snippet}</Msg>
			</p>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region is keyboard reachable, WCAG 2.1.1) -->
			<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sources-dictionaries">
				<table class="ui-table" aria-labelledby="sources-dictionaries">
					<thead>
						<tr>
							<th scope="col">{t('sources.col.name')}</th>
							{@render noteHeader(dictionaryTable)}
							<th scope="col">{t('sources.col.version')}</th>
							<th scope="col">{t('sources.license')}</th>
							<th scope="col">{t('sources.attribution')}</th>
						</tr>
					</thead>
					<tbody>
						{#each dictionaryTable.rows as row (row.key)}
							<tr>
								<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
								{@render noteCell(dictionaryTable, row.noteId, row.name)}
								<td>{row.version}</td>
								<td>{@render cell(row.license, row.language)}</td>
								<td>{@render cell(row.attribution, row.language)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{@render notes(dictionaryTable)}
		{/if}

		<p class="notice">
			<Msg key="sources.dictionaries.notice">{#snippet code(text: string)}<code>{text}</code>{/snippet}</Msg>
		</p>
	</section>

	<section>
		<h2 id="sources-frequency">{t('sources.frequency.title')}</h2>

		{#if frequencyLoading}
			<p>{t('sources.frequency.loading')}</p>
		{:else if frequencyError}
			<p class="error" role="alert">{frequencyError}</p>
			<Button onclick={loadFrequency}>{t('sources.retry')}</Button>
		{:else if frequencyPacks.length === 0}
			<p>{t('sources.frequency.none')}</p>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region is keyboard reachable, WCAG 2.1.1) -->
			<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sources-frequency">
				<table class="ui-table" aria-labelledby="sources-frequency">
					<thead>
						<tr>
							<th scope="col">{t('sources.col.name')}</th>
							{@render noteHeader(frequencyTable)}
							<th scope="col">{t('sources.col.language')}</th>
							<th scope="col">{t('sources.col.version')}</th>
							<th scope="col">{t('sources.license')}</th>
							<th scope="col">{t('sources.attribution')}</th>
						</tr>
					</thead>
					<tbody>
						{#each frequencyTable.rows as row (row.key)}
							<tr>
								<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
								{@render noteCell(frequencyTable, row.noteId, row.name)}
								<td title={row.language}>{languageLabel(row.language)}</td>
								<td>{row.version}</td>
								<td>{@render cell(row.license, row.language)}</td>
								<td>{@render cell(row.attribution, row.language)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{@render notes(frequencyTable)}
		{/if}

		<p class="notice">
			{t('sources.frequency.notice')}
		</p>
	</section>

	{#if sentencesError}
		<section>
			<h2 id="sources-sentences">{t('sources.sentences.title')}</h2>
			<p class="error" role="alert">{sentencesError}</p>
			<Button onclick={loadSentences}>{t('sources.retry')}</Button>
		</section>
	{:else if sentencePacks.length > 0}
		<section>
			<h2 id="sources-sentences">{t('sources.sentences.title')}</h2>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region is keyboard reachable, WCAG 2.1.1) -->
			<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sources-sentences">
				<table class="ui-table" aria-labelledby="sources-sentences">
					<thead>
						<tr>
							<th scope="col">{t('sources.col.name')}</th>
							{@render noteHeader(sentencesTable)}
							<th scope="col">{t('sources.col.language')}</th>
							<th scope="col">{t('sources.col.version')}</th>
							<th scope="col">{t('sources.license')}</th>
							<th scope="col">{t('sources.attribution')}</th>
						</tr>
					</thead>
					<tbody>
						{#each sentencesTable.rows as row (row.key)}
							<tr>
								<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
								{@render noteCell(sentencesTable, row.noteId, row.name)}
								<td title={row.language}>{languageLabel(row.language)}</td>
								<td>{row.version}</td>
								<td>{@render cell(row.license, row.language)}</td>
								<td>{@render cell(row.attribution, row.language)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{@render notes(sentencesTable)}
		</section>
	{/if}

	{#if components.show}
		<section>
			<h2 id="sources-components">{t('sources.components.title')}</h2>
			{#if componentsError}
				<p class="error" role="alert">{componentsError}</p>
				<Button onclick={loadComponents}>{t('sources.retry')}</Button>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region is keyboard reachable, WCAG 2.1.1) -->
				<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sources-components">
					<table class="ui-table" aria-labelledby="sources-components">
						<thead>
							<tr>
								<th scope="col">{t('sources.col.name')}</th>
								{@render noteHeader(components.table)}
								<th scope="col">{t('sources.col.language')}</th>
								<th scope="col">{t('sources.col.version')}</th>
								<th scope="col">{t('sources.license')}</th>
								<th scope="col">{t('sources.attribution')}</th>
							</tr>
						</thead>
						<tbody>
							{#each components.table.rows as row (row.key)}
								<tr>
									<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
									{@render noteCell(components.table, row.noteId, row.name)}
									<td title={row.language}>{languageLabel(row.language)}</td>
									<td>{row.version}</td>
									<td>{@render cell(row.license, row.language)}</td>
									<td>{@render cell(row.attribution, row.language)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{@render notes(components.table)}
			{/if}
			<p class="notice">
				{t('sources.components.notice')}
			</p>
		</section>
	{/if}

	{#if lemmaRules.show}
		<section>
			<h2 id="sources-lemma">{t('sources.lemma.title')}</h2>
			{#if lemmaError}
				<p class="error" role="alert">{lemmaError}</p>
				<Button onclick={loadLemma}>{t('sources.retry')}</Button>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region is keyboard reachable, WCAG 2.1.1) -->
				<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sources-lemma">
					<table class="ui-table" aria-labelledby="sources-lemma">
						<thead>
							<tr>
								<th scope="col">{t('sources.col.name')}</th>
								{@render noteHeader(lemmaRules.table)}
								<th scope="col">{t('sources.col.language')}</th>
								<th scope="col">{t('sources.col.version')}</th>
								<th scope="col">{t('sources.license')}</th>
								<th scope="col">{t('sources.attribution')}</th>
							</tr>
						</thead>
						<tbody>
							{#each lemmaRules.table.rows as row (row.key)}
								<tr>
									<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
									{@render noteCell(lemmaRules.table, row.noteId, row.name)}
									<td title={row.language}>{languageLabel(row.language)}</td>
									<td>{row.version}</td>
									<td>{@render cell(row.license, row.language)}</td>
									<td>{@render cell(row.attribution, row.language)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{@render notes(lemmaRules.table)}
			{/if}
			<p class="notice">
				{t('sources.lemma.notice')}
			</p>
		</section>
	{/if}

	{#if themes.show}
		<section>
			<h2 id="sources-themes">{t('sources.themes.title')}</h2>
			{#if themesError}
				<p class="error" role="alert">{themesError}</p>
				<Button onclick={loadThemes}>{t('sources.retry')}</Button>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region is keyboard reachable, WCAG 2.1.1) -->
				<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sources-themes">
					<table class="ui-table" aria-labelledby="sources-themes">
						<thead>
							<tr>
								<th scope="col">{t('sources.col.name')}</th>
								{@render noteHeader(themes.table)}
								<th scope="col">{t('sources.themes.colThemes')}</th>
								<th scope="col">{t('sources.themes.colOrigin')}</th>
								<th scope="col">{t('sources.col.version')}</th>
								<th scope="col">{t('sources.license')}</th>
								<th scope="col">{t('sources.attribution')}</th>
							</tr>
						</thead>
						<tbody>
							{#each themes.table.rows as row (row.key)}
								<tr>
									<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
									{@render noteCell(themes.table, row.noteId, row.name)}
									<td>{themes.themeNames[row.key]}</td>
									<td>{themes.builtin[row.key] ? t('sources.themes.builtin') : t('sources.themes.installed')}</td>
									<td>{row.version}</td>
									<td>{@render cell(row.license, row.language)}</td>
									<td>{@render cell(row.attribution, row.language)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{@render notes(themes.table)}
				{#each themes.licenseTexts as licence (licence.key)}
					<details class="licence-text">
						<summary>{licence.label}</summary>
						<pre>{licence.text}</pre>
					</details>
				{/each}
			{/if}
			<p class="notice">
				{t('sources.themes.notice')}
			</p>
		</section>
	{/if}

	{#if strokes.show}
		<section>
			<h2 id="sources-strokes">{t('sources.strokes.title')}</h2>
			{#if strokesError}
				<p class="error" role="alert">{strokesError}</p>
				<Button onclick={loadStrokes}>{t('sources.retry')}</Button>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region is keyboard reachable, WCAG 2.1.1) -->
				<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sources-strokes">
					<table class="ui-table" aria-labelledby="sources-strokes">
						<thead>
							<tr>
								<th scope="col">{t('sources.col.name')}</th>
								{@render noteHeader(strokes.table)}
								<th scope="col">{t('sources.col.language')}</th>
								<th scope="col">{t('sources.col.version')}</th>
								<th scope="col">{t('sources.license')}</th>
								<th scope="col">{t('sources.attribution')}</th>
							</tr>
						</thead>
						<tbody>
							{#each strokes.table.rows as row (row.key)}
								<tr>
									<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
									{@render noteCell(strokes.table, row.noteId, row.name)}
									<td title={row.language}>{languageLabel(row.language)}</td>
									<td>{row.version}</td>
									<td>
										{#if strokes.licenseHref[row.key]}
											<a href={strokes.licenseHref[row.key]} data-sveltekit-reload>{row.license}</a>
										{:else}
											{@render cell(row.license, row.language)}
										{/if}
									</td>
									<td>{@render cell(row.attribution, row.language)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{@render notes(strokes.table)}
			{/if}
			<p class="notice">
				{t('sources.strokes.notice')}
			</p>
		</section>
	{/if}

	{#if fonts.show}
		<section>
			<h2 id="sources-fonts">{t('sources.fonts.title')}</h2>
			{#if fontsError}
				<p class="error" role="alert">{fontsError}</p>
				<Button onclick={loadFonts}>{t('sources.retry')}</Button>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region is keyboard reachable, WCAG 2.1.1) -->
				<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sources-fonts">
					<table class="ui-table" aria-labelledby="sources-fonts">
						<thead>
							<tr>
								<th scope="col">{t('sources.col.name')}</th>
								{@render noteHeader(fonts.table)}
								<th scope="col">{t('sources.col.language')}</th>
								<th scope="col">{t('sources.col.version')}</th>
								<th scope="col">{t('sources.license')}</th>
								<th scope="col">{t('sources.attribution')}</th>
							</tr>
						</thead>
						<tbody>
							{#each fonts.table.rows as row (row.key)}
								<tr>
									<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
									{@render noteCell(fonts.table, row.noteId, row.name)}
									<td title={row.language}>{languageLabel(row.language)}</td>
									<td>{row.version}</td>
									<td>
										{#if fonts.licenseHref[row.key]}
											<a href={fonts.licenseHref[row.key]} rel="noreferrer">{row.license}</a>
										{:else}
											{@render cell(row.license, row.language)}
										{/if}
									</td>
									<td>{@render cell(row.attribution, row.language)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#each fonts.modified as line, i (i)}
					<p>{line}</p>
				{/each}
				{@render notes(fonts.table)}
			{/if}
			<p class="notice">
				{t('sources.fonts.notice')}
			</p>
		</section>
	{/if}

	{#if audio}
		<section>
			<h2 id="sources-audio">{t('sources.audio.title')}</h2>

			<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region is keyboard reachable, WCAG 2.1.1) -->
			<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sources-audio">
				<table class="ui-table" aria-labelledby="sources-audio">
					<thead>
						<tr>
							<th scope="col">{t('sources.col.name')}</th>
							{@render noteHeader(audio.table)}
							<th scope="col">{t('sources.col.language')}</th>
							<th scope="col">{t('sources.col.version')}</th>
							<th scope="col">{t('sources.license')}</th>
							<th scope="col">{t('sources.attribution')}</th>
							<th scope="col">{t('sources.col.credits')}</th>
						</tr>
					</thead>
					<tbody>
						{#each audio.table.rows as row (row.key)}
							<tr>
								<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
								{@render noteCell(audio.table, row.noteId, row.name)}
								<td title={row.language}>{languageLabel(row.language)}</td>
								<td>{row.version}</td>
								<td>
									{#if audio.licenseHref[row.key]}
										<a href={audio.licenseHref[row.key]} rel="noopener">{row.license}</a>
									{:else}
										{@render cell(row.license, row.language)}
									{/if}
								</td>
								<td>{@render cell(row.attribution, row.language)}</td>
								<td>
									{#each audio.creditsPages[row.key] ?? [] as link (link.href)}
										<a href={link.href}>{link.label}</a>{' '}
									{/each}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{@render notes(audio.table)}

			<p class="notice">
				<Msg key="sources.audio.notice">{#snippet code(text: string)}<code>{text}</code>{/snippet}</Msg>
			</p>
		</section>
	{:else if audioError}
		<p class="error" role="alert">{audioError}</p>
	{/if}

	<section>
		<h2 id="sources-levels">{t('sources.levels.title')}</h2>

		{#if schemesLoading}
			<p>{t('sources.levels.loading')}</p>
		{:else if schemesError}
			<p class="error" role="alert">{schemesError}</p>
			<Button onclick={loadSchemes}>{t('sources.retry')}</Button>
		{:else if schemes.length === 0}
			<p>{t('sources.levels.none')}</p>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region is keyboard reachable, WCAG 2.1.1) -->
			<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sources-levels">
				<table class="ui-table" aria-labelledby="sources-levels">
					<thead>
						<tr>
							<th scope="col">{t('sources.col.name')}</th>
							{@render noteHeader(levelTable)}
							<th scope="col">{t('sources.col.language')}</th>
							<th scope="col">{t('sources.col.version')}</th>
							<th scope="col">{t('sources.license')}</th>
							<th scope="col">{t('sources.attribution')}</th>
						</tr>
					</thead>
					<tbody>
						{#each levelTable.rows as row (row.key)}
							<tr>
								<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
								{@render noteCell(levelTable, row.noteId, row.name)}
								<td title={row.language}>{languageLabel(row.language)}</td>
								<td>{row.version}</td>
								<td>{@render cell(row.license, row.language)}</td>
								<td>{@render cell(row.attribution, row.language)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{@render notes(levelTable)}
		{/if}

		<p class="notice">
			{t('sources.levels.notice')}
		</p>
	</section>

	<section>
		<h2 id="sources-grammar">{t('sources.grammar.title')}</h2>

		{#if grammarLoading}
			<p>{t('sources.grammar.loading')}</p>
		{:else if grammarError}
			<p class="error" role="alert">{grammarError}</p>
			<Button onclick={loadGrammar}>{t('sources.retry')}</Button>
		{:else if grammarPacks.length === 0}
			<p>{t('sources.grammar.none')}</p>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region is keyboard reachable, WCAG 2.1.1) -->
			<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sources-grammar">
				<table class="ui-table" aria-labelledby="sources-grammar">
					<thead>
						<tr>
							<th scope="col">{t('sources.col.name')}</th>
							{@render noteHeader(grammarTable)}
							<th scope="col">{t('sources.col.language')}</th>
							<th scope="col">{t('sources.col.version')}</th>
							<th scope="col">{t('sources.license')}</th>
							<th scope="col">{t('sources.attribution')}</th>
						</tr>
					</thead>
					<tbody>
						{#each grammarTable.rows as row (row.key)}
							<tr>
								<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
								{@render noteCell(grammarTable, row.noteId, row.name)}
								<td title={row.language}>{languageLabel(row.language)}</td>
								<td>{row.version}</td>
								<td>{@render cell(row.license, row.language)}</td>
								<td>{@render cell(row.attribution, row.language)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{@render notes(grammarTable)}
		{/if}

		<p class="notice">
			{t('sources.grammar.notice')}
		</p>
	</section>

	{#if features.length > 0}
		<section>
			<h2 id="sources-features">{t('sources.features.title')}</h2>
			<p class="lede">{t('sources.features.lede')}</p>
			{#each features as feature (feature.id)}
				<h3 class="feature-name">{feature.name}</h3>
				<ul class="credits" aria-label={t('sources.features.sources', { name: feature.name })}>
					{#each feature.credits as view (view.name)}
						{@render credit(view, 'h4')}
					{/each}
				</ul>
			{/each}
		</section>
	{/if}

	<section>
		<h2 id="sources-core">{t('sources.core.title')}</h2>
		<ul class="credits" aria-labelledby="sources-core">
			{#each coreViews as view (view.name)}
				{@render credit(view, 'h3')}
			{/each}
		</ul>
	</section>

	<section>
		<h2>{t('sources.more.title')}</h2>
		<p>
			<Msg key="sources.more.text">{#snippet code(text: string)}<code>{text}</code>{/snippet}</Msg>
		</p>
	</section>
</div>

<style>
	/* Sections keep today's order and ids; the hairline separates them. */
	.sources section {
		margin-top: var(--space-5);
	}

	.sources section + section {
		padding-top: var(--space-5);
		border-top: 1px solid var(--hair);
	}

	.lede {
		margin-top: 0;
		color: var(--readable-muted);
	}

	.hint {
		color: var(--readable-muted);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* A wide table scrolls inside its own named region; no box (#106). */
	.table-wrap {
		overflow-x: auto;
	}

	.table-wrap:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.name {
		font-weight: var(--weight-strong);
		white-space: nowrap;
	}

	.note-cell {
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.notice {
		margin: 0.9rem 0 0;
		font-size: 0.9rem;
		color: var(--readable-muted);
	}

	.notes-heading {
		margin: 1.2rem 0 0.4rem;
		font-size: 1rem;
	}

	.notes {
		margin: 0;
		font-size: 0.9rem;
	}

	.notes dt {
		font-weight: 600;
		margin-top: 0.8rem;
		scroll-margin-top: 4rem;
	}

	.notes dt:first-child {
		margin-top: 0;
	}

	.notes dt:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.notes dd {
		margin: 0.2rem 0 0;
		padding-inline-start: var(--space-3);
		border-inline-start: 1px solid var(--hair);
	}

	.notes dd :global(p),
	.credit-notice :global(p) {
		margin: 0.4rem 0 0;
		overflow-wrap: anywhere;
	}

	.notes dd :global(p:first-child),
	.credit-notice :global(p:first-child) {
		margin-top: 0;
	}

	.feature-name {
		margin: 1.4rem 0 0.4rem;
	}

	.credits {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.8rem;
	}

	/* Credits are hairline rows, not a table and not a box (#106). */
	.credit {
		padding-block: var(--space-3);
		font-size: var(--font-size-s);
	}

	.credit + .credit {
		border-top: 1px solid var(--hair);
	}

	.credit-name {
		margin: 0 0 0.3rem;
		font-size: 1rem;
	}

	.facts {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.15rem 0.7rem;
		margin: 0 0 0.4rem;
		font-size: 0.9rem;
	}

	.facts dt {
		color: var(--readable-muted);
	}

	.facts dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.license-texts {
		margin: 0.4rem 0 0;
		font-size: 0.9rem;
	}

	.licence-text {
		margin: 0.4rem 0 0;
		font-size: 0.9rem;
	}

	.licence-text pre {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 0.8rem;
	}

	.error {
		margin: 0 0 0.6rem;
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	/* Text links stay recognisable without colour (#106): accent text and an
	   underline; forced colours keep the underline and the system link colour. */
	a {
		color: var(--reading-accent);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	summary {
		cursor: pointer;
	}

	@media (forced-colors: active) {
		a {
			color: LinkText;
		}
		.table-wrap:focus-visible,
		.notes dt:focus-visible {
			outline-color: Highlight;
		}
	}
</style>
