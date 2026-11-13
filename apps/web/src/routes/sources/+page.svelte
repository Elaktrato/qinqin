<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError, api } from '$lib/api/client';
	import type { Dictionary, FrequencyPack, Scheme } from '$lib/api/types';
	import { languageLabel } from '$lib/languages';

	let dictionaries = $state<Dictionary[]>([]);
	let loading = $state(true);
	let error = $state('');

	let frequencyPacks = $state<FrequencyPack[]>([]);
	let frequencyLoading = $state(true);
	let frequencyError = $state('');

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

	onMount(() => {
		load();
		loadFrequency();
		loadSchemes();
	});
</script>

<main class="sources">
	<h1>Sources</h1>
	<p class="lede">
		Meanings, character data, word frequencies, and stroke diagrams come from upstream open
		datasets. Their
		credits and licenses are listed here.
	</p>

	<section>
		<h2>Installed dictionaries</h2>

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
				<table>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Version</th>
							<th scope="col">License</th>
							<th scope="col">Attribution</th>
						</tr>
					</thead>
					<tbody>
						{#each dictionaries as dictionary (dictionary.id)}
							<tr>
								<td class="name">{dictionary.name}</td>
								<td>{dictionary.version}</td>
								<td>{dictionary.license}</td>
								<td>{dictionary.attribution}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<p class="notice">
			Bundled dictionaries are redistributed as unmodified upstream files. The upstream
			dictionary packs under <code>plugins/data/</code> carry their <code>LICENSE</code> and
			<code>ATTRIBUTION.md</code>; the full index is in <code>docs/sources.md</code>.
		</p>
	</section>

	<section>
		<h2>Frequency lists</h2>

		{#if frequencyLoading}
			<p>Loading frequency list credits…</p>
		{:else if frequencyError}
			<p class="error" role="alert">{frequencyError}</p>
			<button type="button" onclick={loadFrequency}>Retry</button>
		{:else if frequencyPacks.length === 0}
			<p>No frequency lists are installed; lookups rank without them.</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Language</th>
							<th scope="col">Version</th>
							<th scope="col">License</th>
							<th scope="col">Attribution</th>
						</tr>
					</thead>
					<tbody>
						{#each frequencyPacks as pack (pack.id)}
							<tr>
								<td class="name">{pack.name}</td>
								<td title={pack.language}>{languageLabel(pack.language)}</td>
								<td>{pack.version}</td>
								<td>{pack.license}</td>
								<td>{pack.attribution}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<p class="notice">
			Word frequency ranks order the lookup results. The bundled Jiten list is
			<a href="https://jiten.moe/frequency-dictionaries" rel="noreferrer">Jiten</a>'s global
			frequency list, licensed CC BY-SA 4.0 by its publisher, with its ranks unmodified and
			converted to CSV. Frequency lists with unclear licences are never bundled; an instance may
			add them locally from <code>plugins/data-local/</code>.
		</p>
	</section>

	<section>
		<h2>Level lists</h2>

		{#if schemesLoading}
			<p>Loading level list credits…</p>
		{:else if schemesError}
			<p class="error" role="alert">{schemesError}</p>
			<button type="button" onclick={loadSchemes}>Retry</button>
		{:else if schemes.length === 0}
			<p>No level lists are installed.</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Language</th>
							<th scope="col">Version</th>
							<th scope="col">License</th>
							<th scope="col">Attribution</th>
						</tr>
					</thead>
					<tbody>
						{#each schemes as scheme (scheme.id)}
							<tr>
								<td class="name">{scheme.name}</td>
								<td title={scheme.language}>{languageLabel(scheme.language)}</td>
								<td>{scheme.version ?? ''}</td>
								<td>{scheme.license ?? ''}</td>
								<td>{scheme.attribution ?? ''}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<p class="notice">
			Level lists group the character map and badge entries. The JLPT N5–N1 kanji come from
			<a href="https://github.com/onlyskin/kanjiapi.dev" rel="noreferrer">kanjiapi.dev</a> (MIT);
			the JLPT publishes no official lists, so every N5–N1 list is a reconstruction. The JLPT
			vocabulary comes from
			<a href="https://github.com/jamsinclair/open-anki-jlpt-decks" rel="noreferrer"
				>open-anki-jlpt-decks</a
			>
			(MIT), which its README says was taken from chyyran/jlpt-anki-decks, based on the
			tanos.co.uk lists by Jonathan Waller (described as Creative Commons Attribution). The HSK
			3.0 characters and words come from
			<a href="https://github.com/ivankra/hsk30" rel="noreferrer">ivankra/hsk30</a> (MIT), a
			transcription of the 2021 Ministry of Education standard whose own README doubts the
			copyright claims on it. Neither is an official release.
		</p>
	</section>

	<section>
		<h2>Stroke-order data</h2>
		<p>
			Stroke-order animations use
			<a href="https://www.npmjs.com/package/hanzi-writer-data" rel="noreferrer">hanzi-writer-data</a>,
			derived from the
			<a href="https://github.com/skishore/makemeahanzi" rel="noreferrer">Make Me a Hanzi</a>
			dataset. That data is licensed under the <strong>Arphic Public License</strong> and is used
			unmodified. The <a href="/ARPHICPL.TXT">full license text</a> ships with this app.
		</p>
	</section>

	<section>
		<h2>Script conversion</h2>
		<p>
			Traditional/simplified conversion in the Reader uses
			<a href="https://github.com/nk2028/opencc-js" rel="noreferrer">opencc-js</a>, licensed
			<strong>MIT AND Apache-2.0</strong>: the library is under the MIT License, and its
			conversion dictionaries, generated from
			<a href="https://github.com/nk2028/opencc-data" rel="noreferrer">opencc-data</a>, under the
			Apache License, Version 2.0. The <a href="/OPENCC-JS-LICENSE.TXT">MIT license text</a> and
			the <a href="/OPENCC-APACHE-2.0.TXT">Apache-2.0 license text</a> ship with this app.
		</p>
	</section>

	<section>
		<h2>More</h2>
		<p>
			Full license texts and attribution notices for the upstream dictionary packs live in
			their pack directories under <code>plugins/data/</code>; <code>docs/sources.md</code>
			indexes the bundled upstream sources. If this instance installs additional packs, their
			credits appear in the table above once installed.
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

	tbody tr:last-child td {
		border-bottom: 0;
	}

	th {
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

	.notice {
		margin: 0.9rem 0 0;
		font-size: 0.9rem;
		opacity: 0.85;
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
