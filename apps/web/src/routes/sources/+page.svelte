<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError, api } from '$lib/api/client';
	import type { Dictionary, FrequencyPack, Scheme } from '$lib/api/types';
	import { audioSection, type AudioPackInfo } from '$lib/sources/audioSection';
	import { languageLabel } from '$lib/languages';
	import { webPlugins } from '$lib/plugins';
	import { listGrammar } from '$lib/plugins/grammar/api';
	import type { PackInfo } from '$lib/plugins/grammar/types';
	import { coreCredits } from '$lib/sources/coreCredits';
	import { cjkLang, scriptRuns, type NoticeParagraph } from '$lib/sources/notice';
	import { creditView, packTable, pluginCredits, type CreditView, type PackTable } from '$lib/sources/sections';

	// Credits declared in code: the app's own, and each web plugin's.
	const coreViews = coreCredits.map(creditView);
	const plugins = pluginCredits(
		webPlugins.map((plugin) => plugin.manifest),
		coreCredits
	);

	let dictionaries = $state<Dictionary[]>([]);
	let loading = $state(true);
	let error = $state('');
	const dictionaryTable = $derived(packTable('dictionaries', dictionaries));

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
			audioError = message(err, 'Could not load audio credits.');
		}
	}

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			// The list endpoint is public; a stale token must not turn a
			// credits page into a login redirect.
			dictionaries = await api<Dictionary[]>('/api/dictionaries', { auth: false });
		} catch (err) {
			dictionaries = [];
			error = message(err, 'Could not load dictionary credits.');
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
			frequencyError = message(err, 'Could not load frequency list credits.');
		} finally {
			frequencyLoading = false;
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
			schemesError = message(err, 'Could not load level list credits.');
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
			grammarError = message(err, 'Could not load grammar lesson credits.');
		} finally {
			grammarLoading = false;
		}
	}

	onMount(() => {
		loadGrammar();
		load();
		loadFrequency();
		loadAudio();
		loadSchemes();
	});
</script>

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
	{#if table.notes.length > 0}<th scope="col"><span class="visually-hidden">Note</span></th>{/if}
{/snippet}

{#snippet noteCell(table: PackTable, noteId: string | undefined, name: string)}
	{#if table.notes.length > 0}
		<td class="note-cell">
			{#if noteId}<a href={`#${noteId}`}>Note<span class="visually-hidden">{` on ${name}`}</span></a
				>{/if}
		</td>
	{/if}
{/snippet}

<!-- The visible "Notes" heading names the list: a dl has no role that
     aria-labelledby could reliably name. -->
{#snippet notes(table: PackTable)}
	{#if table.notes.length > 0}
		<h3 class="notes-heading">Notes</h3>
		<dl class="notes">
			{#each table.notes as note (note.id)}
				<dt id={note.id} tabindex="-1">{note.name}</dt>
				<dd>
					{@render paragraphs(note.paragraphs, note.lang)}
					{#each note.sharedWith as shared (shared.id)}
						<p class="shared">
							The source and terms in the note on <a href={`#${shared.id}`}>{shared.name}</a> above
							also apply.
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
					<dt>License</dt>
					<dd>{@render text(view.license, view.lang)}</dd>
				{/if}
				{#if view.attribution}
					<dt>Attribution</dt>
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

<main class="sources">
	<h1>Sources</h1>
	<p class="lede">
		Meanings, character data, word frequencies, level lists, and stroke diagrams come from
		upstream datasets. Their credits and licenses are listed here.
	</p>

	<section>
		<h2 id="sources-dictionaries">Installed dictionaries</h2>

		{#if loading}
			<p>Loading dictionary credits…</p>
		{:else if error}
			<p class="error" role="alert">{error}</p>
			<button type="button" onclick={load}>Retry</button>
		{:else if dictionaries.length === 0}
			<p>No dictionaries are installed.</p>
			<p class="hint">
				Run <code>qinqin seed</code>, or install a dictionary pack, to add meanings and
				character data.
			</p>
		{:else}
			<div class="table-wrap">
				<table aria-labelledby="sources-dictionaries">
					<thead>
						<tr>
							<th scope="col">Name</th>
							{@render noteHeader(dictionaryTable)}
							<th scope="col">Version</th>
							<th scope="col">License</th>
							<th scope="col">Attribution</th>
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
			Bundled dictionaries are redistributed as unmodified upstream files. The upstream
			dictionary packs under <code>plugins/data/</code> carry their <code>LICENSE</code> and
			<code>ATTRIBUTION.md</code>; the full index is in <code>docs/sources.md</code>.
		</p>
	</section>

	<section>
		<h2 id="sources-frequency">Frequency lists</h2>

		{#if frequencyLoading}
			<p>Loading frequency list credits…</p>
		{:else if frequencyError}
			<p class="error" role="alert">{frequencyError}</p>
			<button type="button" onclick={loadFrequency}>Retry</button>
		{:else if frequencyPacks.length === 0}
			<p>No frequency lists are installed; lookups rank without them.</p>
		{:else}
			<div class="table-wrap">
				<table aria-labelledby="sources-frequency">
					<thead>
						<tr>
							<th scope="col">Name</th>
							{@render noteHeader(frequencyTable)}
							<th scope="col">Language</th>
							<th scope="col">Version</th>
							<th scope="col">License</th>
							<th scope="col">Attribution</th>
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
			Word frequency ranks order the lookup results. Frequency lists with unclear licences are
			never bundled; an instance may add them locally from <code>plugins/data-local/</code>.
		</p>
	</section>

	{#if audio}
		<section>
			<h2 id="sources-audio">Audio</h2>

			<div class="table-wrap">
				<table aria-labelledby="sources-audio">
					<thead>
						<tr>
							<th scope="col">Name</th>
							{@render noteHeader(audio.table)}
							<th scope="col">Language</th>
							<th scope="col">Version</th>
							<th scope="col">License</th>
							<th scope="col">Attribution</th>
							<th scope="col">Credits</th>
						</tr>
					</thead>
					<tbody>
						{#each audio.table.rows as row (row.key)}
							<tr>
								<th scope="row" class="name">{@render cell(row.name, row.language)}</th>
								{@render noteCell(audio.table, row.noteId, row.name)}
								<td title={row.language}>{languageLabel(row.language)}</td>
								<td>{row.version}</td>
								<td>{@render cell(row.license, row.language)}</td>
								<td>{@render cell(row.attribution, row.language)}</td>
								<td>
									{#if audio.creditsHref[row.key]}
										<a href={audio.creditsHref[row.key]}>Per-recording credits</a>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{@render notes(audio.table)}

			<p class="notice">
				Pronunciation recordings play from the entry page and after the answer in study. Each
				recording is credited next to its play button. Recordings with unclear licences are never
				bundled; an instance may add them locally from <code>plugins/data-local/</code>.
			</p>
		</section>
	{:else if audioError}
		<p class="error" role="alert">{audioError}</p>
	{/if}

	<section>
		<h2 id="sources-levels">Level lists</h2>

		{#if schemesLoading}
			<p>Loading level list credits…</p>
		{:else if schemesError}
			<p class="error" role="alert">{schemesError}</p>
			<button type="button" onclick={loadSchemes}>Retry</button>
		{:else if schemes.length === 0}
			<p>No level lists are installed.</p>
		{:else}
			<div class="table-wrap">
				<table aria-labelledby="sources-levels">
					<thead>
						<tr>
							<th scope="col">Name</th>
							{@render noteHeader(levelTable)}
							<th scope="col">Language</th>
							<th scope="col">Version</th>
							<th scope="col">License</th>
							<th scope="col">Attribution</th>
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
			Level lists group the character map and badge entries. Unless a pack's note above says
			otherwise, lists installed from packs are third-party compilations, not official releases
			of the tests they are named after.
		</p>
	</section>

	<section>
		<h2 id="sources-grammar">Grammar lessons</h2>

		{#if grammarLoading}
			<p>Loading grammar lesson credits…</p>
		{:else if grammarError}
			<p class="error" role="alert">{grammarError}</p>
			<button type="button" onclick={loadGrammar}>Retry</button>
		{:else if grammarPacks.length === 0}
			<p>No grammar lessons are installed.</p>
		{:else}
			<div class="table-wrap">
				<table aria-labelledby="sources-grammar">
					<thead>
						<tr>
							<th scope="col">Name</th>
							{@render noteHeader(grammarTable)}
							<th scope="col">Language</th>
							<th scope="col">Version</th>
							<th scope="col">License</th>
							<th scope="col">Attribution</th>
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
			Grammar lessons are written by the pack's author; the explanations and examples are not
			taken from a syllabus. Read each pack's note for who wrote it and whether a native speaker
			has reviewed it.
		</p>
	</section>

	{#if plugins.length > 0}
		<section>
			<h2 id="sources-plugins">Plugins</h2>
			<p class="lede">Material that feature plugins bundle or fetch, as each plugin declares it.</p>
			{#each plugins as plugin (plugin.id)}
				<h3 class="plugin-name">{plugin.name}</h3>
				<ul class="credits" aria-label={`${plugin.name} sources`}>
					{#each plugin.credits as view (view.name)}
						{@render credit(view, 'h4')}
					{/each}
				</ul>
			{/each}
		</section>
	{/if}

	<section>
		<h2 id="sources-core">Built into the app</h2>
		<ul class="credits" aria-labelledby="sources-core">
			{#each coreViews as view (view.name)}
				{@render credit(view, 'h3')}
			{/each}
		</ul>
	</section>

	<section>
		<h2>More</h2>
		<p>
			Full license texts and attribution notices for the upstream dictionary packs live in
			their pack directories under <code>plugins/data/</code>; <code>docs/sources.md</code>
			indexes the bundled upstream sources. If this instance installs additional packs, their
			credits appear in the tables above once installed.
		</p>
	</section>
</main>

<style>
	.sources section {
		margin-top: 2rem;
	}

	.lede {
		margin-top: 0;
		opacity: 0.85;
	}

	.hint {
		opacity: 0.75;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.table-wrap {
		overflow-x: auto;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.95rem;
	}

	th,
	td {
		padding: 0.5rem 0.7rem;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
	}

	tbody tr:last-child td,
	tbody tr:last-child th {
		border-bottom: 0;
	}

	thead th {
		font-size: 0.8rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		opacity: 0.75;
		white-space: nowrap;
	}

	.name {
		font-weight: 600;
		white-space: nowrap;
	}

	.note-cell {
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.notice {
		margin: 0.9rem 0 0;
		font-size: 0.9rem;
		opacity: 0.85;
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
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}

	.notes dd {
		margin: 0.2rem 0 0;
		padding-left: 0.8rem;
		border-left: 3px solid color-mix(in srgb, currentColor 18%, transparent);
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

	.plugin-name {
		margin: 1.4rem 0 0.4rem;
	}

	.credits {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.8rem;
	}

	.credit {
		padding: 0.7rem 0.9rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
		font-size: 0.95rem;
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
		opacity: 0.75;
	}

	.facts dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.license-texts {
		margin: 0.4rem 0 0;
		font-size: 0.9rem;
	}

	.error {
		margin: 0 0 0.6rem;
		color: #c62828;
		font-weight: 600;
	}

	button {
		font: inherit;
		font-weight: 600;
		padding: 0.45rem 0.85rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		cursor: pointer;
	}

	a {
		color: inherit;
	}
</style>
